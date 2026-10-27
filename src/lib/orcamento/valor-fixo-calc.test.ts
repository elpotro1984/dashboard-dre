// Valor fixo com correção de índices — e o valor NEGOCIADO que substitui o
// corrigido quando o contrato fecha num número diferente do índice.

import test from "node:test";
import assert from "node:assert/strict";

import {
  negociadoDigitado,
  projetarValorFixoSerie,
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
