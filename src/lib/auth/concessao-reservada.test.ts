import assert from "node:assert/strict";
import { test } from "node:test";

import {
  acrescimosReservados,
  AVISO_EMPRESA_RESERVADA,
  CONCEDENTE_RESERVADO_ID,
  EMPRESAS_RESERVADAS,
  empresaReservada,
  podeConcederReservado,
  type EscopoDeEmpresas,
} from "@/lib/auth/concessao-reservada";
import { describeUserExceptions, findOrphanExceptionRules } from "@/lib/auth/user-exceptions";

const CAROL = "4e1d3d71-4ff0-406a-b47d-18144884ae62";
const MARCELO = "bb98c142-3d9c-450c-b8b8-da88320e4d6b";
const [DATAFORTE, VE, SPDX] = EMPRESAS_RESERVADAS.map((e) => e.id);
const VE_FILIAL = "b038d29a-5da4-4f7b-abb7-a3846f2c7ac9";

const vazio: EscopoDeEmpresas = { financeiro: [], orcamento: [], setoresOrcamento: {} };

test("só o Lucas concede o reservado — nem os outros admins, nem ninguém sem sessão", () => {
  assert.equal(podeConcederReservado(CONCEDENTE_RESERVADO_ID), true);
  assert.equal(podeConcederReservado(CAROL), false);
  assert.equal(podeConcederReservado(MARCELO), false);
  assert.equal(podeConcederReservado(null), false);
  assert.equal(podeConcederReservado(""), false);
});

test("as três empresas são reservadas; a VE Franqueadora Filial não", () => {
  assert.deepEqual(EMPRESAS_RESERVADAS.map((e) => e.nome), ["Dataforte", "VE Franqueadora", "SPDX"]);
  for (const id of [DATAFORTE, VE, SPDX]) assert.equal(empresaReservada(id), true);
  assert.equal(empresaReservada(VE_FILIAL), false);
  assert.equal(AVISO_EMPRESA_RESERVADA, "Só Lucas Meireles libera acesso a Dataforte, VE Franqueadora e SPDX.");
});

test("acrescentar uma empresa reservada, em qualquer módulo, é acréscimo", () => {
  assert.deepEqual(acrescimosReservados({ ...vazio, financeiro: [DATAFORTE, "outra"] }, vazio), [DATAFORTE]);
  assert.deepEqual(acrescimosReservados({ ...vazio, orcamento: [SPDX] }, vazio), [SPDX]);
  // Já ter no Financeiro não autoriza a dar no Orçamento.
  assert.deepEqual(acrescimosReservados({ ...vazio, financeiro: [VE], orcamento: [VE] }, { ...vazio, financeiro: [VE] }), [VE]);
});

test("manter ou TIRAR uma reservada é livre; empresa comum também", () => {
  const atual = { ...vazio, financeiro: [DATAFORTE], orcamento: [VE], setoresOrcamento: { [VE]: ["Marketing", "TI"] } };
  assert.deepEqual(acrescimosReservados(atual, atual), []);
  assert.deepEqual(acrescimosReservados(vazio, atual), [], "tirar tudo");
  assert.deepEqual(acrescimosReservados({ ...atual, setoresOrcamento: { [VE]: ["TI"] } }, atual), [], "tirar um setor");
  assert.deepEqual(acrescimosReservados({ ...vazio, financeiro: ["comum", VE_FILIAL] }, vazio), []);
});

test("setor novo do Orçamento numa reservada amplia o acesso lá dentro — é acréscimo", () => {
  const atual = { ...vazio, orcamento: [VE], setoresOrcamento: { [VE]: ["Marketing"] } };
  const pedido = { ...atual, setoresOrcamento: { [VE]: ["Marketing", "Diretoria"] } };
  assert.deepEqual(acrescimosReservados(pedido, atual), [VE]);
});

test("catálogo: a regra do DP só aparece para quem o concede; a das empresas, para todos", () => {
  const lucas = { id: CONCEDENTE_RESERVADO_ID, email: "lucas@quokka.net.br" };
  assert.deepEqual(describeUserExceptions(lucas).map((e) => e.key), ["empresas-reservadas"]);
  assert.deepEqual(describeUserExceptions(lucas, { verDp: true }).map((e) => e.key), ["empresas-reservadas", "dp-concedente"]);
  // A Carol não tem mais regra própria: o DP dela é decidido pela concessão, como o de todo mundo.
  assert.deepEqual(describeUserExceptions({ id: CAROL, email: "carol@quokka.net.br" }, { verDp: true }), []);
});

test("catálogo: sem o Lucas na base, a regra reservada aparece como órfã", () => {
  const orfas = findOrphanExceptionRules([{ id: CAROL, email: "carol@quokka.net.br" }]).map((r) => r.key);
  assert.ok(orfas.includes("concessao-reservada"));
  const comLucas = findOrphanExceptionRules([{ id: CONCEDENTE_RESERVADO_ID, email: "lucas@quokka.net.br" }]).map((r) => r.key);
  assert.ok(!comLucas.includes("concessao-reservada"));
});
