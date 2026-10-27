// A chave "usa grupos de despesa" — o que uma tabela VAZIA significa.

import test from "node:test";
import assert from "node:assert/strict";

import { gruposAtivosNaEmpresa } from "./grupos-ativo";

const A = "11111111-1111-1111-1111-111111111111";
const B = "22222222-2222-2222-2222-222222222222";

test("tabela VAZIA = nenhuma empresa usa grupos", () => {
  // É o padrão pedido em 27/10/2026, e é o oposto de `orcamento_metodos_ocultos`
  // (onde a lista é de exclusões e o vazio significa "tudo aparece"). Quem ler
  // as duas tabelas por analogia erra aqui — por isso o teste.
  assert.equal(gruposAtivosNaEmpresa(new Set(), A), false);
});

test("existe linha = a empresa usa grupos", () => {
  assert.equal(gruposAtivosNaEmpresa(new Set([A]), A), true);
});

test("a linha de uma empresa não liga a outra", () => {
  assert.equal(gruposAtivosNaEmpresa(new Set([A]), B), false);
});

test("empresa não informada não liga nada", () => {
  // Sem empresa não há chave para consultar; ligar seria mostrar o cadastro de
  // uma empresa que ninguém escolheu.
  for (const vazio of [null, undefined, ""]) {
    assert.equal(gruposAtivosNaEmpresa(new Set([A]), vazio), false);
  }
});
