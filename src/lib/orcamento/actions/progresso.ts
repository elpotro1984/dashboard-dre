"use server";

import { createClient } from "@/lib/supabase/server";
import { createAdminClientIfAvailable } from "@/lib/supabase/admin";
import { autorizarLeitura } from "@/lib/orcamento/auth";
import { chaveFinalizacao, isMetodoFinalizavel } from "@/lib/orcamento/finalizacao";
import { isValidBudgetYear } from "@/lib/orcamento/years";
import { orcaPorSetor, setorNaoAtribuido } from "@/lib/orcamento/setor-gravacao";
import { getCategoriasOrcamento } from "@/lib/orcamento/actions/categoria-metodo";
import type { OrcamentoMetodo } from "@/lib/orcamento/metodos";
import {
  progressoPessoal,
  progressoPorCategoria,
  progressoViagens,
  type ProgressoMetodo,
} from "@/lib/orcamento/progresso";

export type ProgressoPorMetodo = Partial<Record<OrcamentoMetodo, ProgressoMetodo>>;

/**
 * O andamento de cada método da empresa × ano, para a tag do card no hub.
 * A regra é `progresso.ts` (puro e testado); aqui só se busca o que ela pede.
 *
 * Recortado no ESCOPO de quem vê, como os contadores da validação: o Gerente lê
 * o andamento dos setores dele. É ACESSÓRIO — tabela ou leitura que falhar
 * conta como vazia e o card só fica sem a tag; nunca derruba o hub.
 */
export async function getProgressoPorMetodo(
  companyId: string,
  year: number,
): Promise<{ progresso: ProgressoPorMetodo }> {
  if (!companyId || !isValidBudgetYear(year)) return { progresso: {} };

  const supabase = createAdminClientIfAvailable() ?? (await createClient());
  const auth = await autorizarLeitura(supabase, companyId, year);
  if (!auth.ok) return { progresso: {} };
  const escopo = auth.setores;

  const [porSetor, balde, cats] = await Promise.all([
    orcaPorSetor(supabase, companyId, year),
    setorNaoAtribuido(supabase, companyId, year),
    getCategoriasOrcamento(companyId, year),
  ]);
  const baldeId = balde.id;

  const daEmpresa = <T,>(tabela: string, colunas: string) =>
    supabase.from(tabela).select(colunas).eq("company_id", companyId).eq("year", year) as unknown as
      PromiseLike<{ data: T[] | null; error: unknown }>;
  const linhas = <T,>(res: { data: T[] | null; error: unknown }): T[] =>
    res.error ? [] : (res.data ?? []);

  type Linha = { category_code: string; setor_id: string | null };
  const [atribRes, finRes, mediaRes, vfRes, despRes, entrevRes, colabRes, viagRes, setoresRes] =
    await Promise.all([
      daEmpresa<Linha>("orcamento_categoria_setores", "category_code, setor_id"),
      daEmpresa<Linha & { metodo: string }>("orcamento_finalizacoes", "metodo, category_code, setor_id"),
      daEmpresa<Linha>("orcamento_media_categorias", "category_code, setor_id"),
      daEmpresa<Linha>("orcamento_valor_fixo_categorias", "category_code, setor_id"),
      daEmpresa<Linha & { cancelado: boolean }>(
        "orcamento_planejamento_despesas",
        "category_code, setor_id, cancelado",
      ),
      daEmpresa<Linha & { conversa: unknown }>(
        "orcamento_planejamento_entrevistas",
        "category_code, setor_id, conversa",
      ),
      daEmpresa<{ setor_id: string | null; cancelado_em: string | null }>(
        "orcamento_pessoal_colaboradores",
        "setor_id, cancelado_em",
      ),
      daEmpresa<Linha & { status: string }>("orcamento_viagens", "category_code, setor_id, status"),
      daEmpresa<{ id: string; active: boolean }>("orcamento_setores", "id, active"),
    ]);

  // Finalizações → chaves, no mesmo formato que `fatiaFechada` consulta.
  const fechadas = new Set(
    linhas(finRes)
      .filter((r) => isMetodoFinalizavel(r.metodo))
      .map((r) =>
        chaveFinalizacao({
          metodo: r.metodo as OrcamentoMetodo,
          categoryCode: r.category_code ?? "",
          setorId: r.setor_id ?? null,
        }),
      ),
  );

  // Código da Omie → categoria canônica: linha gravada na gêmea "(*)" (antes da
  // unificação) conta para a categoria que a absorveu.
  const canonica = new Map<string, string>();
  const porMetodo = new Map<string, string[]>();
  (cats.items ?? []).forEach((c) => {
    c.codigos.forEach((code) => canonica.set(code, c.categoryCode));
    if (!c.metodo) return;
    porMetodo.set(c.metodo, [...(porMetodo.get(c.metodo) ?? []), c.categoryCode]);
  });

  const atribuidos = new Map<string, string[]>();
  linhas(atribRes).forEach((r) => {
    const code = canonica.get(r.category_code) ?? r.category_code;
    if (r.setor_id) atribuidos.set(code, [...(atribuidos.get(code) ?? []), r.setor_id]);
  });

  const comDadoDe = (rows: readonly Linha[]) => {
    const m = new Map<string, Set<string | null>>();
    rows.forEach((r) => {
      const code = canonica.get(r.category_code) ?? r.category_code;
      if (!m.has(code)) m.set(code, new Set());
      m.get(code)!.add(r.setor_id ?? null);
    });
    return m;
  };

  // Planejamento começou quando há despesa OU quando o gestor já escreveu na
  // entrevista — abrir a tela cria a linha da conversa vazia, e isso sozinho
  // não é começar.
  const gestorFalou = (conversa: unknown) =>
    Array.isArray(conversa) &&
    conversa.some((m) => !!m && typeof m === "object" && (m as { role?: unknown }).role === "user");
  const planejamentoComDado = comDadoDe([
    ...linhas(despRes).filter((r) => r.cancelado !== true),
    ...linhas(entrevRes).filter((r) => gestorFalou(r.conversa)),
  ]);

  const porCategoria = (metodo: OrcamentoMetodo, comDado: Map<string, Set<string | null>>) =>
    progressoPorCategoria({
      metodo,
      categorias: porMetodo.get(metodo) ?? [],
      porSetor,
      baldeId,
      fechadas,
      atribuidos,
      comDado,
      escopo,
    });

  const colaboradores = new Map<string | null, number>();
  linhas(colabRes)
    .filter((r) => r.cancelado_em == null)
    .forEach((r) => colaboradores.set(r.setor_id ?? null, (colaboradores.get(r.setor_id ?? null) ?? 0) + 1));

  const setoresAtivos = linhas(setoresRes)
    .filter((s) => s.active !== false && s.id !== baldeId)
    .map((s) => s.id)
    .filter((id) => escopo === null || escopo.includes(id));

  const viagens = linhas(viagRes)
    .filter((v) => !porSetor || escopo === null || (v.setor_id != null && escopo.includes(v.setor_id)))
    .map((v) => ({ status: v.status, categoryCode: v.category_code ?? null, setorId: v.setor_id ?? null }));

  return {
    progresso: {
      media: porCategoria("media", comDadoDe(linhas(mediaRes))),
      valor_fixo: porCategoria("valor_fixo", comDadoDe(linhas(vfRes))),
      planejamento_socios: porCategoria("planejamento_socios", planejamentoComDado),
      pessoal: progressoPessoal({
        porSetor,
        baldeId,
        fechadas,
        setores: setoresAtivos,
        colaboradores,
      }),
      viagens: progressoViagens({ porSetor, baldeId, fechadas, viagens }),
    },
  };
}
