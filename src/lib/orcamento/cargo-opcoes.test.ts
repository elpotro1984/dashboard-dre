// O <select> de cargo nunca esconde o valor que está gravado.

import test from "node:test";
import assert from "node:assert/strict";

import {
  listaDaMovimentacao,
  opcoesDeCargo,
  rotuloOpcaoDeCargo,
} from "./cargo-opcoes";

const PLANO = [
  { label: "Analista — Júnior", salario: 3000 },
  { label: "Analista — Pleno", salario: 4000 },
];

test("sem valor gravado, a lista é a do cadastro", () => {
  assert.deepEqual(
    opcoesDeCargo(PLANO, null).map((o) => o.label),
    ["Analista — Júnior", "Analista — Pleno"],
  );
  assert.deepEqual(opcoesDeCargo(PLANO, "   ").map((o) => o.fonte), ["lista", "lista"]);
});

test("valor gravado que ESTÁ na lista não duplica", () => {
  const r = opcoesDeCargo(PLANO, "Analista — Pleno");
  assert.equal(r.length, 2);
  assert.deepEqual(r.map((o) => o.fonte), ["lista", "lista"]);
});

test("valor gravado FORA da lista entra, e entra PRIMEIRO", () => {
  // É o caso que o sync do DP cria: o cargo vem da tabela salarial do
  // Departamento Pessoal e não existe no Plano de Cargos do Orçamento. Antes
  // disto a tela mostrava "— cargo —" com o valor intacto no banco, e o
  // primeiro clique no seletor trocava um cargo que ninguém queria trocar.
  const r = opcoesDeCargo(PLANO, "Analista de Relacionamento Júnior I");
  assert.equal(r.length, 3);
  assert.equal(r[0].label, "Analista de Relacionamento Júnior I");
  assert.equal(r[0].fonte, "gravado");
  assert.equal(r[0].salario, null, "a opção sintética não sugere salário");
});

test("a opção fora do cadastro é MARCADA no rótulo", () => {
  // Escolhê-la não traz salário; sem a marca o admin conclui que o cadastro
  // tem a linha e que o salário simplesmente não veio.
  const r = opcoesDeCargo(PLANO, "Cargo antigo");
  assert.equal(rotuloOpcaoDeCargo(r[0]), "Cargo antigo (fora do cadastro)");
  assert.equal(rotuloOpcaoDeCargo(r[1]), "Analista — Júnior");
});

test("espaço em volta não cria opção duplicada", () => {
  const r = opcoesDeCargo(PLANO, "  Analista — Pleno  ");
  assert.equal(r.length, 2);
});

test("cadastro vazio com valor gravado devolve só o gravado", () => {
  const r = opcoesDeCargo([], "Qualquer coisa");
  assert.deepEqual(r, [{ label: "Qualquer coisa", salario: null, fonte: "gravado" }]);
});

test("cadastro vazio e nada gravado devolve lista vazia", () => {
  assert.deepEqual(opcoesDeCargo([], null), []);
});

// ─── De qual lista a movimentação escolhe ───────────────────────────────────

test("a movimentação prefere a tabela do DP", () => {
  assert.deepEqual(listaDaMovimentacao(["dp"], ["plano"]), ["dp"]);
});

test("sem tabela no DP, cai no Plano de Cargos em vez de ficar vazia", () => {
  // Campo vazio tiraria do gestor a única forma de preencher a movimentação;
  // degradar para o comportamento anterior é o certo.
  assert.deepEqual(listaDaMovimentacao([], ["plano"]), ["plano"]);
});

test("as duas vazias devolvem vazio, não erro", () => {
  assert.deepEqual(listaDaMovimentacao([], []), []);
});
