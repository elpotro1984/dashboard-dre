// ============================================================================
// IMPOSTOS da folha gerencial — puro e testado. A tela "Impostos" do DP olha a
// folha do mês pelo lado de cada tributo: a base, o valor e a memória de
// cálculo de cada pessoa, o total a recolher e o que a EMPRESA paga por cima
// (INSS patronal, RAT × FAP, terceiros).
//
// O lado do EMPREGADO (INSS, IRRF, FGTS, salário-família) não é recalculado
// aqui: é o resultado do motor (folha/motor.ts), com os ajustes manuais — a
// tela de Impostos e a Folha não podem discordar. A guia do INSS usa a mesma
// regra dos Totais (`categoriasDaLinha`), pelo mesmo motivo.
//
// O PATRONAL é estimativa gerencial: base × alíquotas do cadastro de encargos
// (o mesmo que as Simulações do DP e o Orçamento usam). Não incide em quem
// está em licença-maternidade (STF, Tema 72) nem fora da CLT.
// ============================================================================

import type { DpColunaAjustavel, DpFolhaResultado } from "@/lib/dp/folha/motor";
import { categoriasDaLinha } from "@/lib/dp/folha/totais";
import type { EncargoValues } from "@/lib/orcamento/encargos";

export type DpImposto = "inss" | "irrf" | "fgts" | "salarioFamilia" | "patronal";

export const ROTULO_IMPOSTO: Record<DpImposto, string> = {
  inss: "INSS",
  irrf: "IRRF",
  fgts: "FGTS",
  salarioFamilia: "Salário-família",
  patronal: "Encargos da empresa",
};

/** Onde um valor manual entra: o ajuste da coluna do motor, ou o INSS do recibo de férias (campo do lançamento). */
export type DpAlvoImposto = Extract<DpColunaAjustavel, "inss" | "irrf" | "fgts" | "salarioFamilia"> | "inssFerias";
export const ALVOS_IMPOSTO: readonly DpAlvoImposto[] = ["inss", "irrf", "fgts", "salarioFamilia", "inssFerias"];

export interface DpLinhaImposto {
  solidesId: number;
  nome: string;
  setor: string | null;
  base: number;
  valor: number;
  /** O que o sistema calcularia; difere de `valor` quando há ajuste manual. */
  calculado: number;
  ajustado: boolean;
  memoria: string;
  /** Só no INSS: o que já foi descontado no recibo de férias (positivo). */
  inssFerias: number;
}

export interface DpPatronalPessoa {
  solidesId: number;
  nome: string;
  setor: string | null;
  base: number;
  inssPatronal: number;
  rat: number;
  terceiros: number;
  total: number;
  memoria: string;
}

const r2 = (v: number) => Math.round((v + Number.EPSILON) * 100) / 100;
const brl = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const n = (v: number) => v.toLocaleString("pt-BR", { maximumFractionDigits: 2 });
const porNome = <T extends { nome: string }>(a: T, b: T) => a.nome.localeCompare(b.nome, "pt-BR");

/** Base de um imposto; folha fechada antes de o motor gravar `bases` cai na conta equivalente. */
export function baseDe(r: DpFolhaResultado, k: "inss" | "irrf" | "fgts" | "patronal"): number {
  if (r.bases) return r.bases[k];
  const bruta = r2(r.salarioMes + r.totalFerias);
  if (k === "irrf") return r.irrf !== 0 ? r.salarioMes : 0;
  if (k === "patronal") return r.fgts !== 0 && r.situacao !== "licenca_maternidade" ? bruta : 0;
  return r[k] !== 0 ? bruta : 0;
}

/**
 * As pessoas de um imposto do empregado: base, valor (com ajuste manual, se
 * houver), o calculado e a memória do motor. Fica de fora só quem não tem base
 * nem valor (estágio no INSS, PJ no FGTS…), para a tabela listar quem paga.
 */
export function linhasDoImposto(linhas: DpFolhaResultado[], imposto: Exclude<DpImposto, "patronal">): DpLinhaImposto[] {
  return linhas
    .map((r) => {
      const ajuste = r.ajustados?.[imposto];
      const valor = r[imposto];
      const base = imposto === "salarioFamilia" ? r.salarioCarteira : baseDe(r, imposto);
      return {
        solidesId: r.solidesId,
        nome: r.nome,
        setor: r.setor,
        base,
        valor,
        calculado: ajuste ?? valor,
        ajustado: ajuste !== undefined,
        memoria: r.memoria?.[imposto] ?? "",
        inssFerias: imposto === "inss" ? -r.inssFerias : 0,
      };
    })
    .filter((l) => (imposto === "salarioFamilia" ? l.valor !== 0 || l.ajustado || l.memoria !== "" : l.base > 0 || l.valor !== 0 || l.ajustado))
    .sort(porNome);
}

/** Encargos da empresa por pessoa: base × alíquotas (pontos percentuais, como no cadastro). */
export function patronalPorPessoa(linhas: DpFolhaResultado[], e: EncargoValues): DpPatronalPessoa[] {
  return linhas
    .map((r) => {
      const base = baseDe(r, "patronal");
      const inssPatronal = r2((base * e.inss_patronal) / 100);
      const rat = r2((base * e.rat_fap) / 100);
      const terceiros = r2((base * e.terceiros) / 100);
      return {
        solidesId: r.solidesId,
        nome: r.nome,
        setor: r.setor,
        base,
        inssPatronal,
        rat,
        terceiros,
        total: r2(inssPatronal + rat + terceiros),
        memoria:
          `${brl(base)} (salário do mês + férias) × ${n(e.inss_patronal)}% INSS patronal + ${n(e.rat_fap)}% RAT × FAP + ` +
          `${n(e.terceiros)}% terceiros = ${brl(r2(inssPatronal + rat + terceiros))}.`,
      };
    })
    .filter((p) => p.base > 0)
    .sort(porNome);
}

export interface DpResumoImpostos {
  /** INSS descontado dos empregados no mês, inclusive o do recibo de férias. */
  inssDescontado: number;
  /** Deduzidos da guia (regra da planilha, a mesma dos Totais). */
  salarioFamilia: number;
  licenca: number;
  inssEmpregadosGuia: number;
  patronal: { base: number; inss: number; rat: number; terceiros: number; total: number };
  /** Empregados + empresa: o INSS da guia do mês. */
  inssGuia: number;
  fgts: number;
  fgtsBase: number;
  irrf: number;
  irrfBase: number;
  /** Pessoas com algum imposto ajustado à mão. */
  comAjuste: number;
}

/** O que recolher no mês: as guias de INSS, FGTS e IRRF da empresa, a partir das mesmas linhas da folha. */
export function resumirImpostos(linhas: DpFolhaResultado[], e: EncargoValues): DpResumoImpostos {
  let inssDescontado = 0;
  let salarioFamilia = 0;
  let licenca = 0;
  let inssEmpregadosGuia = 0;
  let fgts = 0;
  let fgtsBase = 0;
  let irrf = 0;
  let irrfBase = 0;
  let comAjuste = 0;
  for (const r of linhas) {
    inssDescontado += r.inss;
    salarioFamilia += r.salarioFamilia;
    if (r.situacao === "licenca_maternidade") licenca += r.saldo;
    inssEmpregadosGuia += categoriasDaLinha(r).inss;
    fgts += r.fgts;
    fgtsBase += baseDe(r, "fgts");
    irrf += r.irrf;
    irrfBase += baseDe(r, "irrf");
    if (["inss", "irrf", "fgts", "salarioFamilia"].some((k) => r.ajustados?.[k as DpColunaAjustavel] !== undefined)) comAjuste++;
  }
  const pat = patronalPorPessoa(linhas, e);
  const patronal = {
    base: r2(pat.reduce((s, p) => s + p.base, 0)),
    inss: r2(pat.reduce((s, p) => s + p.inssPatronal, 0)),
    rat: r2(pat.reduce((s, p) => s + p.rat, 0)),
    terceiros: r2(pat.reduce((s, p) => s + p.terceiros, 0)),
    total: r2(pat.reduce((s, p) => s + p.total, 0)),
  };
  return {
    inssDescontado: r2(inssDescontado),
    salarioFamilia: r2(salarioFamilia),
    licenca: r2(licenca),
    inssEmpregadosGuia: r2(inssEmpregadosGuia),
    patronal,
    inssGuia: r2(inssEmpregadosGuia + patronal.total),
    fgts: r2(fgts),
    fgtsBase: r2(fgtsBase),
    irrf: r2(irrf),
    irrfBase: r2(irrfBase),
    comAjuste,
  };
}
