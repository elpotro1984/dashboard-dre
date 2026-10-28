// ============================================================================
// PAGAMENTO DE FÉRIAS — o controle de férias do DP (27/10/2026). Puro e testado.
//
// É a FONTE das férias do sistema: a Folha do mês tira daqui os dias de férias
// de cada mês (e os dias úteis que o VT não paga), o 13º idem — ver
// `listPessoasDaFolha`. A tela é "tipo a folha": mês a mês, e cada férias
// aparece no mês do INÍCIO, numa linha só e com o valor inteiro — é quando o
// recibo é pago (até 2 dias antes do início).
//
// VALOR = o LÍQUIDO DO RECIBO de férias, com as mesmas regras do salário
// (pedido de 27/10/2026): férias = salário ÷ 30 × dias, + 1/3 (estágio: recesso,
// sem o terço), − INSS e − IRRF pelas tabelas da vigência, calculados À PARTE do
// salário do mês, como no recibo (mesmo tratamento do 13º). O salário é o que a
// folha usa no mês do início (o da Sólides, ou o da promoção registrada).
// Editável: o informado vence, e a tela mostra os dois. As contas são as do
// motor da folha (calcularInss/calcularIrrf; há teste comparando).
// ============================================================================

import { diasCorridos, primeiroDia, ultimoDia } from "@/lib/dp/folha/calendario";
import { calcularInss, calcularIrrf, type DpContratoFolha } from "@/lib/dp/folha/motor";
import type { DpFolhaParametros } from "@/lib/dp/folha/parametros";

export interface DpFeriasLancada {
  id: string;
  /** Pessoa da folha: positivo = Sólides, negativo = avulso. */
  solidesId: number;
  inicio: string;
  fim: string;
  /** null = vale o calculado. */
  valorManual: number | null;
  observacao: string | null;
  /**
   * FK marcado = NÃO são férias verdadeiras para os benefícios: na Gestão de
   * benefícios elas não tiram dias. A folha ainda não lê o campo.
   */
  fk: boolean;
}

/** A CLT permite fracionar em até 3 períodos; cada um com no máximo 30 dias. */
export const MAX_DIAS_PERIODO = 30;
export const MAX_PERIODOS_PESSOA = 20;

const RE_DIA = /^\d{4}-\d{2}-\d{2}$/;
const r2 = (v: number) => Math.round((v + Number.EPSILON) * 100) / 100;
const dm = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;

function dataValida(iso: string): boolean {
  if (!RE_DIA.test(iso)) return false;
  const d = new Date(`${iso}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === iso;
}

/** Dias de férias: do início ao término, inclusive. */
export function diasDeFerias(inicio: string, fim: string): number {
  return dataValida(inicio) && dataValida(fim) ? diasCorridos(inicio, fim) : 0;
}

/**
 * O que impede lançar estas férias — ou null. `outras` são as DEMAIS férias da
 * mesma pessoa (sem a que está sendo editada): duas no mesmo dia contariam a
 * mesma férias duas vezes na folha.
 */
export function erroDasFerias(p: { inicio: string; fim: string }, outras: ReadonlyArray<{ inicio: string; fim: string }>): string | null {
  if (!dataValida(p.inicio) || !dataValida(p.fim)) return "Informe as datas de início e de término.";
  if (p.fim < p.inicio) return "O término é antes do início.";
  const dias = diasCorridos(p.inicio, p.fim);
  if (dias > MAX_DIAS_PERIODO) return `São ${dias} dias — no máximo ${MAX_DIAS_PERIODO} por período (dá para fracionar em até 3).`;
  if (outras.length >= MAX_PERIODOS_PESSOA) return `Esta pessoa já tem ${MAX_PERIODOS_PESSOA} períodos de férias lançados.`;
  const choque = outras.find((o) => p.inicio <= o.fim && o.inicio <= p.fim);
  if (choque) return `Estas férias se sobrepõem às de ${dm(choque.inicio)} a ${dm(choque.fim)}.`;
  return null;
}

export interface DpReciboFerias {
  ferias: number;
  terco: number;
  /** Férias + 1/3. */
  bruto: number;
  inss: number;
  irrf: number;
  /** O que a pessoa recebe: bruto − INSS − IRRF. */
  liquido: number;
  memoria: { inss: string; irrf: string };
}

/**
 * O recibo de férias com as regras do salário: INSS e IRRF À PARTE do salário do
 * mês (como o 13º). Mesmo recorte do motor: estágio não recolhe INSS (e não tem
 * o terço); PJ e sócio, nem INSS nem IRRF; "sem INSS" do cadastro (diretor) vale.
 */
export function reciboDeFerias(
  e: { salario: number | null; contrato: DpContratoFolha; dias: number; semInss: boolean; dependentesIr: number },
  p: Pick<DpFolhaParametros, "inss" | "irrf">,
): DpReciboFerias {
  const base = ((e.salario ?? 0) / 30) * Math.max(0, e.dias);
  const ferias = r2(base);
  const terco = e.contrato === "estagio" ? 0 : r2(base / 3);
  const bruto = r2(ferias + terco);
  const semEncargos = e.contrato === "prestador" || e.contrato === "socio";

  let inss = 0;
  let memInss: string;
  if (bruto <= 0) memInss = "Sem valor de férias.";
  else if (e.contrato === "estagio") memInss = "Estágio não recolhe INSS.";
  else if (semEncargos) memInss = e.contrato === "socio" ? "Sócio: sem INSS." : "PJ / prestador: sem INSS.";
  else if (e.semInss) memInss = "Marcado no cadastro como sem INSS na folha (diretor).";
  else {
    const r = calcularInss(bruto, p.inss);
    inss = r.valor;
    memInss = r.memoria;
  }

  let irrf = 0;
  let memIrrf: string;
  if (bruto <= 0) memIrrf = "Sem valor de férias.";
  else if (semEncargos) memIrrf = e.contrato === "socio" ? "Sócio: sem IRRF na folha." : "PJ / prestador: sem IRRF na folha.";
  else {
    const r = calcularIrrf(bruto, inss, e.dependentesIr, p.irrf);
    irrf = r.valor;
    memIrrf = `${r.memoria} Calculado à parte do salário do mês, como no recibo.`;
  }

  return { ferias, terco, bruto, inss, irrf, liquido: r2(bruto - inss - irrf), memoria: { inss: memInss, irrf: memIrrf } };
}

/** As férias que COMEÇAM no mês — as que a tela mostra nele. */
export function feriasQueComecamNoMes<T extends { inicio: string }>(lista: readonly T[], competencia: string): T[] {
  const p = primeiroDia(competencia);
  const u = ultimoDia(competencia);
  return lista.filter((f) => f.inicio >= p && f.inicio <= u).sort((a, b) => a.inicio.localeCompare(b.inicio));
}

/** As competências que o período toca — se a folha de alguma estiver fechada, as férias não mudam. */
export function mesesDoPeriodo(inicio: string, fim: string): string[] {
  if (!dataValida(inicio) || !dataValida(fim) || fim < inicio) return [];
  const out: string[] = [];
  let [y, m] = inicio.slice(0, 7).split("-").map(Number);
  const fimComp = fim.slice(0, 7);
  for (let guarda = 0; guarda < 24; guarda++) {
    const c = `${y}-${String(m).padStart(2, "0")}`;
    out.push(c);
    if (c >= fimComp) break;
    m += 1;
    if (m > 12) {
      m = 1;
      y += 1;
    }
  }
  return out;
}

/** O valor que vale: o informado, senão o calculado. */
export function valorDasFerias(manual: number | null, calculado: number): number {
  return manual ?? calculado;
}
