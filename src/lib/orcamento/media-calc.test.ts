// Média com correção de índices — meses de incidência.

import test from "node:test";
import assert from "node:assert/strict";

import { normalizarMesesIncidencia, projetarMedia, serieMediaMensal } from "./media-calc";

test("sem seleção, a média cai nos 12 meses", () => {
  assert.deepEqual(serieMediaMensal(100, null), Array(12).fill(100));
});

test("só os meses marcados recebem o valor; os outros ficam zerados", () => {
  const s = serieMediaMensal(100, [3, 7, 12]);
  assert.equal(s[2], 100);
  assert.equal(s[6], 100);
  assert.equal(s[11], 100);
  assert.equal(s.filter((v) => v === 0).length, 9);
  assert.equal(s.reduce((a, b) => a + b, 0), 300);
});

test("a seleção não muda o cálculo da média nem a correção", () => {
  const proj = projetarMedia(1000, 5)!;
  const s = serieMediaMensal(proj, [1]);
  assert.ok(Math.abs(s[0] - 1050) < 1e-9);
});

test("todos marcados, vazio ou inválido voltam a null (12 meses)", () => {
  assert.equal(normalizarMesesIncidencia([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]), null);
  assert.equal(normalizarMesesIncidencia([]), null);
  assert.equal(normalizarMesesIncidencia([0, 13, "x"]), null);
  assert.equal(normalizarMesesIncidencia(null), null);
});

test("normaliza: ordena, tira duplicado e aceita string numérica do banco", () => {
  assert.deepEqual(normalizarMesesIncidencia([12, "3", 3, 7]), [3, 7, 12]);
});
