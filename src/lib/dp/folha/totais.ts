// ============================================================================
// TOTAIS da folha gerencial — puro e testado. É a aba TOTAIS da planilha do
// DP: as mesmas categorias, somadas por SETOR, por EMPRESA registrada e (o que
// a planilha não tinha) por CENTRO DE CUSTO.
//
// Na planilha cada célula era um SOMASE escrito à mão, e 20 delas apontavam
// para o cabeçalho da coluna VIZINHA (ex.: as férias de "ADM FRANQUEADORA"
// somando o 1/3 de "CASH IN"; ticket, odonto e férias de SGX, Dataforte, UTB,
// Celebrate e Oliveira Medeiros somando a empresa ao lado). Aqui o agrupamento
// é um só, para todas as categorias — não existe célula para apontar errado.
// ============================================================================

import type { DpFolhaResultado } from "@/lib/dp/folha/motor";

export const CATEGORIAS_TOTAIS = [
  "salario",
  "homeOffice",
  "metas",
  "valeTransporte",
  "cartaoBeneficio",
  "valeGasolina",
  "alimentacao",
  "odonto",
  "planoSaude",
  "coparticipacao",
  "fgts",
  "inss",
  "irrf",
  "ferias",
  "inssFerias",
  "indenizacoes",
] as const;
export type DpCategoriaTotal = (typeof CATEGORIAS_TOTAIS)[number];

export const ROTULO_CATEGORIA: Record<DpCategoriaTotal, string> = {
  salario: "Salário (líquido)",
  homeOffice: "Auxílio home office",
  metas: "Metas / bônus",
  valeTransporte: "Vale-transporte",
  cartaoBeneficio: "Cartão benefício (alimentação + gasolina)",
  valeGasolina: "Vale-gasolina",
  alimentacao: "Alimentação",
  odonto: "Plano odontológico",
  planoSaude: "Plano de saúde — mensalidade",
  coparticipacao: "Plano de saúde — coparticipação",
  fgts: "FGTS",
  inss: "INSS (guia, já deduzidos salário-família e licença-maternidade)",
  irrf: "IRRF",
  ferias: "Férias + 1/3",
  inssFerias: "INSS das férias",
  indenizacoes: "Indenizações, acertos (rescisões)",
};

export const SEM_GRUPO = "Sem definição";

/** Valor de cada categoria para uma linha da folha (rescisões entram à parte). */
export function categoriasDaLinha(r: DpFolhaResultado): Record<Exclude<DpCategoriaTotal, "indenizacoes">, number> {
  // INSS da GUIA: o que se desconta menos o que a empresa compensa — salário-família
  // e o salário de quem está em licença-maternidade (pago pelo INSS). Regra da planilha.
  const licenca = r.situacao === "licenca_maternidade" ? r.saldo : 0;
  return {
    salario: r.saldo,
    homeOffice: r.homeOffice,
    metas: r.comissao,
    valeTransporte: r.valeTransporte,
    cartaoBeneficio: r.totalBeneficio,
    valeGasolina: r.valeGasolina,
    alimentacao: r.alimentacao,
    odonto: r.odonto,
    planoSaude: r.planoSaude,
    coparticipacao: r.coparticipacao,
    fgts: r.fgts,
    inss: r.inss - licenca - r.salarioFamilia,
    irrf: r.irrf,
    ferias: r.totalFerias,
    inssFerias: -r.inssFerias,
  };
}

export interface DpTotaisTabela {
  grupos: string[];
  linhas: Array<{ categoria: DpCategoriaTotal; valores: Record<string, number>; total: number }>;
  pessoas: Record<string, number>;
}

const r2 = (v: number) => Math.round((v + Number.EPSILON) * 100) / 100;

/**
 * Soma por grupo. Grupos em ordem alfabética (pt-BR), "Sem definição" por
 * último — mesma convenção do "Sem grupo" e do "Sem setor" do resto do sistema.
 */
export function totalizar(
  linhas: DpFolhaResultado[],
  grupoDe: (r: DpFolhaResultado) => string | null,
  rescisoes: Array<{ grupo: string | null; valor: number }> = [],
): DpTotaisTabela {
  const nome = (g: string | null) => (g && g.trim() ? g.trim() : SEM_GRUPO);
  const set = new Set<string>();
  const pessoas: Record<string, number> = {};
  for (const l of linhas) {
    const g = nome(grupoDe(l));
    set.add(g);
    pessoas[g] = (pessoas[g] ?? 0) + 1;
  }
  for (const r of rescisoes) set.add(nome(r.grupo));
  const grupos = Array.from(set).sort((a, b) =>
    a === SEM_GRUPO ? 1 : b === SEM_GRUPO ? -1 : a.localeCompare(b, "pt-BR"),
  );

  const acc = new Map<DpCategoriaTotal, Record<string, number>>();
  for (const c of CATEGORIAS_TOTAIS) acc.set(c, Object.fromEntries(grupos.map((g) => [g, 0])));
  for (const l of linhas) {
    const g = nome(grupoDe(l));
    const v = categoriasDaLinha(l);
    for (const [c, x] of Object.entries(v) as Array<[DpCategoriaTotal, number]>) {
      const m = acc.get(c)!;
      m[g] = r2(m[g] + x);
    }
  }
  const ind = acc.get("indenizacoes")!;
  for (const r of rescisoes) ind[nome(r.grupo)] = r2(ind[nome(r.grupo)] + r.valor);

  return {
    grupos,
    pessoas,
    linhas: CATEGORIAS_TOTAIS.map((categoria) => {
      const valores = acc.get(categoria)!;
      return { categoria, valores, total: r2(Object.values(valores).reduce((s, x) => s + x, 0)) };
    }),
  };
}
