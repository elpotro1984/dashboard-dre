// ============================================================================
// Calendário da FOLHA — puro e testado. Responde duas perguntas que o DP
// respondia de cabeça a cada mês:
//
//  - quantos DIAS a pessoa trabalhou no mês, pela admissão e pelo desligamento
//    (mês comercial de 30 dias; quem está o mês inteiro tem 30, inclusive em
//    fevereiro e nos meses de 31);
//  - quantos DIAS ÚTEIS de VT o mês tem, pelos feriados de TRABALHO.
//
// Feriado de trabalho ≠ feriado bancário: o calendário do Compras
// (ctrl/business-days.ts) conta Carnaval e Corpus Christi, que para quem
// trabalha são ponto facultativo. Aqui entram só os nacionais de lei (+ a
// Sexta-feira Santa); municipal e o da empresa vão por ESCALA nos parâmetros.
// ============================================================================

import { easterSundayIso } from "@/lib/ctrl/business-days";

const DIA_MS = 86_400_000;
const utc = (ymd: string) => new Date(`${ymd}T00:00:00Z`);
const iso = (d: Date) => d.toISOString().slice(0, 10);

const FIXOS = ["01-01", "04-21", "05-01", "09-07", "10-12", "11-02", "11-15", "11-20", "12-25"];

const cache = new Map<number, Set<string>>();

/** Feriados nacionais de TRABALHO do ano (Lei 662/1949, 6.802/1980, 14.759/2023 + Sexta-feira Santa). */
export function feriadosNacionais(ano: number): Set<string> {
  const c = cache.get(ano);
  if (c) return c;
  const s = new Set(FIXOS.map((md) => `${ano}-${md}`));
  s.add(iso(new Date(utc(easterSundayIso(ano)).getTime() - 2 * DIA_MS)));
  cache.set(ano, s);
  return s;
}

export function primeiroDia(competencia: string): string {
  return `${competencia}-01`;
}

export function ultimoDia(competencia: string): string {
  const [y, m] = competencia.split("-").map(Number);
  return `${competencia}-${String(new Date(Date.UTC(y, m, 0)).getUTCDate()).padStart(2, "0")}`;
}

/** Dias úteis entre duas datas (inclusive): seg–sex (5) ou seg–sáb (6), sem feriado nacional nem os extras. */
export function diasUteis(ini: string, fim: string, diasSemana: 5 | 6, extras: ReadonlySet<string> = new Set()): number {
  if (fim < ini) return 0;
  let n = 0;
  for (let t = utc(ini).getTime(); t <= utc(fim).getTime(); t += DIA_MS) {
    const d = new Date(t);
    const dow = d.getUTCDay();
    if (dow === 0 || (dow === 6 && diasSemana === 5)) continue;
    const ymd = iso(d);
    if (feriadosNacionais(d.getUTCFullYear()).has(ymd) || extras.has(ymd)) continue;
    n++;
  }
  return n;
}

export interface DpIntervaloNoMes {
  ini: string;
  fim: string;
  /** O contrato cobre o mês inteiro. */
  inteiro: boolean;
}

/** O pedaço do mês em que a pessoa estava contratada; null se não estava em dia nenhum. */
export function intervaloNoMes(admissao: string | null, desligamento: string | null, competencia: string): DpIntervaloNoMes | null {
  const p = primeiroDia(competencia);
  const u = ultimoDia(competencia);
  const ini = admissao && admissao > p ? admissao : p;
  const fim = desligamento && desligamento < u ? desligamento : u;
  if (fim < ini) return null;
  return { ini, fim, inteiro: ini === p && fim === u };
}

/** Dias do mês comercial: 30 no mês inteiro; senão os dias corridos do pedaço (no máximo 30). */
export function diasComerciais(intervalo: DpIntervaloNoMes | null): number {
  if (!intervalo) return 0;
  if (intervalo.inteiro) return 30;
  return Math.min(30, Math.round((utc(intervalo.fim).getTime() - utc(intervalo.ini).getTime()) / DIA_MS) + 1);
}

/** "2026-09-16" → "16/09". */
export function diaMes(ymd: string): string {
  return `${ymd.slice(8, 10)}/${ymd.slice(5, 7)}`;
}

/**
 * A pessoa da Sólides entra na folha do mês? Quem já tem lançamento, sempre.
 * Contratação futura (admissão depois do mês) não. Ativo, sim. Desligado, só
 * no mês do desligamento — o último mês dele, que antes dependia de alguém
 * lembrar de abrir o lançamento. Sem a data de desligamento na Sólides, vale o
 * dia em que a sincronização percebeu a saída.
 */
export function colaboradorNoMes(
  r: { ativo: boolean; admissao: string | null; desligamento: string | null; desligadoDetectadoEm: string | null; temLancamento: boolean },
  competencia: string,
): boolean {
  if (r.temLancamento) return true;
  if (r.admissao && r.admissao > ultimoDia(competencia)) return false;
  if (r.ativo) return true;
  const saida = r.desligamento ?? (r.desligadoDetectadoEm ? r.desligadoDetectadoEm.slice(0, 10) : null);
  return Boolean(saida && saida >= primeiroDia(competencia) && saida <= ultimoDia(competencia));
}
