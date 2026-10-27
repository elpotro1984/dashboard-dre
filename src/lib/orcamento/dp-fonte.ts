import "server-only";

import { getCurrentSessionContext } from "@/lib/auth/session";
import { createAdminClient } from "@/lib/supabase/admin";
import { getOrcamentoUser, SEM_ACESSO_ADMIN, type OrcamentoUser } from "@/lib/orcamento/auth";
import { indexarRegras, resolverEmpresa, type DpEmpresaRegra } from "@/lib/dp/empresa";
import { resolverLinha } from "@/lib/dp/vinculo";
import { nomeCargo } from "@/lib/dp/cargos";
import type { DpPessoa } from "@/lib/orcamento/dp-sync";

// =============================================================================
// O lado DP da integração: quem lê o cadastro do Departamento Pessoal para o
// Orçamento, e sob que autorização.
//
// Este é o arquivo em que a travessia do dado sigiloso acontece, então o guard
// dele é a parte mais importante. É o INVERSO de `src/lib/dp/encargos-dp.ts`
// (o DP lendo o cadastro de encargos do Orçamento com o próprio acesso), e o
// enquadramento é o mesmo: quem atravessa a fronteira precisa das credenciais
// dos DOIS lados.
// =============================================================================

export const SEM_ACESSO_DP =
  "Esta sincronização exige o módulo Departamento Pessoal, além de ser administrador do Orçamento.";

/**
 * Guard DUPLO: admin do Orçamento **e** concessão do módulo DP.
 *
 * Decisão de 27/10/2026. O DP é o gate mais fechado do sistema — concessão
 * própria, admin NÃO herda, trigger no banco impedindo auto-concessão, e hoje
 * só o Lucas concede. O Orçamento tem outro recorte, e o quadro de pessoal dele
 * é lido pelo gestor de cada setor.
 *
 * Exigir as duas coisas põe o gate do DP sobre a TRAVESSIA, que é o momento que
 * importa: depois de atravessar, o dado vive sob as regras do Orçamento (que
 * já mostram nome e salário por pessoa ao gestor do setor). Sem isto, um admin
 * do Control Hub sem o DP passaria a ver salário real de todo mundo por uma
 * porta lateral — e são mais admins que pessoas com o DP.
 *
 * Note que NÃO basta `getOrcamentoAdmin()`: as telas de configuração do
 * Orçamento são admin-only, então o botão viveria numa tela que todo admin
 * abre.
 */
export async function autorizarSyncDp(): Promise<
  { ok: true; user: OrcamentoUser } | { ok: false; error: string }
> {
  const user = await getOrcamentoUser();
  if (!user?.isAdmin) return { ok: false, error: SEM_ACESSO_ADMIN };

  const { profile } = await getCurrentSessionContext();
  if (!profile?.can_dp) return { ok: false, error: SEM_ACESSO_DP };

  return { ok: true, user };
}

/** Linha da tabela salarial do DP, como o Orçamento a oferece. */
export interface LinhaDoDp {
  id: string;
  setor: string;
  /** Cargo + senioridade + step, já juntos — é o que vai para o campo de texto. */
  nome: string;
  salario: number;
}

export interface FonteDp {
  pessoas: DpPessoa[];
  /** As linhas da tabela salarial, para o seletor de cargo da movimentação. */
  linhas: LinhaDoDp[];
  /** Departamentos distintos que apareceram, na grafia do DP. */
  departamentos: string[];
  /**
   * Quantos ativos do DP ficaram de fora porque o de-para de EMPRESA do DP não
   * resolve a empresa deles. Não é problema do Orçamento — é cadastro do DP —,
   * mas sumir com eles calado faria o admin concluir que o quadro é menor.
   */
  semEmpresaNoDp: number;
}

type Admin = ReturnType<typeof createAdminClient>;

/**
 * Tudo o que o sync precisa do DP para UMA empresa.
 *
 * Lê com o admin client — depois do guard duplo, como todas as telas do DP
 * fazem. A RLS de `dp_*` exige `role='gestor'`, então o client do usuário
 * devolveria zero para uma analista e para quem tem o Orçamento sem o DP.
 *
 * A empresa de cada pessoa **não está gravada** no espelho: é resolvida na
 * leitura por `dp_empresa_regras` (unidade decide; departamento só quando a
 * unidade está vazia). Reusamos `resolverEmpresa` em vez de reescrever a regra
 * — ela é a mesma que as telas do DP usam, e divergir aqui poria a pessoa na
 * empresa errada em silêncio.
 */
export async function lerFonteDp(companyId: string): Promise<FonteDp> {
  const db = createAdminClient();

  const [colabs, regras, tabela, vinculos, ajustes] = await Promise.all([
    db
      .from("dp_colaboradores")
      .select(
        "solides_id, nome, unidade_id, departamento_id, departamento_nome, cargo_id, cargo_nome, tipo_contrato, salario, data_desligamento",
      )
      .eq("ativo", true)
      .order("nome"),
    db.from("dp_empresa_regras").select("origem, solides_id, company_id"),
    // `senioridade` e `step` existem desde a migration 20261026160000. Sem ela
    // o select inteiro falharia com 42703 e levaria a tela junto — ver o
    // fallback abaixo.
    db
      .from("dp_tabela_salarial")
      .select("id, setor, cargo, senioridade, step, salario")
      .eq("company_id", companyId)
      .order("ordem"),
    db.from("dp_cargo_vinculos").select("solides_cargo_id, linha_id").eq("company_id", companyId),
    db.from("dp_colaborador_ajustes").select("solides_id, linha_id"),
  ]);

  const regrasIdx = indexarRegras(
    ((regras.data ?? []) as Array<Record<string, unknown>>).map((r) => ({
      origem: r.origem as DpEmpresaRegra["origem"],
      solidesId: Number(r.solides_id),
      companyId: r.company_id as string,
    })),
  );

  const linhas = mapearLinhas(db, tabela, companyId);
  const linhaPorId = new Map((await linhas).map((l) => [l.id, l]));

  const linhaPorCargo = new Map<number, string>();
  for (const v of (vinculos.data ?? []) as Array<Record<string, unknown>>) {
    linhaPorCargo.set(Number(v.solides_cargo_id), v.linha_id as string);
  }

  const excecaoPorPessoa = new Map<number, string>();
  for (const a of (ajustes.data ?? []) as Array<Record<string, unknown>>) {
    if (a.linha_id) excecaoPorPessoa.set(Number(a.solides_id), a.linha_id as string);
  }

  const pessoas: DpPessoa[] = [];
  const departamentos = new Map<string, string>();
  let semEmpresaNoDp = 0;

  for (const c of (colabs.data ?? []) as Array<Record<string, unknown>>) {
    const empresa = resolverEmpresa(
      {
        unidadeId: c.unidade_id == null ? null : Number(c.unidade_id),
        departamentoId: c.departamento_id == null ? null : Number(c.departamento_id),
      },
      regrasIdx,
    );
    if (empresa.companyId == null) {
      semEmpresaNoDp += 1;
      continue;
    }
    if (empresa.companyId !== companyId) continue;

    const solidesId = Number(c.solides_id);
    // Mesma precedência do DP: exceção da pessoa antes da regra do cargo.
    const { linhaId } = resolverLinha({
      excecaoLinhaId: excecaoPorPessoa.get(solidesId) ?? null,
      linhaDoCargoId: c.cargo_id == null ? null : linhaPorCargo.get(Number(c.cargo_id)) ?? null,
    });
    const linha = linhaId ? linhaPorId.get(linhaId) ?? null : null;

    const departamento = semSufixoDaEmpresa(c.departamento_nome as string | null);
    if (departamento) departamentos.set(departamento.toLowerCase(), departamento);

    pessoas.push({
      solidesId: String(solidesId),
      nome: ((c.nome as string) ?? "").trim(),
      departamento,
      cargoSolides: ((c.cargo_nome as string) ?? "").trim() || null,
      cargoDaLinha: linha?.nome || null,
      // `numeric` chega como string pelo PostgREST, e `null` é "não informado
      // na Sólides" — que precisa continuar distinto de zero.
      salario: c.salario == null ? null : Number(c.salario),
      tipoContrato: ((c.tipo_contrato as string) ?? "").trim() || null,
      dataDesligamento: (c.data_desligamento as string) ?? null,
    });
  }

  return {
    pessoas,
    linhas: await linhas,
    departamentos: Array.from(departamentos.values()).sort((a, b) => a.localeCompare(b, "pt-BR")),
    semEmpresaNoDp,
  };
}

/**
 * O departamento da Sólides vem como "ÁREA - EMPRESA"; o de-para e a folha do
 * DP usam só a área. Mesma normalização da folha, para o nome que o admin vê
 * aqui ser o mesmo que ele vê lá.
 */
function semSufixoDaEmpresa(nome: string | null): string | null {
  const bruto = (nome ?? "").trim();
  if (!bruto) return null;
  const corte = bruto.lastIndexOf(" - ");
  const area = corte > 0 ? bruto.slice(0, corte) : bruto;
  return area.trim() || null;
}

/**
 * Só as LINHAS da tabela salarial do DP — o que o seletor de cargo da
 * movimentação precisa.
 *
 * **Autorização: a do ORÇAMENTO, não a do DP** (e isto é decisão, não descuido).
 * O gestor que monta o quadro precisa escolher o cargo da movimentação; exigir
 * o módulo DP aqui deixaria a lista visível para duas pessoas e o campo vazio
 * para quem de fato preenche. O que atravessa é uma tabela CARGO → SALÁRIO da
 * empresa, que é a mesma natureza do Plano de Cargos do Orçamento, já visível
 * ao gestor nesta tela. O SALÁRIO DE CADA PESSOA continua passando só pelo
 * guard duplo (`autorizarSyncDp`).
 *
 * Quem chama é responsável por já ter autorizado a leitura da empresa.
 */
export async function lerLinhasDoDp(companyId: string): Promise<LinhaDoDp[]> {
  if (!companyId) return [];
  const db = createAdminClient();
  const tabela = await db
    .from("dp_tabela_salarial")
    .select("id, setor, cargo, senioridade, step, salario")
    .eq("company_id", companyId)
    .order("ordem");
  return mapearLinhas(db, tabela, companyId);
}

type Resposta = { data: unknown; error: { message: string } | null };

async function mapearLinhas(
  db: Admin,
  tabela: Resposta,
  companyId: string,
): Promise<LinhaDoDp[]> {
  let raw = (tabela.data ?? []) as Array<Record<string, unknown>>;
  if (tabela.error) {
    if (!isSchemaMissing(tabela.error.message)) return [];
    // Degrada como `getDpTabela` do próprio DP: sem as colunas de senioridade e
    // step (migration 20261026160000) o cargo vai sem elas, em vez de a tela
    // inteira cair por causa de um acessório.
    const sem = await db
      .from("dp_tabela_salarial")
      .select("id, setor, cargo, salario")
      .eq("company_id", companyId)
      .order("ordem");
    raw = (sem.data ?? []) as Array<Record<string, unknown>>;
  }
  return raw.map((l) => ({
    id: l.id as string,
    setor: ((l.setor as string) ?? "").trim(),
    nome: nomeCargo({
      cargo: (l.cargo as string) ?? "",
      senioridade: (l.senioridade as string) ?? null,
      step: (l.step as string) ?? null,
    }),
    salario: Number(l.salario ?? 0),
  }));
}

function isSchemaMissing(msg: string): boolean {
  return /column .* does not exist|42703/i.test(msg);
}
