// ============================================================================
// 13º SALÁRIO da folha gerencial — puro e testado. Mesma natureza da folha do
// mês: é CONFERÊNCIA (a contabilidade calcula o oficial), então cada número
// leva a sua memória de cálculo.
//
//  - AVOS: um por mês do ano com 15 dias ou mais de contrato (Lei 4.090/1962,
//    art. 1º §2º). Mês em que a folha marcou a pessoa como AFASTADA não conta:
//    o 13º daquele período é o abono anual pago pelo INSS. Quem está ativo tem
//    os meses que faltam projetados (o 13º é pago antes de dezembro acabar).
//  - 1ª PARCELA (até 30/11): metade de base ÷ 12 × avos, sem INSS nem IRRF;
//    FGTS no mês do pagamento. Paga nas férias (a pessoa pediu em janeiro) =
//    nada a pagar em novembro.
//  - 2ª PARCELA (até 20/12): o 13º inteiro menos a 1ª, o INSS do 13º (cálculo
//    à parte, tabela própria) e o IRRF de tributação EXCLUSIVA — dedução legal
//    ou desconto simplificado (IN RFB 2.141/2023) e o redutor da Lei
//    15.270/2025, que o §3º do art. 3º-A manda aplicar também ao 13º.
//  - Fechada a 1ª parcela, a 2ª desconta o valor do RETRATO, não um recálculo:
//    se o salário subir em dezembro, a 1ª que foi paga continua sendo a que foi
//    paga.
//
// Fora daqui: estágio (sem 13º, Lei 11.788/2008), PJ e sócio (a planilha os
// trata como PJ) e quem foi desligado no ano — o 13º proporcional dele vai na
// rescisão (rescisao.ts).
// ============================================================================

import { diasCorridos, feriadosNacionais, feriasDoMes, intervaloNoMes, type DpPeriodoFerias } from "@/lib/dp/folha/calendario";
import { calcularInss, calcularIrrf, type DpContratoFolha } from "@/lib/dp/folha/motor";
import type { DpFolhaParametros } from "@/lib/dp/folha/parametros";

export const DIAS_MINIMOS_AVO = 15;

export const DP13_AJUSTAVEIS = ["avos", "base", "inss", "irrf"] as const;
export type Dp13Ajustavel = (typeof DP13_AJUSTAVEIS)[number];
export type Dp13Ajustes = Partial<Record<Dp13Ajustavel, { valor: number; motivo: string }>>;

export const ROTULO_13: Record<Dp13Ajustavel | "integral" | "primeira" | "segunda" | "fgts", string> = {
  avos: "Avos",
  base: "Base (salário + médias)",
  integral: "13º integral",
  primeira: "1ª parcela",
  inss: "INSS do 13º",
  irrf: "IRRF do 13º",
  segunda: "2ª parcela (líquida)",
  fgts: "FGTS",
};

const MESES = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
const r2 = (v: number) => Math.round((v + Number.EPSILON) * 100) / 100;
const brl = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const pct = (v: number) => `${(v * 100).toLocaleString("pt-BR", { maximumFractionDigits: 2 })}%`;
const ddmm = (ymd: string) => `${ymd.slice(8, 10)}/${ymd.slice(5, 7)}`;
const comp = (ano: number, mes: number) => `${ano}-${String(mes).padStart(2, "0")}`;

export interface DpMesAvo {
  competencia: string;
  conta: boolean;
  /** Por que NÃO conta (vazio quando conta). */
  motivo: string;
}

/**
 * Os avos do ano até `ateMes`: um por mês com 15 dias ou mais de contrato e
 * sem afastamento. `desligamento` nulo = contrato segue (meses futuros contam).
 */
export function avosNoAno(input: {
  admissao: string | null;
  desligamento: string | null;
  ano: number;
  ateMes: number;
  afastados?: ReadonlySet<string>;
}): { avos: number; meses: DpMesAvo[] } {
  const meses: DpMesAvo[] = [];
  for (let m = 1; m <= input.ateMes; m++) {
    const c = comp(input.ano, m);
    const iv = intervaloNoMes(input.admissao, input.desligamento, c);
    if (!iv) {
      meses.push({ competencia: c, conta: false, motivo: "fora do contrato" });
      continue;
    }
    const dias = diasCorridos(iv.ini, iv.fim);
    if (input.afastados?.has(c)) meses.push({ competencia: c, conta: false, motivo: "afastado (o INSS paga o abono do período)" });
    else if (dias < DIAS_MINIMOS_AVO) meses.push({ competencia: c, conta: false, motivo: `${dias} dia(s) de contrato no mês` });
    else meses.push({ competencia: c, conta: true, motivo: "" });
  }
  return { avos: meses.filter((x) => x.conta).length, meses };
}

/** "jan a dez" / "mar a dez; fora: fev (10 dia(s) de contrato no mês)". */
export function descreverAvos(meses: DpMesAvo[]): string {
  const contam = meses.filter((x) => x.conta).map((x) => Number(x.competencia.slice(5, 7)));
  const faixas: string[] = [];
  for (let i = 0; i < contam.length; i++) {
    const ini = contam[i];
    while (i + 1 < contam.length && contam[i + 1] === contam[i] + 1) i++;
    faixas.push(ini === contam[i] ? MESES[ini - 1] : `${MESES[ini - 1]} a ${MESES[contam[i] - 1]}`);
  }
  // Só os meses dentro do contrato que ficaram de fora explicam algo; "fora do contrato" é óbvio.
  const fora = meses.filter((x) => !x.conta && x.motivo !== "fora do contrato").map((x) => `${MESES[Number(x.competencia.slice(5, 7)) - 1]} (${x.motivo})`);
  return `${faixas.length ? faixas.join(", ") : "nenhum mês"}${fora.length ? `; não contam: ${fora.join(", ")}` : ""}`;
}

/**
 * O que os LANÇAMENTOS do ano dizem para os avos: meses afastado (não contam),
 * em licença-maternidade (contam, com aviso) e meses em que os dias informados
 * mais as férias ficaram abaixo de 15 num mês em que o contrato tinha 15 ou
 * mais (pode ser falta injustificada — só o DP sabe, então vira aviso).
 * Lançamento sem dias informados é automático e não diz nada aqui.
 */
export function classificarMeses13(
  lancamentos: Array<{ competencia: string; situacao: string; diasTrabalhados: number | null; diasFerias: number | null }>,
  pessoa: { admissao: string | null; desligamento: string | null; ferias: DpPeriodoFerias[] },
): { afastados: string[]; licenca: string[]; poucosDias: string[] } {
  const afastados: string[] = [];
  const licenca: string[] = [];
  const poucosDias: string[] = [];
  for (const l of [...lancamentos].sort((a, b) => a.competencia.localeCompare(b.competencia))) {
    if (l.situacao === "afastado") afastados.push(l.competencia);
    else if (l.situacao === "licenca_maternidade") licenca.push(l.competencia);
    else if (l.diasTrabalhados !== null) {
      const iv = intervaloNoMes(pessoa.admissao, pessoa.desligamento, l.competencia);
      if (!iv || diasCorridos(iv.ini, iv.fim) < DIAS_MINIMOS_AVO) continue;
      const ferias = l.diasFerias ?? feriasDoMes(pessoa.ferias, l.competencia).dias;
      if (l.diasTrabalhados + ferias < DIAS_MINIMOS_AVO) poucosDias.push(l.competencia);
    }
  }
  return { afastados, licenca, poucosDias };
}

/**
 * Data-limite de pagamento de cada parcela: 30/11 e 20/12, antecipadas para o
 * último dia útil quando caem em fim de semana ou feriado nacional (o prazo é
 * "até", não "no").
 */
export function dataLimite13(ano: number, parcela: 1 | 2): string {
  const d = new Date(Date.UTC(ano, parcela === 1 ? 10 : 11, parcela === 1 ? 30 : 20));
  for (;;) {
    const dow = d.getUTCDay();
    const ymd = d.toISOString().slice(0, 10);
    if (dow !== 0 && dow !== 6 && !feriadosNacionais(ano).has(ymd)) return ymd;
    d.setUTCDate(d.getUTCDate() - 1);
  }
}

export interface Dp13Entrada {
  solidesId: number;
  nome: string;
  setor: string | null;
  contrato: DpContratoFolha;
  salario: number | null;
  admissao: string | null;
  desligamento: string | null;
  dependentesIr: number;
  semInss: boolean;
  /** Competências (AAAA-MM) do ano em que a folha marcou a pessoa como afastada / em licença-maternidade. */
  afastados: string[];
  licenca: string[];
  /** Competências em que os dias trabalhados informados (+ férias) ficaram abaixo de 15. */
  poucosDias: string[];
  /** 1ª parcela já paga nas férias (valor), ou null. */
  primeiraNasFerias: number | null;
  /**
   * A 1ª parcela da empresa está fechada? Então `primeiraFechada` é o valor do
   * retrato para esta pessoa (null = ela não estava no retrato: entrou depois).
   */
  primeiraEstaFechada: boolean;
  primeiraFechada: number | null;
  ajustes: Dp13Ajustes;
}

export interface Dp13Resultado {
  solidesId: number;
  nome: string;
  setor: string | null;
  contrato: DpContratoFolha;
  /** Sem 13º nesta tela (estágio, PJ, desligado no ano) — o motivo diz qual. */
  fora: string | null;
  salario: number;
  base: number;
  avosPrimeira: number;
  avosAno: number;
  integral: number;
  /** A pagar na 1ª parcela (zero quando já foi paga nas férias). */
  primeira: number;
  /** A 1ª que a 2ª desconta: o retrato, o pago nas férias ou o calculado. */
  primeiraConsiderada: number;
  inss: number;
  irrf: number;
  segunda: number;
  fgtsPrimeira: number;
  fgtsSegunda: number;
  fgts: number;
  /** 13º integral + FGTS: o custo da empresa (sem encargo patronal, como a folha do mês). */
  custo: number;
  meses: DpMesAvo[];
  memoria: Partial<Record<keyof typeof ROTULO_13, string>>;
  avisos: string[];
  ajustados: Partial<Record<Dp13Ajustavel, number>>;
}

const ZERO = {
  salario: 0,
  base: 0,
  avosPrimeira: 0,
  avosAno: 0,
  integral: 0,
  primeira: 0,
  primeiraConsiderada: 0,
  inss: 0,
  irrf: 0,
  segunda: 0,
  fgtsPrimeira: 0,
  fgtsSegunda: 0,
  fgts: 0,
  custo: 0,
};

export function calcular13(e: Dp13Entrada, p: DpFolhaParametros, ano: number): Dp13Resultado {
  const memoria: Dp13Resultado["memoria"] = {};
  const avisos: string[] = [];
  const ajustados: Dp13Resultado["ajustados"] = {};
  const cab = { solidesId: e.solidesId, nome: e.nome, setor: e.setor, contrato: e.contrato };
  const fimAno = `${ano}-12-31`;

  const fora = (motivo: string): Dp13Resultado => ({ ...cab, ...ZERO, fora: motivo, meses: [], memoria, avisos, ajustados });
  if (e.contrato === "estagio") return fora("Estágio não tem 13º (Lei 11.788/2008).");
  if (e.contrato === "prestador" || e.contrato === "socio") return fora("PJ / sócio: sem 13º na folha, como na planilha.");
  if (e.admissao && e.admissao > fimAno) return fora("Admissão depois do ano.");
  if (e.desligamento && e.desligamento <= fimAno) {
    const ja = e.primeiraNasFerias ?? (e.primeiraEstaFechada ? e.primeiraFechada : null);
    const r = fora(`Desligado em ${ddmm(e.desligamento)} — o 13º proporcional vai na rescisão.`);
    if (ja) r.avisos.push(`1ª parcela já paga (${brl(ja)}): desconte na rescisão.`);
    return r;
  }

  const aj = (k: Dp13Ajustavel, calculado: number): number => {
    const a = e.ajustes?.[k];
    if (!a || !Number.isFinite(a.valor)) return calculado;
    ajustados[k] = calculado;
    memoria[k] = `Ajuste manual: ${k === "avos" ? a.valor : brl(a.valor)}${a.motivo ? ` — ${a.motivo}` : ""}. Calculado: ${k === "avos" ? calculado : brl(calculado)}${memoria[k] ? ` (${memoria[k]})` : ""}`;
    return k === "avos" ? Math.max(0, Math.min(12, Math.round(a.valor))) : r2(a.valor);
  };

  if (e.contrato === "outro") avisos.push("Sem tipo de contrato na Sólides — calculado como CLT.");
  if (e.salario === null) avisos.push("Sem salário na Sólides — base zero.");
  if (!e.admissao) avisos.push("Sem data de admissão na Sólides — avos contados como se estivesse na empresa o ano todo.");
  const salario = e.salario ?? 0;
  memoria.base = `Salário de carteira da Sólides (${brl(salario)}). Média de variáveis (hora extra, adicional) não entra — ajuste a base se houver.`;
  const base = aj("base", r2(salario));

  const afastados = new Set(e.afastados);
  const ano12 = avosNoAno({ admissao: e.admissao, desligamento: e.desligamento, ano, ateMes: 12, afastados });
  memoria.avos = `${ano12.avos} avo(s): ${descreverAvos(ano12.meses)}.`;
  const avosAno = aj("avos", ano12.avos);
  const ate = p.decimoTerceiro.avosPrimeiraAte;
  const ateP = avosNoAno({ admissao: e.admissao, desligamento: e.desligamento, ano, ateMes: ate, afastados });
  const avosPrimeira = Math.min(ateP.avos, avosAno);

  for (const c of e.licenca) {
    avisos.push(`Licença-maternidade em ${MESES[Number(c.slice(5, 7)) - 1]}: o 13º do período é pago pela empresa e compensado na guia do INSS.`);
  }
  for (const c of e.poucosDias) {
    avisos.push(`Em ${MESES[Number(c.slice(5, 7)) - 1]} os dias trabalhados informados ficaram abaixo de 15 — se foram faltas injustificadas, o mês não conta (ajuste os avos).`);
  }

  const integral = r2((base / 12) * avosAno);
  memoria.integral = `${brl(base)} ÷ 12 × ${avosAno} avo(s).`;

  // 1ª PARCELA
  const primeiraCalc = r2(((base / 12) * avosPrimeira) / 2);
  const rotAte = ate === 12 ? "o ano todo" : `até ${MESES[ate - 1]}`;
  let primeira: number;
  let primeiraConsiderada: number;
  if (e.primeiraNasFerias !== null && e.primeiraNasFerias > 0) {
    primeira = 0;
    primeiraConsiderada = r2(e.primeiraNasFerias);
    memoria.primeira = `Paga nas férias (${brl(primeiraConsiderada)}): nada a pagar em novembro; a 2ª desconta esse valor.`;
  } else if (e.primeiraEstaFechada) {
    primeira = primeiraConsiderada = r2(e.primeiraFechada ?? 0);
    memoria.primeira =
      e.primeiraFechada === null
        ? "Não estava na 1ª parcela fechada (entrou depois): o 13º vai todo na 2ª."
        : `Retrato da 1ª parcela fechada (${brl(primeira)}).${Math.abs(primeira - primeiraCalc) >= 0.01 ? ` Recalculada hoje daria ${brl(primeiraCalc)}.` : ""}`;
  } else {
    primeira = primeiraConsiderada = primeiraCalc;
    memoria.primeira = `Metade de ${brl(base)} ÷ 12 × ${avosPrimeira} avo(s) (contados ${rotAte}). Sem INSS nem IRRF.`;
  }

  // 2ª PARCELA: INSS e IRRF sobre o 13º inteiro, à parte do salário.
  let inss = 0;
  if (e.semInss) memoria.inss = "Marcado no cadastro como sem INSS na folha (diretor).";
  else if (integral > 0) {
    const r = calcularInss(integral, p.inss);
    inss = r.valor;
    memoria.inss = `Cálculo à parte do salário: ${r.memoria}`;
  }
  inss = aj("inss", inss);
  let irrf = 0;
  if (integral > 0) {
    const r = calcularIrrf(integral, inss, e.dependentesIr, p.irrf);
    irrf = r.valor;
    memoria.irrf = `Tributação exclusiva: ${r.memoria}`;
  }
  irrf = aj("irrf", irrf);
  const segunda = r2(integral - primeiraConsiderada - inss - irrf);
  memoria.segunda = `${brl(integral)} − 1ª ${brl(primeiraConsiderada)} − INSS ${brl(inss)} − IRRF ${brl(irrf)}.`;
  if (segunda < 0) avisos.push("A 2ª parcela ficou negativa — a 1ª foi maior que o 13º do ano (confira avos e base).");

  const pctFgts = e.contrato === "aprendiz" ? p.fgtsAprendizPercentual : p.fgtsPercentual;
  const fgtsPrimeira = r2(primeiraConsiderada * pctFgts);
  const fgtsSegunda = r2((integral - primeiraConsiderada) * pctFgts);
  const fgts = r2(fgtsPrimeira + fgtsSegunda);
  memoria.fgts = `${pct(pctFgts)} da 1ª (${brl(fgtsPrimeira)}, no mês em que ela é paga) + ${pct(pctFgts)} do restante (${brl(fgtsSegunda)}, em dezembro)${e.contrato === "aprendiz" ? " — jovem aprendiz" : ""}.`;

  return {
    ...cab,
    fora: null,
    salario,
    base,
    avosPrimeira,
    avosAno,
    integral,
    primeira,
    primeiraConsiderada,
    inss,
    irrf,
    segunda,
    fgtsPrimeira,
    fgtsSegunda,
    fgts,
    custo: r2(integral + fgts),
    meses: ano12.meses,
    memoria,
    avisos,
    ajustados,
  };
}

export interface Dp13Totais {
  pessoas: number;
  integral: number;
  primeira: number;
  inss: number;
  irrf: number;
  segunda: number;
  fgtsPrimeira: number;
  fgtsSegunda: number;
  fgts: number;
  custo: number;
}

export function somar13(linhas: Dp13Resultado[]): Dp13Totais {
  const t: Dp13Totais = { pessoas: 0, integral: 0, primeira: 0, inss: 0, irrf: 0, segunda: 0, fgtsPrimeira: 0, fgtsSegunda: 0, fgts: 0, custo: 0 };
  for (const l of linhas) {
    if (l.fora) continue;
    t.pessoas++;
    for (const k of ["integral", "primeira", "inss", "irrf", "segunda", "fgtsPrimeira", "fgtsSegunda", "fgts", "custo"] as const) t[k] = r2(t[k] + l[k]);
  }
  return t;
}

/** Confere os ajustes vindos da tela (mesma regra dos ajustes da folha: motivo obrigatório). */
export function validarAjustes13(a: unknown): Dp13Ajustes {
  const out: Dp13Ajustes = {};
  if (!a || typeof a !== "object") return out;
  for (const k of DP13_AJUSTAVEIS) {
    const v = (a as Record<string, { valor?: unknown; motivo?: unknown }>)[k];
    if (!v) continue;
    const valor = typeof v.valor === "number" && Number.isFinite(v.valor) ? v.valor : null;
    const motivo = String(v.motivo ?? "").trim();
    if (valor === null) throw new Error(`${ROTULO_13[k]}: valor inválido.`);
    if (k === "avos" && (!Number.isInteger(valor) || valor < 0 || valor > 12)) throw new Error("Avos: de 0 a 12.");
    if (k !== "avos" && (valor < 0 || valor > 1_000_000)) throw new Error(`${ROTULO_13[k]}: valor inválido.`);
    if (!motivo) throw new Error(`${ROTULO_13[k]}: informe o motivo do ajuste.`);
    out[k] = { valor, motivo: motivo.slice(0, 200) };
  }
  return out;
}
