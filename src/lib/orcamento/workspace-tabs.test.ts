// Quais seções de Configuração da empresa aparecem.

import test from "node:test";
import assert from "node:assert/strict";

import { CONFIG_SECOES, configSecoesVisiveis, isConfigSecao } from "./workspace-tabs";

test("com o DP alcançando a empresa, aparecem TODAS as seções", () => {
  assert.deepEqual(
    configSecoesVisiveis({ alcancaDp: true }).map((s) => s.slug),
    CONFIG_SECOES.map((s) => s.slug),
  );
});

test("sem alcance no DP, some só o que depende dele", () => {
  const visiveis = configSecoesVisiveis({ alcancaDp: false }).map((s) => s.slug);
  assert.ok(!visiveis.includes("dp-colaboradores"), "o card do DP não é oferecido");
  // As outras não podem sumir junto: o recorte é do DP, não da Configuração.
  const esperado = CONFIG_SECOES.filter((s) => !s.requerDp).map((s) => s.slug);
  assert.deepEqual(visiveis, esperado);
  assert.equal(visiveis.length, CONFIG_SECOES.length - 1);
});

test("exatamente UMA seção depende do DP hoje", () => {
  // Se outra passar a depender, é para o teste acima ser relido junto — o card
  // escondido continua alcançável por URL, e quem o esconde precisa ter
  // conferido que a action correspondente também recusa.
  const comDp = CONFIG_SECOES.filter((s) => s.requerDp).map((s) => s.slug);
  assert.deepEqual(comDp, ["dp-colaboradores"]);
});

test("esconder do hub NÃO invalida a rota", () => {
  // `isConfigSecao` é só a validade do slug (404 de rota inexistente). Quem
  // recusa a seção escondida é a action, com o motivo — ver `autorizarSyncDp`.
  assert.equal(isConfigSecao("dp-colaboradores"), true);
  assert.equal(isConfigSecao("secao-que-nao-existe"), false);
});
