// Valor fixo com correção de índices — e o valor NEGOCIADO que substitui o
// corrigido quando o contrato fecha num número diferente do índice.

import test from "node:test";
import assert from "node:assert/strict";

import {
  corrigirValorFixo,
  MULTIPLICADORES_SM,
  multiplicadorEfetivo,
  negociadoDigitado,
  projetarValorFixoSerie,
  rotuloMultiplicador,
  valorFixoCalculado,
} from "./valor-fixo-calc";

test("sem negociado, segue o índice a partir do mês do reajuste", () => {
  const s = projetarValorFixoSerie(1500, 4.08, 7, "percent");
  assert.equal(s[5], 1500);
  assert.ok(Math.abs(s[6] - 1561.2) < 1e-9);
  assert.ok(Math.abs(s[11] - 1561.2) < 1e-9);
});

test("negociado substitui o corrigido no mesmo degrau", () => {
  const s = projetarValorFixoSerie(1500, 4.08, 7, "percent", 1550);
  assert.deepEqual(s, [1500, 1500, 1500, 1500, 1500, 1500, 1550, 1550, 1550, 1550, 1550, 1550]);
});

test("negociado sem mês de reajuste vale o ano todo", () => {
  assert.deepEqual(projetarValorFixoSerie(1500, 4.08, null, "percent", 1550), Array(12).fill(1550));
});

test("negociado vence também o salário mínimo (unit brl)", () => {
  const s = projetarValorFixoSerie(1412, 1630, 1, "brl", 1600);
  assert.deepEqual(s, Array(12).fill(1600));
});

test("negociado zero é valor (contrato que deixa de custar), não ausência", () => {
  const s = projetarValorFixoSerie(1500, 4.08, 3, "percent", 0);
  assert.deepEqual(s, [1500, 1500, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
});

test("sem valor base o contrato não entra, nem com negociado", () => {
  assert.deepEqual(projetarValorFixoSerie(null, 4.08, 7, "percent", 1550), Array(12).fill(0));
});

test("valorFixoCalculado: corrigido com mês, base sem mês", () => {
  assert.ok(Math.abs((valorFixoCalculado(1500, 4.08, 7) ?? 0) - 1561.2) < 1e-9);
  assert.equal(valorFixoCalculado(1500, 4.08, null), 1500);
  assert.equal(valorFixoCalculado(null, 4.08, 7), null);
});

test("digitar o próprio calculado (ou apagar) volta ao índice", () => {
  assert.equal(negociadoDigitado(1561.2, 1500 * 1.0408), null);
  assert.equal(negociadoDigitado(null, 1561.2), null);
  assert.equal(negociadoDigitado(1550, 1561.2), 1550);
});

test("salário mínimo × multiplicador: 1,5× o mínimo do ano a partir do reajuste", () => {
  // Contrato de 1,5 salário mínimo: base 2.277 (1,5 × 1.518), SM 2027 = 1.630.
  const serie = projetarValorFixoSerie(2277, 1630, 1, "brl", null, 1.5);
  assert.equal(serie[0], 2445);
  assert.equal(serie[11], 2445);
  assert.equal(valorFixoCalculado(2277, 1630, 1, "brl", 1.5), 2445);
});

test("sem multiplicador (ou inválido) vale 1× — o comportamento de antes", () => {
  for (const m of [null, undefined, 0, -2, Number.NaN]) {
    assert.equal(corrigirValorFixo(1518, 1630, "brl", m as number | null), 1630, String(m));
  }
  assert.equal(multiplicadorEfetivo(2.5), 2.5);
});

test("o multiplicador não mexe nos índices percentuais", () => {
  assert.equal(corrigirValorFixo(1000, 4, "percent", 3), corrigirValorFixo(1000, 4, "percent"));
});

test("o multiplicador arredonda no centavo e o negociado continua vencendo", () => {
  assert.equal(corrigirValorFixo(0, 1630.33, "brl", 1.5), 2445.5);
  const serie = projetarValorFixoSerie(2277, 1630, 1, "brl", 2500, 1.5);
  assert.equal(serie[0], 2500);
});

test("a lista vai de 0,5× a 5× e o rótulo usa vírgula", () => {
  assert.equal(MULTIPLICADORES_SM[0], 0.5);
  assert.equal(MULTIPLICADORES_SM[MULTIPLICADORES_SM.length - 1], 5);
  assert.ok(MULTIPLICADORES_SM.includes(1));
  assert.equal(rotuloMultiplicador(1.5), "1,5×");
  assert.equal(rotuloMultiplicador(null), "1×");
});
