// Projeção das despesas por VALOR FIXO com correção de índices — função pura
// (client + server). O usuário informa um valor base, um índice de correção e o
// mês em que o reajuste passa a valer; daí sai a série dos 12 meses.
//
//   antes do mês de reajuste → valor base
//   do mês de reajuste em diante → valor corrigido
//
// O valor corrigido depende da UNIDADE do índice:
//  - percent (IPCA, IGP-M, …) → base × (1 + índice%/100).
//    Ex.: base 1.000, IGP-M 4,08%, reajuste em julho → jul..dez = 1.048.
//  - brl (Salário mínimo) → o valor corrigido É o próprio salário mínimo
//    cadastrado para o ano, independentemente do valor base.
//    Ex.: base 1.412, SM 2027 = 1.630, reajuste em janeiro → 1.630 nos 12 meses.
//
// VALOR NEGOCIADO (27/10/2026): o índice é a regra, mas o contrato pode ser
// renegociado para um valor fechado. Ex.: aluguel 1.500 × IGP-M 4,08% =
// 1.561,20, mas o acordo fechou em 1.550 → é 1.550 que vai para o orçamento.
// O negociado SUBSTITUI o corrigido, no mesmo degrau (do mês do reajuste em
// diante; sem mês, o ano todo — um acordo sem data vale para o ano).

import { projetarMedia } from "@/lib/orcamento/media-calc";
import type { IndiceUnit } from "@/lib/orcamento/indices";

// MULTIPLICADOR DO SALÁRIO MÍNIMO (30/10/2026, pedido do dono do projeto): o
// contrato pode valer um múltiplo do mínimo ("1,5× o salário mínimo"), não só
// o mínimo. Vale só para o índice em R$ (unit 'brl'); nos percentuais não
// significa nada e é ignorado. NULL/ausente = 1×, o comportamento de antes.

/** As opções da lista suspensa — de 0,5× a 5×, de meio em meio. */
export const MULTIPLICADORES_SM: readonly number[] = [
  0.5, 1, 1.5, 2, 2.5, 3, 3.5, 4, 4.5, 5,
];

/** O multiplicador que vale: ausente, zero, negativo ou ilegível = 1×. */
export function multiplicadorEfetivo(m: number | null | undefined): number {
  return m != null && Number.isFinite(m) && m > 0 ? m : 1;
}

/** "1,5×" — como a tela e a Prévia escrevem o multiplicador. */
export function rotuloMultiplicador(m: number | null | undefined): string {
  return `${multiplicadorEfetivo(m).toLocaleString("pt-BR", { maximumFractionDigits: 2 })}×`;
}

/**
 * Valor corrigido pelo índice. `indiceValor` é o valor cadastrado do índice para
 * o ano (percentual, ou o próprio salário mínimo em R$ quando unit='brl').
 * - percent → base × (1 + índiceValor/100) (a mesma conta da média).
 * - brl → o salário mínimo do ano × multiplicador, arredondado no centavo.
 * Retorna null quando não há como corrigir (base/índice ausentes).
 */
export function corrigirValorFixo(
  valorBase: number | null,
  indiceValor: number | null,
  unit: IndiceUnit = "percent",
  multiplicador: number | null = null,
): number | null {
  if (unit === "brl") {
    if (indiceValor == null) return null;
    return Math.round(indiceValor * multiplicadorEfetivo(multiplicador) * 100) / 100;
  }
  return projetarMedia(valorBase, indiceValor);
}

/**
 * Série mensal (12 posições) do valor fixo com o degrau do reajuste.
 * - valorBase null → 12 zeros (categoria ainda não preenchida).
 * - mesReajuste null → sem reajuste no ano: valor base os 12 meses.
 * - mesReajuste m (1..12) → base até m-1, corrigido de m em diante.
 */
export function projetarValorFixoSerie(
  valorBase: number | null,
  indiceValor: number | null,
  mesReajuste: number | null,
  unit: IndiceUnit = "percent",
  /** Valor fechado em negociação — substitui o corrigido. null = vale o índice. */
  valorNegociado: number | null = null,
  /** Múltiplo do salário mínimo (só unit 'brl'). null = 1×. */
  multiplicador: number | null = null,
): number[] {
  if (valorBase == null) return Array<number>(12).fill(0);
  if (valorNegociado != null) {
    const m = mesReajuste == null ? 1 : Math.min(12, Math.max(1, mesReajuste));
    return Array.from({ length: 12 }, (_, i) => (i + 1 >= m ? valorNegociado : valorBase));
  }
  if (mesReajuste == null) return Array<number>(12).fill(valorBase);
  const corrigido = corrigirValorFixo(valorBase, indiceValor, unit, multiplicador) ?? valorBase;
  const m = Math.min(12, Math.max(1, mesReajuste));
  return Array.from({ length: 12 }, (_, i) => (i + 1 >= m ? corrigido : valorBase));
}

/**
 * Valor mensal que o ÍNDICE produz depois do reajuste (ou o próprio base, sem
 * reajuste no ano). É o número que a tela mostra na coluna editável
 * "Valor {ano}" enquanto ninguém negociou outro.
 */
export function valorFixoCalculado(
  valorBase: number | null,
  indiceValor: number | null,
  mesReajuste: number | null,
  unit: IndiceUnit = "percent",
  /** Múltiplo do salário mínimo (só unit 'brl'). null = 1×. */
  multiplicador: number | null = null,
): number | null {
  if (valorBase == null) return null;
  if (mesReajuste == null) return valorBase;
  return corrigirValorFixo(valorBase, indiceValor, unit, multiplicador) ?? valorBase;
}

/**
 * O que o usuário digitou na coluna do valor do ano vira NEGOCIADO só quando
 * difere do calculado (no centavo). Digitar o próprio calculado, ou apagar o
 * campo, volta a seguir o índice — senão um clique distraído congelaria o
 * valor e a mudança do índice deixaria de chegar ao contrato, calada.
 */
export function negociadoDigitado(
  digitado: number | null,
  calculado: number | null,
): number | null {
  if (digitado == null) return null;
  if (calculado != null && Math.round(digitado * 100) === Math.round(calculado * 100)) return null;
  return digitado;
}
