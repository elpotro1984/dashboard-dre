// Projeção das despesas por média — função pura (client + server).
// A média encontrada (do ano anterior) é corrigida por um índice percentual
// para chegar ao valor mensal projetado do ano do orçamento.

/**
 * Aplica a correção do índice sobre a média.
 *   projetado = média × (1 + índice%/100)
 * Sem índice (null) → devolve a própria média. Média null → null.
 */
export function projetarMedia(
  media: number | null,
  indicePercent: number | null,
): number | null {
  if (media == null) return null;
  if (indicePercent == null) return media;
  return media * (1 + indicePercent / 100);
}

/**
 * Normaliza os meses de incidência (1..12) de uma linha da média.
 *
 * `null` significa "os 12 meses" — e é também o que volta quando todos estão
 * marcados, para o banco guardar a exceção e não o padrão. Lista vazia ou sem
 * nenhum mês válido também vira `null`: uma linha sem mês nenhum sumiria do
 * orçamento sem dizer por quê, e quem quer tirar a despesa zera a média.
 */
export function normalizarMesesIncidencia(meses: unknown): number[] | null {
  if (!Array.isArray(meses)) return null;
  const validos = Array.from(
    new Set(
      meses
        .map((m) => Number(m))
        .filter((m) => Number.isInteger(m) && m >= 1 && m <= 12),
    ),
  ).sort((a, b) => a - b);
  if (validos.length === 0 || validos.length === 12) return null;
  return validos;
}

/**
 * Série de 12 meses da média: o valor mensal projetado só nos meses de
 * incidência, zero nos demais. Sem seleção (null), cai nos 12 meses.
 *
 * O valor do mês NÃO é redistribuído: a média continua sendo o valor de um
 * mês em que a despesa acontece, então 3 meses marcados = 3 × o projetado.
 */
export function serieMediaMensal(projetado: number, meses: number[] | null): number[] {
  const marcados = normalizarMesesIncidencia(meses);
  if (marcados == null) return Array<number>(12).fill(projetado);
  const set = new Set(marcados);
  return Array.from({ length: 12 }, (_, i) => (set.has(i + 1) ? projetado : 0));
}
