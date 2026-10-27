// ============================================================================
// CUSTO COM COLABORADOR — puro e testado (27/10/2026). Quanto cada pessoa custa
// à empresa POR MÊS, com os valores FIXOS do cadastro, despesa a despesa:
//
//   SALÁRIOS    salário bruto (o salário + os proventos fixos do cadastro),
//               13º (1/12) e férias (1/36 — o terço);
//   ENCARGOS    INSS patronal, RAT × FAP, terceiros e FGTS, sobre o salário
//               bruto + 13º + férias;
//   BENEFÍCIOS  a parte da EMPRESA no plano de saúde, o vale-transporte
//               líquido do desconto, o vale-gasolina, a alimentação e o
//               auxílio home office.
//
// Regime de COMPETÊNCIA, com as MESMAS frações do Orçamento e das Simulações
// (FRACAO_DECIMO_MES, FRACAO_FERIAS_MES): o mês de férias já é um dos 12
// salários, então o que as férias custam A MAIS por mês é o terço ÷ 12. Somar
// também 1/12 do salário de férias contaria o mês de férias duas vezes.
//
// "Fixo" = o mês cheio, sem o variável do mês (faltas, comissão,
// coparticipação, férias programadas, ajustes manuais da folha). Os benefícios
// saem do MOTOR DA FOLHA rodado assim — a regra de cada benefício (desconto de
// VT, parte do plano paga pela empresa, alimentação) é uma só nas duas telas.
//
// Alíquotas: INSS patronal, RAT e terceiros do cadastro de encargos da empresa
// (o mesmo da tela de Impostos, das Simulações e do Orçamento); FGTS dos
// Parâmetros da folha (8%; aprendiz 2%), como a tela de Impostos. Estágio, PJ e
// sócio entram só com o valor e os benefícios — a regra da folha e das Simulações.
// ============================================================================

import { ultimoDia } from "@/lib/dp/folha/calendario";
import {
  calcularFolhaPessoa,
  LANCAMENTO_PADRAO,
  recorrentesDoMes,
  type DpContratoFolha,
  type DpFolhaEntrada,
} from "@/lib/dp/folha/motor";
import type { DpFolhaParametros } from "@/lib/dp/folha/parametros";
import { FRACAO_DECIMO_MES, FRACAO_FERIAS_MES, type EncargoValues } from "@/lib/orcamento/encargos";

export const COLUNAS_CUSTO = [
  "salario",
  "proventos",
  "decimo",
  "ferias",
  "inssPatronal",
  "rat",
  "terceiros",
  "fgts",
  "planoSaude",
  "valeTransporte",
  "valeGasolina",
  "alimentacao",
  "homeOffice",
] as const;
export type DpColunaCusto = (typeof COLUNAS_CUSTO)[number];

export type DpGrupoCusto = "salarios" | "encargos" | "beneficios";
export const GRUPOS_CUSTO: readonly DpGrupoCusto[] = ["salarios", "encargos", "beneficios"];

export const GRUPO_DA_COLUNA: Record<DpColunaCusto, DpGrupoCusto> = {
  salario: "salarios",
  proventos: "salarios",
  decimo: "salarios",
  ferias: "salarios",
  inssPatronal: "encargos",
  rat: "encargos",
  terceiros: "encargos",
  fgts: "encargos",
  planoSaude: "beneficios",
  valeTransporte: "beneficios",
  valeGasolina: "beneficios",
  alimentacao: "beneficios",
  homeOffice: "beneficios",
};

export const ROTULO_COLUNA_CUSTO: Record<DpColunaCusto, string> = {
  salario: "Salário",
  proventos: "Proventos fixos",
  decimo: "13º",
  ferias: "Férias (1/3)",
  inssPatronal: "INSS patronal",
  rat: "RAT × FAP",
  terceiros: "Terceiros",
  fgts: "FGTS",
  planoSaude: "Plano de saúde",
  valeTransporte: "Vale-transporte",
  valeGasolina: "Vale-gasolina",
  alimentacao: "Alimentação",
  homeOffice: "Home office",
};

export const ROTULO_GRUPO_CUSTO: Record<DpGrupoCusto, string> = {
  salarios: "Salários",
  encargos: "Encargos",
  beneficios: "Benefícios",
};

export const ROTULO_CONTRATO_CUSTO: Record<DpContratoFolha, string> = {
  clt: "CLT",
  aprendiz: "Jovem aprendiz",
  estagio: "Estágio",
  prestador: "PJ / prestador",
  socio: "Sócio",
  outro: "Sem tipo (como CLT)",
};

export interface DpCustoColaborador extends Record<DpColunaCusto, number> {
  solidesId: number;
  nome: string;
  setor: string | null;
  centroCusto: string | null;
  contrato: DpContratoFolha;
  salarios: number;
  encargos: number;
  beneficios: number;
  total: number;
  /** Como o tipo de contrato entra na conta — a primeira linha da memória. */
  regime: string;
  memoria: Partial<Record<DpColunaCusto, string>>;
  avisos: string[];
}

const r2 = (v: number) => Math.round((v + Number.EPSILON) * 100) / 100;
const brl = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const n = (v: number) => v.toLocaleString("pt-BR", { maximumFractionDigits: 2 });
const pct = (v: number) => `${n(v * 100)}%`;
const somarCols = (l: Record<DpColunaCusto, number>, grupo: DpGrupoCusto) =>
  r2(COLUNAS_CUSTO.filter((k) => GRUPO_DA_COLUNA[k] === grupo).reduce((s, k) => s + l[k], 0));

/**
 * Quem entra: a população da folha do mês MENOS quem sai nele. O custo é o da
 * posição que continua; o desligado do mês vai na rescisão, não aqui.
 */
export function ativoNoCusto(desligamento: string | null, competencia: string): boolean {
  return !desligamento || desligamento > ultimoDia(competencia);
}

function regimeDe(contrato: DpContratoFolha): string {
  switch (contrato) {
    case "clt":
      return "CLT: salário, 13º, férias e encargos, mais os benefícios.";
    case "aprendiz":
      return "Jovem aprendiz: como CLT, com FGTS reduzido.";
    case "outro":
      return "Sem tipo de contrato na Sólides — calculado como CLT (na dúvida, o custo sai maior, não menor).";
    case "estagio":
      return "Estágio: a bolsa e os benefícios — sem 13º, terço de férias e encargos (regra da folha e das Simulações).";
    case "prestador":
      return "PJ / prestador: o valor do contrato e os benefícios — sem 13º, férias e encargos.";
    case "socio":
      return "Sócio: tratado como PJ, como na folha — o valor e os benefícios, sem 13º, férias e encargos.";
  }
}

/** O custo mensal fixo de uma pessoa, coluna a coluna, com a memória de cada valor. */
export function custoDoColaborador(e: DpFolhaEntrada, p: DpFolhaParametros, enc: EncargoValues, competencia: string): DpCustoColaborador {
  // O motor da folha com o mês cheio e sem o variável: é dele que saem os benefícios.
  const r = calcularFolhaPessoa(
    {
      ...e,
      admissao: null,
      desligamento: null,
      desligamentoEstimado: false,
      cadastro: { ...e.cadastro, ferias: [] },
      lancamento: { ...LANCAMENTO_PADRAO, ajustes: {} },
    },
    p,
    competencia,
  );
  const memoria: DpCustoColaborador["memoria"] = {};
  const clt = e.contrato === "clt" || e.contrato === "aprendiz" || e.contrato === "outro";

  // SALÁRIOS
  const salario = r2(Math.max(0, e.salario ?? 0));
  memoria.salario =
    e.salario === null ? "Sem salário na Sólides — considerado zero." : `Salário${e.salarioOrigem ? ` (${e.salarioOrigem})` : " da Sólides"}, mês cheio.`;
  const fixos = recorrentesDoMes(e.cadastro.recorrentes, competencia).filter((x) => x.tipo === "provento");
  const proventos = r2(fixos.reduce((s, x) => s + x.valor, 0));
  if (proventos) memoria.proventos = `${fixos.map((x) => `${x.descricao}${x.parcela ? ` ${x.parcela}` : ""} ${brl(x.valor)}`).join(" + ")} (fixos do cadastro da folha).`;
  const bruto = r2(salario + proventos);
  const decimo = clt ? r2(bruto * FRACAO_DECIMO_MES) : 0;
  const ferias = clt ? r2(bruto * FRACAO_FERIAS_MES) : 0;
  if (clt && bruto) {
    memoria.decimo = `1/12 de ${brl(bruto)} (salário bruto) — o 13º por mês, na competência.`;
    memoria.ferias = `1/36 de ${brl(bruto)} — o terço de férias por mês (o mês de férias já é um dos 12 salários).`;
  }

  // ENCARGOS, sobre o salário bruto + 13º + férias
  const base = clt ? r2(bruto + decimo + ferias) : 0;
  const pctFgts = e.contrato === "aprendiz" ? p.fgtsAprendizPercentual : p.fgtsPercentual;
  const inssPatronal = r2((base * enc.inss_patronal) / 100);
  const rat = r2((base * enc.rat_fap) / 100);
  const terceiros = r2((base * enc.terceiros) / 100);
  const fgts = r2(base * pctFgts);
  const sobre = `${brl(base)} (salário bruto + 13º + férias)`;
  if (base) {
    memoria.inssPatronal = `${n(enc.inss_patronal)}% × ${sobre}.`;
    memoria.rat = `${n(enc.rat_fap)}% × ${sobre}.`;
    memoria.terceiros = `${n(enc.terceiros)}% × ${sobre}.`;
    memoria.fgts = `${pct(pctFgts)} × ${sobre}${e.contrato === "aprendiz" ? " — jovem aprendiz" : ""}.`;
  }

  // BENEFÍCIOS — o que a EMPRESA paga (o descontado do colaborador fica fora)
  const planoSaude = r2(r.planoEmpresa ?? 0);
  if (planoSaude) {
    memoria.planoSaude =
      "Ambulatorial do titular, pago pela empresa" +
      (r.planoSaude ? `; o resto do plano (${brl(r.planoSaude)}) é descontado do colaborador.` : ".");
  } else if (e.cadastro.planoSaude !== "nenhum" && r.memoria.planoSaude) {
    memoria.planoSaude = `${r.memoria.planoSaude} Nada fica com a empresa.`;
  }
  const valeTransporte = r2(Math.max(0, r.valeTransporte - r.vtDesconto));
  if (r.valeTransporte) {
    memoria.valeTransporte =
      (r.memoria.valeTransporte ?? "") +
      (r.vtDesconto ? ` Menos ${brl(r.vtDesconto)} descontados do colaborador: ${r.memoria.vtDesconto ?? ""}` : "");
  }
  const valeGasolina = r.valeGasolina;
  if (valeGasolina) memoria.valeGasolina = r.memoria.valeGasolina;
  const alimentacao = r.alimentacao;
  if (alimentacao) memoria.alimentacao = r.memoria.alimentacao;
  const homeOffice = r.homeOffice;
  if (homeOffice) memoria.homeOffice = "Auxílio fixo do cadastro da folha.";

  const valores: Record<DpColunaCusto, number> = {
    salario,
    proventos,
    decimo,
    ferias,
    inssPatronal,
    rat,
    terceiros,
    fgts,
    planoSaude,
    valeTransporte,
    valeGasolina,
    alimentacao,
    homeOffice,
  };
  const salarios = somarCols(valores, "salarios");
  const encargos = somarCols(valores, "encargos");
  const beneficios = somarCols(valores, "beneficios");
  return {
    solidesId: e.solidesId,
    nome: e.nome,
    setor: e.setor,
    centroCusto: e.centroCusto ?? null,
    contrato: e.contrato,
    ...valores,
    salarios,
    encargos,
    beneficios,
    total: r2(salarios + encargos + beneficios),
    regime: regimeDe(e.contrato),
    memoria,
    avisos: r.avisos,
  };
}

export interface DpResumoCusto {
  pessoas: number;
  salarios: number;
  encargos: number;
  beneficios: number;
  total: number;
}

/** Os cards: a soma das linhas recebidas (as que estão na tela). */
export function resumirCusto(linhas: DpCustoColaborador[]): DpResumoCusto {
  const soma = (k: "salarios" | "encargos" | "beneficios" | "total") => r2(linhas.reduce((s, l) => s + l[k], 0));
  return { pessoas: linhas.length, salarios: soma("salarios"), encargos: soma("encargos"), beneficios: soma("beneficios"), total: soma("total") };
}

/** Fração de `valor` no custo total da empresa; null quando a empresa não tem custo (não dá para dizer, não é zero). */
export function participacao(valor: number, totalEmpresa: number): number | null {
  return totalEmpresa > 0 ? valor / totalEmpresa : null;
}

/**
 * As colunas que a tabela mostra: as que têm valor em alguém da EMPRESA (não do
 * filtro — a coluna não pode aparecer e sumir conforme se filtra). Salário fica
 * sempre: sem ele a tabela não diz nada.
 */
export function colunasComValor(linhas: DpCustoColaborador[]): DpColunaCusto[] {
  return COLUNAS_CUSTO.filter((k) => k === "salario" || linhas.some((l) => l[k] !== 0));
}
