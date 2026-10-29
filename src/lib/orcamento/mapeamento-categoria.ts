// =============================================================================
// Mapeamento EFETIVO categoria → conta da DRE, visto pelo Orçamento.
//
// Uma categoria chega à DRE de uma empresa por TRÊS caminhos, e o Orçamento
// lia só dois deles (`category_mapping` da empresa e o global):
//
//   1. `category_mapping` com `company_id` = a empresa;
//   2. `routed_category_mapping` com `target_company_id` = a empresa — o de-para
//      dos DEPARTAMENTOS ROTEADOS de outra empresa ("Enviar para", na tela de
//      Departamentos), feito em Mapeamento › Departamentos roteados;
//   3. `category_mapping` global (`company_id` nulo).
//
// Empresa que não tem Omie própria e vive de departamento roteado (Salvaterra
// Estacionamento: o ESTACIONAMENTO da Salvaterra Mall e da Feat; Sirena: o
// SIRENA da Feat) tem a DRE inteira no caminho 2. Sem ele, "Método por
// categoria" mostrava só o punhado de categorias globais — nenhuma das que
// compõem a DRE dela (achado em 29/10/2026) — e a Prévia jogaria as que
// tivessem método em "categorias não mapeadas".
//
// ── Precedência: empresa > roteado > global ──────────────────────────────────
// O mapeamento da própria empresa vence: a mudança é ADITIVA, e nenhuma
// categoria que a empresa já mapeou muda de conta (conferido em 29/10/2026:
// nenhuma empresa tem o mesmo código mapeado para contas diferentes nos dois
// cadastros). O roteado vem antes do global porque é específico da empresa —
// é ele que a DRE usa para o lançamento roteado (prio 0 no refresh de
// `dre_monthly_aggregates`).
//
// Linha da empresa SEM conta (`dre_account_id` nulo) continua escondendo a
// global, como antes; o roteado passa por cima dela, como na DRE.
//
// ── Só rota ATIVA ────────────────────────────────────────────────────────────
// O de-para roteado só vale enquanto o departamento de origem ainda é enviado
// para a empresa: a DRE aplica `routed_category_mapping` só com a rota ligada.
// Linha de rota desfeita fica no banco sem efeito, e listá-la ofereceria
// método para categoria que não compõe mais a DRE.
// =============================================================================

import type { createClient } from "@/lib/supabase/server";

type Supabase = Awaited<ReturnType<typeof createClient>>;

/** Linha de `category_mapping`. */
export interface LinhaMapeamento {
  omie_category_code: string;
  omie_category_name: string | null;
  dre_account_id: string | null;
  company_id: string | null;
}

/** Linha de `routed_category_mapping` (já filtrada pela empresa de destino). */
export interface LinhaRoteada {
  source_company_id: string;
  omie_department_code: string;
  omie_category_code: string;
  omie_category_name: string | null;
  dre_account_id: string | null;
}

/** Departamento de outra empresa enviado PARA esta (`company_departments`). */
export interface RotaAtiva {
  /** Empresa de ORIGEM. */
  company_id: string;
  omie_code: string;
}

export type OrigemMapeamento = "empresa" | "roteado" | "global";

export interface MapeamentoEfetivo {
  dreAccountId: string | null;
  /** Nome da categoria na Omie, quando o cadastro o traz. */
  nome: string | null;
  origem: OrigemMapeamento;
}

const chaveRota = (empresa: string, departamento: string) => `${empresa}|${departamento}`;

/**
 * Resolve, por código de categoria, a conta da DRE que vale para `companyId`.
 * Pura — a leitura das três tabelas é `lerMapeamentoEfetivo`.
 */
export function resolverMapeamento(
  companyId: string,
  mapeamentos: readonly LinhaMapeamento[],
  roteados: readonly LinhaRoteada[],
  rotas: readonly RotaAtiva[],
): Map<string, MapeamentoEfetivo> {
  const daEmpresa = new Map<string, LinhaMapeamento>();
  const global = new Map<string, LinhaMapeamento>();
  for (const m of mapeamentos) {
    if (m.company_id === companyId) {
      if (!daEmpresa.has(m.omie_category_code)) daEmpresa.set(m.omie_category_code, m);
    } else if (m.company_id == null) {
      if (!global.has(m.omie_category_code)) global.set(m.omie_category_code, m);
    }
  }

  const ativas = new Set(rotas.map((r) => chaveRota(r.company_id, r.omie_code)));
  // Ordem estável: com dois de-paras do mesmo código (origens diferentes), o
  // escolhido não pode depender da ordem em que o banco devolveu as linhas.
  const roteadosAtivos = roteados
    .filter((r) => r.dre_account_id && ativas.has(chaveRota(r.source_company_id, r.omie_department_code)))
    .slice()
    .sort(
      (a, b) =>
        a.source_company_id.localeCompare(b.source_company_id) ||
        a.omie_department_code.localeCompare(b.omie_department_code),
    );
  const roteado = new Map<string, LinhaRoteada>();
  for (const r of roteadosAtivos) {
    if (!roteado.has(r.omie_category_code)) roteado.set(r.omie_category_code, r);
  }

  const codigos = new Set<string>(
    Array.from(daEmpresa.keys()).concat(Array.from(roteado.keys()), Array.from(global.keys())),
  );
  const efetivo = new Map<string, MapeamentoEfetivo>();
  codigos.forEach((code) => {
    const emp = daEmpresa.get(code);
    const rot = roteado.get(code);
    const glo = global.get(code);
    if (emp?.dre_account_id) {
      efetivo.set(code, { dreAccountId: emp.dre_account_id, nome: emp.omie_category_name, origem: "empresa" });
    } else if (rot) {
      efetivo.set(code, { dreAccountId: rot.dre_account_id, nome: rot.omie_category_name, origem: "roteado" });
    } else if (emp) {
      // Linha da empresa sem conta: esconde a global, como sempre escondeu.
      efetivo.set(code, { dreAccountId: null, nome: emp.omie_category_name, origem: "empresa" });
    } else if (glo) {
      efetivo.set(code, { dreAccountId: glo.dre_account_id, nome: glo.omie_category_name, origem: "global" });
    }
  });
  return efetivo;
}

/**
 * Lê as três fontes e resolve. `codigos` restringe a leitura (a Prévia só
 * precisa das categorias orçadas); sem ele, vem tudo o que vale para a empresa.
 */
export async function lerMapeamentoEfetivo(
  supabase: Supabase,
  companyId: string,
  codigos?: readonly string[],
): Promise<{ mapa: Map<string, MapeamentoEfetivo>; error?: undefined } | { mapa?: undefined; error: string }> {
  if (codigos && codigos.length === 0) return { mapa: new Map() };

  let qMap = supabase
    .from("category_mapping")
    .select("omie_category_code, omie_category_name, dre_account_id, company_id")
    .or(`company_id.eq.${companyId},company_id.is.null`);
  if (codigos) qMap = qMap.in("omie_category_code", codigos as string[]);
  const { data: mapeamentos, error: mapErr } = await qMap;
  if (mapErr) return { error: mapErr.message };

  const { data: rotas, error: rotaErr } = await supabase
    .from("company_departments")
    .select("company_id, omie_code")
    .eq("routed_to_company_id", companyId);
  if (rotaErr) return { error: rotaErr.message };

  let roteados: LinhaRoteada[] = [];
  if ((rotas ?? []).length > 0) {
    let qRot = supabase
      .from("routed_category_mapping")
      .select("source_company_id, omie_department_code, omie_category_code, omie_category_name, dre_account_id")
      .eq("target_company_id", companyId);
    if (codigos) qRot = qRot.in("omie_category_code", codigos as string[]);
    const { data, error } = await qRot;
    if (error) return { error: error.message };
    roteados = (data ?? []) as LinhaRoteada[];
  }

  return {
    mapa: resolverMapeamento(
      companyId,
      (mapeamentos ?? []) as LinhaMapeamento[],
      roteados,
      (rotas ?? []) as RotaAtiva[],
    ),
  };
}
