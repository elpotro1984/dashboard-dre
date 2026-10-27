import assert from "node:assert/strict";
import { test } from "node:test";

import { escolherEmpresaAtiva, escopoDeEmpresasDp, podeVerEmpresa, recortarPorEmpresa, type DpEscopo } from "@/lib/dp/escopo";

const gestor: DpEscopo = { role: "gestor", empresas: null };
const analista: DpEscopo = { role: "analista", empresas: ["a", "b"] };
const semNada: DpEscopo = { role: "analista", empresas: [] };

test("gestor vê toda empresa, inclusive quem está sem empresa", () => {
  assert.equal(podeVerEmpresa(gestor, "z"), true);
  assert.equal(podeVerEmpresa(gestor, null), true);
});

test("analista vê só as liberadas e nunca 'sem empresa'", () => {
  assert.equal(podeVerEmpresa(analista, "a"), true);
  assert.equal(podeVerEmpresa(analista, "z"), false);
  assert.equal(podeVerEmpresa(analista, null), false);
});

test("analista sem empresa liberada vê ZERO (falha fechada)", () => {
  assert.equal(podeVerEmpresa(semNada, "a"), false);
  assert.deepEqual(recortarPorEmpresa(semNada, [{ c: "a" }], (l) => l.c), []);
});

test("recorte: gestor recebe a lista intacta; analista, só as dela", () => {
  const linhas = [{ c: "a" }, { c: "z" }, { c: null }, { c: "b" }];
  assert.equal(recortarPorEmpresa(gestor, linhas, (l) => l.c), linhas);
  assert.deepEqual(recortarPorEmpresa(analista, linhas, (l) => l.c), [{ c: "a" }, { c: "b" }]);
});

test("empresa ativa: cookie permitido vale; cookie de outra empresa é IGNORADO", () => {
  const permitidas = [
    { id: "a", ativos: 3 },
    { id: "b", ativos: 10 },
  ];
  assert.equal(escolherEmpresaAtiva(permitidas, "a"), "a");
  assert.equal(escolherEmpresaAtiva(permitidas, "z"), "b"); // maior quadro
  assert.equal(escolherEmpresaAtiva(permitidas, null), "b");
  assert.equal(escolherEmpresaAtiva([], "a"), null);
});

test("escopo pelas empresas marcadas: admin sem nenhuma vê todas; com marcadas, só elas (a Carol)", () => {
  assert.equal(escopoDeEmpresasDp([], true), null, "admin com 'Todas as empresas'");
  assert.deepEqual(escopoDeEmpresasDp(["c1"], true), ["c1"], "admin recortado");
  assert.deepEqual(escopoDeEmpresasDp([], false), [], "quem não é admin e não tem empresa vê zero");
  assert.deepEqual(escopoDeEmpresasDp(["c1", "c2"], false), ["c1", "c2"]);
});

test("leitura das marcadas que falhou é ZERO para todos — para o admin recortado, 'nenhuma marcada' viraria todas", () => {
  assert.deepEqual(escopoDeEmpresasDp(null, true), []);
  assert.deepEqual(escopoDeEmpresasDp(null, false), []);
});
