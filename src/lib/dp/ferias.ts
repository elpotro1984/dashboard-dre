// ============================================================================
// PAGAMENTO DE FÉRIAS — o controle de férias do DP (27/10/2026). Puro e testado.
//
// É a FONTE das férias do sistema: a Folha do mês tira daqui os dias de férias
// de cada mês (e os dias úteis que o VT não paga), o 13º idem — ver
// `listPessoasDaFolha`. A tela é "tipo a folha": mês a mês, e cada férias
// aparece no mês do INÍCIO, numa linha só e com o valor inteiro — é quando o
// recibo é pago (até 2 dias antes do início).
//
// VALOR: calculado como o recibo — salário ÷ 30 × dias + 1/3 (estágio: recesso,
// sem o terço) —, com o salário que a folha usa no mês do início (o da Sólides,
// ou o da promoção registrada). Editável: o informado vence, e a tela mostra os
// dois. A conta é a MESMA do motor da folha (há teste comparando).
// ============================================================================

import { diasCorridos, primeiroDia, ultimoDia } from "@/lib/dp/folha/calendario";
import type { DpContratoFolha } from "@/lib/dp/folha/motor";

export interface DpFeriasLancada {
  id: string;
  /** Pessoa da folha: positivo = Sólides, negativo = avulso. */
  solidesId: number;
  inicio: string;
  fim: string;
  /** null = vale o calculado. */
  valorManual: number | null;
  observacao: string | null;
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

/** salário ÷ 30 × dias + 1/3 — a mesma conta do motor da folha (estágio: sem o terço). */
export function valorCalculadoFerias(salario: number | null, contrato: DpContratoFolha, dias: number): { ferias: number; terco: number; total: number } {
  const base = ((salario ?? 0) / 30) * Math.max(0, dias);
  const ferias = r2(base);
  const terco = contrato === "estagio" ? 0 : r2(base / 3);
  return { ferias, terco, total: r2(ferias + terco) };
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
