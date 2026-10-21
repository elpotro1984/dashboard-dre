// ============================================================================
// Conferências automáticas da folha — puras e testadas. São o que o DP fazia
// de olho ao montar a planilha do mês:
//
//  - quem saiu no mês precisa de rescisão lançada (o desligamento vem da
//    Sólides; esquecer a rescisão tira as indenizações dos totais);
//  - quem mudou muito de um mês para o outro merece um segundo olhar — é como
//    um erro de digitação (um zero a mais, um dia de férias a menos) aparece
//    antes de a folha fechar.
// ============================================================================

import { primeiroDia, ultimoDia } from "@/lib/dp/folha/calendario";

export interface DpRescisaoSugerida {
  solidesId: number;
  nome: string;
  setor: string | null;
  data: string;
}

/** Desligados NO MÊS sem rescisão lançada para eles. */
export function rescisoesSugeridas(
  pessoas: Array<{ solidesId: number; nome: string; setor: string | null; desligamento: string | null }>,
  rescisoes: Array<{ solidesId: number | null }>,
  competencia: string,
): DpRescisaoSugerida[] {
  const lancadas = new Set(rescisoes.map((r) => r.solidesId).filter((x): x is number => x !== null));
  return pessoas
    .filter((p) => p.desligamento && p.desligamento >= primeiroDia(competencia) && p.desligamento <= ultimoDia(competencia))
    .filter((p) => !lancadas.has(p.solidesId))
    .map((p) => ({ solidesId: p.solidesId, nome: p.nome, setor: p.setor, data: p.desligamento as string }));
}

export interface DpVariacao {
  anterior: number;
  atual: number;
  /** (atual − anterior) / anterior. */
  variacao: number;
}

/**
 * Pessoas cujo valor mudou mais que `limite` contra o mês anterior. Só compara
 * quem estava nos dois meses e tinha valor no anterior: quem entrou agora não
 * tem com o que comparar (e "infinitamente maior" não ajuda ninguém).
 */
export function variacoesContraAnterior(
  atual: Array<{ solidesId: number; valor: number }>,
  anterior: Array<{ solidesId: number; valor: number }>,
  limite: number,
): Map<number, DpVariacao> {
  const ant = new Map(anterior.map((x) => [x.solidesId, x.valor]));
  const out = new Map<number, DpVariacao>();
  if (!(limite > 0)) return out;
  for (const a of atual) {
    const v0 = ant.get(a.solidesId);
    if (v0 === undefined || v0 <= 0) continue;
    const variacao = (a.valor - v0) / v0;
    if (Math.abs(variacao) > limite + 1e-9) out.set(a.solidesId, { anterior: v0, atual: a.valor, variacao });
  }
  return out;
}

export function textoVariacao(v: DpVariacao, rotuloAnterior: string): string {
  const brl = (x: number) => x.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
  const pct = Math.round(Math.abs(v.variacao) * 100);
  return `Total do mês ${pct}% ${v.variacao > 0 ? "maior" : "menor"} que em ${rotuloAnterior} (${brl(v.anterior)} → ${brl(v.atual)}) — confira.`;
}
