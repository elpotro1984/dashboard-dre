"use server";

import { createClient } from "@/lib/supabase/server";
import { createAdminClientIfAvailable } from "@/lib/supabase/admin";
import { autorizarEscrita, SEM_EDICAO_METODO } from "@/lib/orcamento/auth";
import { podeEditarMetodo } from "@/lib/orcamento/metodos";
import { isValidBudgetYear } from "@/lib/orcamento/years";
import { isTodosSetores } from "@/lib/orcamento/setor-filtro";
import { mesesFechados } from "@/lib/orcamento/media-realizado";
import { INDICES, type IndiceKey } from "@/lib/orcamento/indices";
import { getCategoriasOrcamento } from "@/lib/orcamento/actions/categoria-metodo";
import { travaDeFinalizacao } from "@/lib/orcamento/actions/finalizacao";
import {
  getValorFixoCategorias,
  saveValorFixoContrato,
} from "@/lib/orcamento/actions/valor-fixo";
import {
  jaContratado,
  juntarFornecedores,
  ordenarSugeridos,
  sugerirFornecedor,
  type FornecedorAcumulado,
  type FornecedorSugerido,
} from "@/lib/orcamento/valor-fixo-fornecedores";

// Puxar os fornecedores do ano-base para o Valor fixo — ver
// `valor-fixo-fornecedores.ts` (a regra) e o topo daquele arquivo (o porquê).
// A PRÉVIA não grava nada; a IMPORTAÇÃO grava contrato a contrato pela MESMA
// action da tela (`saveValorFixoContrato`), então valem as mesmas travas
// (finalização, setor, papel) e a mesma trilha.

export interface FornecedorDaPrevia extends FornecedorSugerido {
  /** Já existe contrato com este fornecedor na categoria (casado pelo nome). */
  jaCadastrado: boolean;
}

export interface CategoriaDaPrevia {
  categoryCode: string;
  categoryName: string;
  /** Mensagem de trava (finalizada), ou `null` quando aceita contrato novo. */
  fechada: string | null;
  fornecedores: FornecedorDaPrevia[];
}

export interface PreviaFornecedores {
  baseYear: number;
  /** Meses fechados do ano-base considerados (o mês em curso fica de fora). */
  mesesFechados: number;
  categorias: CategoriaDaPrevia[];
}

type Supabase = NonNullable<ReturnType<typeof createAdminClientIfAvailable>>;

/** Gate comum: quem edita o Valor fixo, num setor de verdade. */
async function autorizar(companyId: string, year: number, setorId: string | null) {
  if (!companyId) return { error: "Selecione uma empresa." } as const;
  if (!isValidBudgetYear(year)) return { error: "Ano do orçamento inválido." } as const;
  if (isTodosSetores(setorId)) {
    return { error: "Escolha um setor — os contratos entram no setor da tela." } as const;
  }
  const supabase = (createAdminClientIfAvailable() ?? (await createClient())) as Supabase;
  const auth = await autorizarEscrita(supabase, companyId, year);
  if (!auth.ok) return { error: auth.error } as const;
  if (!podeEditarMetodo(auth.user.papel, "valor_fixo")) return { error: SEM_EDICAO_METODO } as const;
  return { supabase } as const;
}

/**
 * O acumulado de UM código: uma chamada por mês fechado (o "total até o mês k"
 * da leitura do realizado), em paralelo. Falha de leitura vira lista vazia —
 * a prévia mostra a categoria sem fornecedores em vez de cair inteira.
 */
async function acumuladoDoCodigo(
  supabase: Supabase,
  companyId: string,
  baseYear: number,
  code: string,
  meses: number,
): Promise<FornecedorAcumulado[]> {
  const ks = Array.from({ length: Math.max(1, meses) }, (_, i) => i + 1);
  const respostas = await Promise.all(
    ks.map((k) =>
      supabase.rpc("orcamento_planejamento_realizado_itens", {
        p_company_id: companyId,
        p_base_year: baseYear,
        p_category_code: code,
        p_meses_fechados: k,
      }),
    ),
  );
  if (respostas.some((r) => r.error)) return [];

  const porNome = new Map<string, FornecedorAcumulado>();
  respostas.forEach((r, idx) => {
    ((r.data ?? []) as Array<Record<string, unknown>>).forEach((row) => {
      const nome = String(row.fornecedor ?? "").trim();
      if (!nome) return;
      let f = porNome.get(nome);
      if (!f) {
        f = { fornecedor: nome, total: Math.abs(Number(row.total) || 0), acumulado: Array(ks.length).fill(0) };
        porNome.set(nome, f);
      }
      f.acumulado[idx] = Math.abs(Number(row.total_fechado) || 0);
    });
  });
  // Sem mês fechado (ano-base ainda em janeiro), o "acumulado" de k=1 não diz
  // nada fechado: zera, e o valor sai do mês em curso.
  if (meses === 0) porNome.forEach((f) => (f.acumulado = []));
  return Array.from(porNome.values());
}

/** Os fornecedores do ano-base, por categoria do Valor fixo na tela. */
export async function previaFornecedoresValorFixo(
  companyId: string,
  year: number,
  setorId: string | null,
): Promise<{ data?: PreviaFornecedores; error?: string }> {
  const gate = await autorizar(companyId, year, setorId);
  if ("error" in gate) return { error: gate.error };
  const { supabase } = gate;

  const [setup, cats] = await Promise.all([
    getValorFixoCategorias(companyId, year, setorId),
    getCategoriasOrcamento(companyId, year),
  ]);
  if (setup.error || !setup.setup) return { error: setup.error ?? "Não consegui ler o Valor fixo." };
  const codigosDe = new Map((cats.items ?? []).map((c) => [c.categoryCode, c.codigos]));

  const baseYear = year - 1;
  const meses = mesesFechados(baseYear);
  const categorias: CategoriaDaPrevia[] = [];
  // Uma categoria por vez (os meses dela em paralelo): dezenas de chamadas
  // simultâneas por clique não ganham nada e pesam no banco.
  for (const item of setup.setup.items) {
    const codigos = codigosDe.get(item.categoryCode) ?? [item.categoryCode];
    const listas = [];
    for (const code of codigos) {
      listas.push(await acumuladoDoCodigo(supabase, companyId, baseYear, code, meses));
    }
    const descricoes = item.contratos.map((c) => c.descricao);
    const fornecedores = ordenarSugeridos(
      juntarFornecedores(listas).map(sugerirFornecedor),
    ).map((f) => ({ ...f, jaCadastrado: jaContratado(f.fornecedor, descricoes) }));
    const fechada = await travaDeFinalizacao({
      companyId,
      year,
      metodo: "valor_fixo",
      categoryCode: item.categoryCode,
      setorId,
    });
    categorias.push({
      categoryCode: item.categoryCode,
      categoryName: item.categoryName,
      fechada,
      fornecedores,
    });
  }

  return { data: { baseYear, mesesFechados: meses, categorias } };
}

export interface ImportarFornecedorItem {
  categoryCode: string;
  categoryName: string;
  fornecedor: string;
  valorBase: number | null;
}

/**
 * Cria um contrato por fornecedor escolhido. Grava pela action da tela, um a
 * um: falha POR ITEM (uma categoria finalizada não custa as outras), e o
 * fornecedor que já virou contrato — outra aba, duplo clique — é pulado.
 */
export async function importarFornecedoresValorFixo(
  companyId: string,
  year: number,
  setorId: string | null,
  itens: ImportarFornecedorItem[],
  /** Índice e mês do reajuste para TODOS os importados (opcionais). */
  correcao: { indiceKey: IndiceKey | null; mesReajuste: number | null },
): Promise<{
  criados?: number;
  pulados?: number;
  falhas?: { fornecedor: string; categoryName: string; erro: string }[];
  error?: string;
}> {
  const gate = await autorizar(companyId, year, setorId);
  if ("error" in gate) return { error: gate.error };
  if (itens.length === 0) return { criados: 0, pulados: 0, falhas: [] };
  const indiceKey =
    correcao.indiceKey && INDICES.some((i) => i.key === correcao.indiceKey)
      ? correcao.indiceKey
      : null;
  const mes = correcao.mesReajuste;
  const mesReajuste = mes != null && Number.isInteger(mes) && mes >= 1 && mes <= 12 ? mes : null;

  // Releitura do que já existe: a prévia pode ter ficado velha.
  const setup = await getValorFixoCategorias(companyId, year, setorId);
  const existentes = new Map(
    (setup.setup?.items ?? []).map((i) => [i.categoryCode, i.contratos.map((c) => c.descricao)]),
  );

  let criados = 0;
  let pulados = 0;
  const falhas: { fornecedor: string; categoryName: string; erro: string }[] = [];
  for (const it of itens) {
    const doCode = existentes.get(it.categoryCode) ?? [];
    if (jaContratado(it.fornecedor, doCode)) {
      pulados += 1;
      continue;
    }
    const res = await saveValorFixoContrato(
      companyId,
      year,
      it.categoryCode,
      it.categoryName,
      {
        id: null,
        descricao: it.fornecedor.slice(0, 200),
        valorBase: it.valorBase,
        indiceKey,
        mesReajuste,
        valorNegociado: null,
      },
      true,
      setorId,
    );
    if (res.error || res.needsMigration) {
      falhas.push({
        fornecedor: it.fornecedor,
        categoryName: it.categoryName,
        erro: res.error ?? "Migration pendente.",
      });
      continue;
    }
    criados += 1;
    doCode.push(it.fornecedor);
    existentes.set(it.categoryCode, doCode);
  }
  return { criados, pulados, falhas };
}
