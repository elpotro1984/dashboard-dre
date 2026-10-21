// ============================================================================
// Cálculo de RESCISÃO da folha gerencial — puro e testado. Transforma o aviso
// "desligado no mês: lance a rescisão" num número com memória, verba a verba,
// para o DP conferir o TRCT que a contabilidade emite (o oficial continua lá).
//
// O que cada modalidade paga (CLT):
//
//                          saldo  aviso   13º prop.  férias venc.  férias prop.  multa FGTS
//   sem justa causa          ✓    propor.   ✓ (+proj)      ✓          ✓ (+proj)      40%
//   pedido de demissão       ✓    (desc.)   ✓              ✓          ✓ (Súm. 261)    –
//   justa causa              ✓      –       –              ✓          –               –
//   acordo (484-A)           ✓    metade    ✓ (+proj)      ✓          ✓ (+proj)      20%
//   término do contrato      ✓      –       ✓              ✓          ✓               –
//   antes, pelo empregador   ✓    art.479   ✓              ✓          ✓              40%
//   antes, pelo empregado    ✓   (art.480)  ✓              ✓          ✓               –
//
// Incidências (as que o eSocial e a jurisprudência assentaram):
//  - saldo de salário: INSS e IRRF da tabela mensal, FGTS;
//  - aviso prévio indenizado: FGTS (Súmula 305 TST); sem INSS (STJ, REsp
//    1.230.957, repetitivo) e isento de IRRF (Lei 7.713/1988, art. 6º, V);
//  - 13º proporcional, inclusive o da projeção do aviso: INSS e IRRF à parte,
//    como no 13º do ano, e FGTS;
//  - férias indenizadas + 1/3 e as indenizações dos arts. 479/480: sem INSS,
//    sem FGTS e isentas de IRRF (Súmula 386 STJ).
//
// Aviso prévio proporcional (Lei 12.506/2011): 30 dias + 3 por ano COMPLETO de
// casa, até 90. A projeção do aviso indenizado entra no tempo de serviço
// (CLT art. 487 §1º) e por isso pode render mais um avo de 13º e de férias.
//
// O que o sistema NÃO sabe e por isso é informado na tela: dias de férias
// vencidas não gozadas (a Sólides não tem o histórico), a 1ª parcela do 13º já
// paga (vem do retrato da 1ª parcela quando ela está fechada), o saldo do FGTS
// para fins rescisórios (sem ele, a multa sai ESTIMADA e diz isso) e faltas
// injustificadas (CLT art. 130), que reduzem as férias.
// ============================================================================

import { diasComerciais, diasCorridos, intervaloNoMes } from "@/lib/dp/folha/calendario";
import { avosNoAno } from "@/lib/dp/folha/decimo-terceiro";
import { calcularInss, calcularIrrf, type DpContratoFolha } from "@/lib/dp/folha/motor";
import type { DpFolhaParametros } from "@/lib/dp/folha/parametros";

export const TIPOS_RESCISAO = [
  "sem_justa_causa",
  "pedido_demissao",
  "justa_causa",
  "acordo",
  "termino_contrato",
  "antecipada_empregador",
  "antecipada_empregado",
] as const;
export type DpTipoRescisao = (typeof TIPOS_RESCISAO)[number];

export const ROTULO_TIPO_RESCISAO: Record<DpTipoRescisao, string> = {
  sem_justa_causa: "Dispensa sem justa causa",
  pedido_demissao: "Pedido de demissão",
  justa_causa: "Dispensa por justa causa",
  acordo: "Acordo entre as partes (art. 484-A)",
  termino_contrato: "Término do contrato a prazo (experiência)",
  antecipada_empregador: "Contrato a prazo encerrado antes, pela empresa (art. 479)",
  antecipada_empregado: "Contrato a prazo encerrado antes, pelo empregado (art. 480)",
};

export type DpAvisoPrevio = "indenizado" | "trabalhado" | "dispensado" | "descontado" | "nao_se_aplica";

export const ROTULO_AVISO: Record<DpAvisoPrevio, string> = {
  indenizado: "Indenizado",
  trabalhado: "Trabalhado",
  dispensado: "Dispensado pela empresa",
  descontado: "Não cumprido — descontado",
  nao_se_aplica: "Não se aplica",
};

/** As formas de aviso que cada modalidade admite (a 1ª é a mais comum). */
export function avisosPossiveis(tipo: DpTipoRescisao): DpAvisoPrevio[] {
  if (tipo === "sem_justa_causa" || tipo === "acordo") return ["indenizado", "trabalhado"];
  if (tipo === "pedido_demissao") return ["trabalhado", "dispensado", "descontado"];
  return ["nao_se_aplica"];
}

export interface DpRescisaoEntrada {
  tipo: DpTipoRescisao;
  aviso: DpAvisoPrevio;
  contrato: DpContratoFolha;
  /** Remuneração da rescisão: o salário de carteira (+ médias, se houver). */
  salario: number;
  admissao: string | null;
  /** Último dia do contrato (no aviso trabalhado, o fim do aviso). */
  desligamento: string;
  /** Termo do contrato a prazo (arts. 479/480). */
  fimContrato: string | null;
  dependentesIr: number;
  semInss: boolean;
  /** O saldo de salário já está na folha do mês (é o padrão: a folha paga os dias do último mês). */
  saldoNaFolha: boolean;
  /** Dias de saldo; null = do 1º dia do mês (ou da admissão) ao desligamento, mês comercial. */
  diasSaldo: number | null;
  /** Dias de férias VENCIDAS não gozadas (períodos completos). */
  diasFeriasVencidas: number;
  /** 1ª parcela do 13º já paga no ano (desconta do 13º proporcional). */
  primeira13Paga: number;
  /** Saldo do FGTS para fins rescisórios (extrato); null = estimado. */
  saldoFgts: number | null;
  /** Competências do ano em que a pessoa esteve afastada (não contam avo de 13º). */
  afastados?: string[];
  outrosProventos: number;
  outrosDescontos: number;
  /** Art. 480: descontar do empregado a indenização (exige prejuízo da empresa). */
  descontarArt480: boolean;
}

export type DpNaturezaVerba = "provento" | "desconto" | "informativo";

export interface DpVerbaRescisao {
  chave: string;
  rubrica: string;
  /** "12 dias", "5/12", "33 dias"… */
  referencia: string;
  valor: number;
  natureza: DpNaturezaVerba;
  /** Incidências, para a tela mostrar por que o INSS/IRRF/FGTS saiu como saiu. */
  incide: { inss: boolean; irrf: boolean; fgts: boolean };
  memoria: string;
}

export interface DpRescisaoResultado {
  verbas: DpVerbaRescisao[];
  proventos: number;
  descontos: number;
  liquido: number;
  /** FGTS do mês da rescisão sobre as verbas daqui (o do saldo pago na folha está na folha). */
  fgtsMes: number;
  multaPercentual: number;
  baseMulta: number;
  multa: number;
  saldoFgtsEstimado: boolean;
  /** O que a rescisão custa à empresa: verbas + FGTS do mês + multa (sem encargo patronal, como a folha). */
  custo: number;
  anosCompletos: number;
  /** Dias de saldo de salário usados (o informado ou o automático). */
  diasSaldo: number;
  avisoDias: number;
  avisoIndenizadoDias: number;
  dataProjetada: string;
  avos13: number;
  avosFerias: number;
  /** Até quando pagar: 10 dias corridos do fim do contrato (CLT art. 477 §6º). */
  prazoPagamento: string;
  avisos: string[];
}

const DIA_MS = 86_400_000;
const r2 = (v: number) => Math.round((v + Number.EPSILON) * 100) / 100;
const brl = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const pct = (v: number) => `${(v * 100).toLocaleString("pt-BR", { maximumFractionDigits: 2 })}%`;
const n = (v: number) => v.toLocaleString("pt-BR", { maximumFractionDigits: 2 });
const utc = (ymd: string) => new Date(`${ymd}T00:00:00Z`);
const iso = (d: Date) => d.toISOString().slice(0, 10);
const ddmmaaaa = (ymd: string) => `${ymd.slice(8, 10)}/${ymd.slice(5, 7)}/${ymd.slice(0, 4)}`;

export function somarDias(ymd: string, dias: number): string {
  return iso(new Date(utc(ymd).getTime() + dias * DIA_MS));
}

/** Mesmo dia `meses` depois; sem esse dia no mês de chegada, o último (31/01 + 1 = 28/02). */
export function somarMesesData(ymd: string, meses: number): string {
  const [y, m, d] = ymd.split("-").map(Number);
  const t = y * 12 + (m - 1) + meses;
  const ano = Math.floor(t / 12);
  const mes = t % 12;
  const ultimo = new Date(Date.UTC(ano, mes + 1, 0)).getUTCDate();
  return iso(new Date(Date.UTC(ano, mes, Math.min(d, ultimo))));
}

/** Anos completos de casa até a data (o aniversário da admissão conta). */
export function anosCompletos(admissao: string | null, ate: string): number {
  if (!admissao || ate < admissao) return 0;
  let anos = 0;
  while (somarMesesData(admissao, 12 * (anos + 1)) <= ate) anos++;
  return anos;
}

/** Aviso proporcional da Lei 12.506/2011: 30 + 3 por ano completo, até 90. */
export function diasAvisoProporcional(admissao: string | null, ate: string): number {
  return Math.min(90, 30 + 3 * anosCompletos(admissao, ate));
}

/**
 * Avos de férias PROPORCIONAIS: do início do período aquisitivo em curso (o
 * último aniversário da admissão) até `ate`, um por mês completo e mais um pela
 * fração acima de 14 dias (CLT art. 146, parágrafo único). 12 = o período fecha
 * dentro da projeção.
 */
export function avosFeriasProporcionais(admissao: string | null, ate: string): { avos: number; inicioPeriodo: string | null } {
  if (!admissao || ate < admissao) return { avos: 0, inicioPeriodo: null };
  const inicio = somarMesesData(admissao, 12 * anosCompletos(admissao, ate));
  let meses = 0;
  while (meses < 12 && somarDias(somarMesesData(inicio, meses + 1), -1) <= ate) meses++;
  if (meses < 12) {
    const resto = diasCorridos(somarMesesData(inicio, meses), ate);
    if (resto > 14) meses++;
  }
  return { avos: Math.min(12, meses), inicioPeriodo: inicio };
}

function verba(
  chave: string,
  rubrica: string,
  referencia: string,
  valor: number,
  natureza: DpNaturezaVerba,
  incide: DpVerbaRescisao["incide"],
  memoria: string,
): DpVerbaRescisao {
  return { chave, rubrica, referencia, valor: r2(valor), natureza, incide, memoria };
}

const SEM = { inss: false, irrf: false, fgts: false };

export function calcularRescisao(e: DpRescisaoEntrada, p: DpFolhaParametros): DpRescisaoResultado {
  const avisos: string[] = [];
  const verbas: DpVerbaRescisao[] = [];
  const tipo = e.tipo;
  const estagio = e.contrato === "estagio";
  const aprendiz = e.contrato === "aprendiz";
  if (e.contrato === "prestador" || e.contrato === "socio") {
    throw new Error("PJ e sócio não têm rescisão trabalhista — o encerramento segue o contrato de prestação.");
  }
  if (e.contrato === "outro") avisos.push("Sem tipo de contrato na Sólides — calculado como CLT.");
  if (!e.admissao) avisos.push("Sem data de admissão: o aviso fica em 30 dias e as férias proporcionais não são calculadas — informe a admissão na Sólides.");
  const sal = Math.max(0, e.salario);
  const dia = sal / 30;
  const pctFgts = aprendiz ? p.fgtsAprendizPercentual : p.fgtsPercentual;
  const comp = e.desligamento.slice(0, 7);
  const anos = anosCompletos(e.admissao, e.desligamento);

  // AVISO PRÉVIO: quanto se indeniza e quanto se projeta.
  const aviso = avisosPossiveis(tipo).includes(e.aviso) ? e.aviso : avisosPossiveis(tipo)[0];
  const proporcional = diasAvisoProporcional(e.admissao, e.desligamento);
  let avisoDias = 0;
  let indenizadoDias = 0;
  if (!estagio && (tipo === "sem_justa_causa" || tipo === "acordo")) {
    avisoDias = proporcional;
    // Trabalhado: a pessoa cumpre 30 dias; o acréscimo da Lei 12.506 só favorece o
    // empregado e é indenizado (Nota Técnica MTE 184/2012).
    indenizadoDias = aviso === "indenizado" ? proporcional : proporcional - 30;
  }
  const dataProjetada = somarDias(e.desligamento, indenizadoDias);

  // SALDO DE SALÁRIO
  const diasSaldo = e.diasSaldo ?? diasComerciais(intervaloNoMes(e.admissao, e.desligamento, comp));
  const saldo = r2(dia * diasSaldo);
  const memSaldo = `${brl(sal)} ÷ 30 × ${n(diasSaldo)} dia(s)${e.diasSaldo === null ? " (do início do mês ao desligamento, mês comercial)" : " (informados)"}.`;
  let inssSaldo = 0;
  let irrfSaldo = 0;
  if (e.saldoNaFolha) {
    verbas.push(
      verba("saldo", "Saldo de salário — pago na folha do mês", `${n(diasSaldo)} dias`, saldo, "informativo", { inss: !estagio, irrf: !estagio, fgts: !estagio }, `${memSaldo} Já está na folha do mês (com o INSS, o IRRF e o FGTS dele): aqui é só conferência e não entra no total.`),
    );
  } else {
    verbas.push(verba("saldo", "Saldo de salário", `${n(diasSaldo)} dias`, saldo, "provento", { inss: !estagio, irrf: !estagio, fgts: !estagio }, memSaldo));
    const inss = !estagio && !e.semInss && saldo > 0 ? calcularInss(saldo, p.inss) : null;
    inssSaldo = inss?.valor ?? 0;
    const irrf = !estagio && saldo > 0 ? calcularIrrf(saldo, inssSaldo, e.dependentesIr, p.irrf) : null;
    irrfSaldo = irrf?.valor ?? 0;
    if (inss && inssSaldo) verbas.push(verba("inss_saldo", "INSS sobre o saldo de salário", "", inssSaldo, "desconto", SEM, inss.memoria));
    if (irrf && irrfSaldo) verbas.push(verba("irrf_saldo", "IRRF sobre o saldo de salário", "", irrfSaldo, "desconto", SEM, irrf.memoria));
  }

  // AVISO
  let avisoValor = 0;
  if (indenizadoDias > 0) {
    const fator = tipo === "acordo" ? 0.5 : 1;
    avisoValor = r2(dia * indenizadoDias * fator);
    const origem =
      aviso === "indenizado"
        ? `30 + 3 × ${anos} ano(s) completo(s) = ${proporcional} dias (Lei 12.506/2011)`
        : `aviso trabalhado de 30 dias; os ${indenizadoDias} dias proporcionais (Lei 12.506/2011) são indenizados`;
    verbas.push(
      verba(
        "aviso",
        tipo === "acordo" ? "Aviso prévio indenizado — metade (art. 484-A)" : "Aviso prévio indenizado",
        `${indenizadoDias} dias${fator < 1 ? " × 50%" : ""}`,
        avisoValor,
        "provento",
        { inss: false, irrf: false, fgts: true },
        `${brl(sal)} ÷ 30 × ${indenizadoDias} dias${fator < 1 ? " × 50%" : ""} — ${origem}. Projeta o contrato até ${ddmmaaaa(dataProjetada)}.`,
      ),
    );
  }
  if (tipo === "pedido_demissao" && aviso === "descontado") {
    verbas.push(verba("aviso_desc", "Aviso prévio não cumprido", "30 dias", sal, "desconto", SEM, `O empregado que não cumpre o aviso perde os salários do período (CLT art. 487 §2º): ${brl(sal)}.`));
  }

  // 13º PROPORCIONAL (justa causa perde; estágio não tem)
  let avos13 = 0;
  let decimo = 0;
  if (tipo !== "justa_causa" && !estagio) {
    const afastados = new Set(e.afastados ?? []);
    const ano = Number(e.desligamento.slice(0, 4));
    const ateDeslig = avosNoAno({ admissao: e.admissao, desligamento: e.desligamento, ano, ateMes: 12, afastados }).avos;
    const anoProj = Number(dataProjetada.slice(0, 4));
    let comProj = avosNoAno({ admissao: e.admissao, desligamento: dataProjetada, ano, ateMes: 12, afastados }).avos;
    // A projeção pode atravessar a virada do ano: o avo de janeiro é do 13º do ano seguinte.
    if (anoProj > ano) comProj += avosNoAno({ admissao: e.admissao, desligamento: dataProjetada, ano: anoProj, ateMes: 12 }).avos;
    avos13 = comProj;
    const v1 = r2((sal / 12) * ateDeslig);
    const v2 = r2((sal / 12) * (comProj - ateDeslig));
    decimo = r2(v1 + v2);
    const inc = { inss: true, irrf: true, fgts: true };
    verbas.push(verba("13", "13º salário proporcional", `${ateDeslig}/12`, v1, "provento", inc, `${brl(sal)} ÷ 12 × ${ateDeslig} avo(s) do ano (mês com 15 dias ou mais de contrato).`));
    if (v2 > 0) {
      verbas.push(verba("13_aviso", "13º sobre o aviso indenizado (projeção)", `${comProj - ateDeslig}/12`, v2, "provento", inc, `A projeção do aviso até ${ddmmaaaa(dataProjetada)} rende ${comProj - ateDeslig} avo(s) a mais.`));
    }
    if (e.primeira13Paga > 0) {
      verbas.push(verba("13_adiant", "Adiantamento do 13º (1ª parcela já paga)", "", e.primeira13Paga, "desconto", SEM, `Paga antes do desligamento: ${brl(e.primeira13Paga)}.`));
    }
    if (decimo > 0) {
      const inss13 = e.semInss ? null : calcularInss(decimo, p.inss);
      const inss13v = inss13?.valor ?? 0;
      if (inss13 && inss13v) verbas.push(verba("inss_13", "INSS sobre o 13º", "", inss13v, "desconto", SEM, `Cálculo à parte do saldo: ${inss13.memoria}`));
      const ir13 = calcularIrrf(decimo, inss13v, e.dependentesIr, p.irrf);
      if (ir13.valor) verbas.push(verba("irrf_13", "IRRF sobre o 13º", "", ir13.valor, "desconto", SEM, `Tributação exclusiva: ${ir13.memoria}`));
    }
  }

  // FÉRIAS (indenizadas): vencidas sempre; proporcionais exceto na justa causa.
  const terco = estagio ? 0 : 1 / 3;
  if (e.diasFeriasVencidas > 0) {
    const v = r2(dia * e.diasFeriasVencidas);
    verbas.push(verba("ferias_venc", estagio ? "Recesso vencido" : "Férias vencidas", `${n(e.diasFeriasVencidas)} dias`, v, "provento", SEM, `${brl(sal)} ÷ 30 × ${n(e.diasFeriasVencidas)} dias informados.`));
    if (terco) verbas.push(verba("terco_venc", "1/3 sobre férias vencidas", "", v * terco, "provento", SEM, "Um terço constitucional."));
    if (e.diasFeriasVencidas > 30) avisos.push("Mais de um período de férias vencido: o que passou do período concessivo é devido em DOBRO (CLT art. 137) — ajuste os dias.");
  } else if (anos >= 1) {
    avisos.push(`${anos} ano(s) de casa: confira se há férias vencidas não gozadas e informe os dias (a Sólides não tem o histórico de férias).`);
  }
  let avosFerias = 0;
  if (tipo !== "justa_causa") {
    const fp = avosFeriasProporcionais(e.admissao, dataProjetada);
    avosFerias = fp.avos;
    if (fp.avos > 0) {
      const v = r2((sal / 12) * fp.avos);
      verbas.push(
        verba(
          "ferias_prop",
          estagio ? "Recesso proporcional" : "Férias proporcionais",
          `${fp.avos}/12`,
          v,
          "provento",
          SEM,
          `${brl(sal)} ÷ 12 × ${fp.avos} avo(s) do período aquisitivo iniciado em ${ddmmaaaa(fp.inicioPeriodo!)}` +
            (indenizadoDias > 0 ? `, com a projeção do aviso até ${ddmmaaaa(dataProjetada)}` : "") +
            ". Faltas injustificadas (CLT art. 130) não estão descontadas.",
        ),
      );
      if (terco) verbas.push(verba("terco_prop", "1/3 sobre férias proporcionais", "", v * terco, "provento", SEM, "Um terço constitucional."));
    }
  }

  // CONTRATO A PRAZO encerrado antes
  if (tipo === "antecipada_empregador" || tipo === "antecipada_empregado") {
    if (aprendiz) avisos.push("Aprendiz: os arts. 479 e 480 não se aplicam (CLT art. 433 §2º).");
    else if (!e.fimContrato || e.fimContrato <= e.desligamento) avisos.push("Informe o fim previsto do contrato (depois do desligamento) para calcular a indenização.");
    else {
      const restantes = diasCorridos(somarDias(e.desligamento, 1), e.fimContrato);
      const v = r2((dia * restantes) / 2);
      const mem = `Metade da remuneração dos ${restantes} dias que faltavam até ${ddmmaaaa(e.fimContrato)}: ${brl(sal)} ÷ 30 × ${restantes} ÷ 2.`;
      if (tipo === "antecipada_empregador") verbas.push(verba("art479", "Indenização do art. 479", `${restantes} dias ÷ 2`, v, "provento", SEM, mem));
      else if (e.descontarArt480) verbas.push(verba("art480", "Indenização ao empregador (art. 480)", `${restantes} dias ÷ 2`, v, "desconto", SEM, `${mem} Só se houve prejuízo da empresa.`));
      else avisos.push(`A empresa pode descontar até ${brl(v)} (art. 480) se o encerramento antecipado causou prejuízo.`);
    }
  }

  if (e.outrosProventos > 0) verbas.push(verba("outros_prov", "Outros proventos", "", e.outrosProventos, "provento", SEM, "Informado (sem incidências calculadas)."));
  if (e.outrosDescontos > 0) verbas.push(verba("outros_desc", "Outros descontos", "", e.outrosDescontos, "desconto", SEM, "Informado."));

  const proventos = r2(verbas.filter((v) => v.natureza === "provento").reduce((s, v) => s + v.valor, 0));
  const descontos = r2(verbas.filter((v) => v.natureza === "desconto").reduce((s, v) => s + v.valor, 0));
  const liquido = r2(proventos - descontos);
  if (liquido < 0) avisos.push("Líquido negativo: a compensação na rescisão é limitada a um mês de remuneração (CLT art. 477 §5º).");

  // FGTS do mês e multa
  const baseFgtsMes = estagio ? 0 : (e.saldoNaFolha ? 0 : saldo) + avisoValor + decimo;
  const fgtsMes = r2(baseFgtsMes * pctFgts);
  const multaPercentual = estagio ? 0 : tipo === "sem_justa_causa" || tipo === "antecipada_empregador" ? 0.4 : tipo === "acordo" ? 0.2 : 0;
  let baseMulta = 0;
  let saldoFgtsEstimado = false;
  if (multaPercentual > 0) {
    let depositos = e.saldoFgts;
    if (depositos === null) {
      saldoFgtsEstimado = true;
      // Meses de depósito antes do mês da rescisão, com o 13º e o 1/3 de férias de cada ano.
      const meses = e.admissao ? Math.max(0, (Number(comp.slice(0, 4)) - Number(e.admissao.slice(0, 4))) * 12 + Number(comp.slice(5, 7)) - Number(e.admissao.slice(5, 7))) : 0;
      depositos = r2(sal * pctFgts * meses * (1 + (1 + 1 / 3) / 12));
      avisos.push(`Multa do FGTS ESTIMADA: ${meses} mês(es) de depósito sobre o salário atual, sem correção. Informe o saldo do extrato para fins rescisórios.`);
    }
    // A base inclui o depósito do mês da rescisão, inclusive o do saldo pago na folha.
    baseMulta = r2(depositos + fgtsMes + (e.saldoNaFolha ? saldo * pctFgts : 0));
  }
  const multa = r2(baseMulta * multaPercentual);
  if (multa > 0) {
    verbas.push(
      verba("multa", `Multa de ${pct(multaPercentual)} do FGTS (guia, não entra no TRCT)`, pct(multaPercentual), multa, "informativo", SEM, `${pct(multaPercentual)} × ${brl(baseMulta)} (saldo para fins rescisórios + depósito do mês).`),
    );
  }
  if (fgtsMes > 0) {
    verbas.push(verba("fgts_mes", "FGTS do mês da rescisão (guia)", pct(pctFgts), fgtsMes, "informativo", SEM, `${pct(pctFgts)} × ${brl(r2(baseFgtsMes))} (${e.saldoNaFolha ? "" : "saldo + "}aviso indenizado + 13º).`));
  }

  return {
    verbas,
    proventos,
    descontos,
    liquido,
    fgtsMes,
    multaPercentual,
    baseMulta,
    multa,
    saldoFgtsEstimado,
    custo: r2(proventos + fgtsMes + multa),
    anosCompletos: anos,
    diasSaldo,
    avisoDias,
    avisoIndenizadoDias: indenizadoDias,
    dataProjetada,
    avos13,
    avosFerias,
    prazoPagamento: somarDias(e.desligamento, 10),
    avisos,
  };
}

/** Confere a entrada vinda da tela (o servidor recalcula sempre a partir dela). */
export function validarEntradaRescisao(x: DpRescisaoEntrada): DpRescisaoEntrada {
  const data = (v: unknown, campo: string, opcional = false): string | null => {
    if ((v === null || v === undefined || v === "") && opcional) return null;
    if (typeof v !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(v)) throw new Error(`${campo}: data inválida.`);
    return v;
  };
  const num = (v: unknown, campo: string, max = 10_000_000): number => {
    if (typeof v !== "number" || !Number.isFinite(v) || v < 0 || v > max) throw new Error(`${campo}: valor inválido.`);
    return Math.round(v * 100) / 100;
  };
  if (!TIPOS_RESCISAO.includes(x?.tipo)) throw new Error("Tipo de rescisão inválido.");
  const desligamento = data(x.desligamento, "Desligamento")!;
  const admissao = data(x.admissao, "Admissão", true);
  if (admissao && admissao > desligamento) throw new Error("O desligamento é anterior à admissão.");
  const fimContrato = data(x.fimContrato, "Fim do contrato", true);
  const diasSaldo = x.diasSaldo === null || x.diasSaldo === undefined ? null : num(x.diasSaldo, "Dias de saldo", 31);
  return {
    tipo: x.tipo,
    aviso: avisosPossiveis(x.tipo).includes(x.aviso) ? x.aviso : avisosPossiveis(x.tipo)[0],
    contrato: x.contrato,
    salario: num(x.salario, "Remuneração"),
    admissao,
    desligamento,
    fimContrato,
    dependentesIr: Math.round(num(x.dependentesIr, "Dependentes", 20)),
    semInss: Boolean(x.semInss),
    saldoNaFolha: Boolean(x.saldoNaFolha),
    diasSaldo,
    diasFeriasVencidas: num(x.diasFeriasVencidas, "Férias vencidas", 90),
    primeira13Paga: num(x.primeira13Paga, "1ª parcela do 13º"),
    saldoFgts: x.saldoFgts === null || x.saldoFgts === undefined ? null : num(x.saldoFgts, "Saldo do FGTS"),
    afastados: Array.isArray(x.afastados) ? x.afastados.filter((c) => typeof c === "string" && /^\d{4}-\d{2}$/.test(c)) : [],
    outrosProventos: num(x.outrosProventos, "Outros proventos"),
    outrosDescontos: num(x.outrosDescontos, "Outros descontos"),
    descontarArt480: Boolean(x.descontarArt480),
  };
}
