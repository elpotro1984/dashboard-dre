// Planejamento: o que conta como finalizado e para onde "Seguir para a próxima" leva.

import test from "node:test";
import assert from "node:assert/strict";

import {
  chaveFatiaPlanejamento,
  fatiaFinalizada,
  pendentesDeFinalizacao,
  proximaPendente,
  rotuloFatia,
  type FatiaPlanejamento,
} from "./planejamento-finalizadas";

const BALDE = "balde-nao-atribuido";

const fatia = (
  categoryName: string,
  finalizada = false,
  setorNome = "",
  setorId: string | null = setorNome ? `s-${setorNome}` : null,
): FatiaPlanejamento => ({
  categoryCode: `c-${categoryName}`,
  categoryName,
  setorId,
  setorNome,
  finalizada,
});

test("empresa SEM setor: a fatia fechada no balde 'Não atribuído' conta como finalizada", () => {
  // É onde a despesa é gravada e onde o Finalizar fecha (30/10/2026). Ler pelo
  // setor nulo deixaria o card aberto com a categoria fechada.
  const fechadas = new Set([chaveFatiaPlanejamento("2.01.99", BALDE)]);
  assert.equal(fatiaFinalizada(fechadas, "2.01.99", null, false, BALDE), true);
});

test("empresa SEM setor: a fatia fechada em setor nulo (antes da correção) também conta", () => {
  const fechadas = new Set([chaveFatiaPlanejamento("2.01.99", null)]);
  assert.equal(fatiaFinalizada(fechadas, "2.01.99", null, false, BALDE), true);
  assert.equal(fatiaFinalizada(fechadas, "2.01.99", null, false, null), true);
});

test("empresa COM setor: vale só o setor da linha", () => {
  const fechadas = new Set([chaveFatiaPlanejamento("mkt", "comercial")]);
  assert.equal(fatiaFinalizada(fechadas, "mkt", "comercial", true, null), true);
  assert.equal(fatiaFinalizada(fechadas, "mkt", "produto", true, null), false);
  // O balde não vale para quem orça por setor: ali ele é um setor como outro.
  const noBalde = new Set([chaveFatiaPlanejamento("mkt", BALDE)]);
  assert.equal(fatiaFinalizada(noBalde, "mkt", "comercial", true, BALDE), false);
});

test("a fatia de outra categoria não fecha esta", () => {
  const fechadas = new Set([chaveFatiaPlanejamento("2.04.14", BALDE)]);
  assert.equal(fatiaFinalizada(fechadas, "2.01.99", null, false, BALDE), false);
});

test("pendentes saem na ordem da lista e sem as finalizadas", () => {
  const p = pendentesDeFinalizacao([fatia("Taxas"), fatia("Limpeza", true), fatia("Aluguel")]);
  assert.deepEqual(
    p.map((f) => f.categoryName),
    ["Aluguel", "Taxas"],
  );
});

test("a próxima é a primeira em aberto DEPOIS da atual", () => {
  const fatias = [fatia("Aluguel"), fatia("Limpeza", true), fatia("Mão de obra", true), fatia("Taxas")];
  const atual = fatias[2];
  assert.equal(proximaPendente(fatias, atual)?.categoryName, "Taxas");
});

test("na última, a próxima dá a volta para a primeira em aberto", () => {
  const fatias = [fatia("Aluguel"), fatia("Limpeza", true), fatia("Taxas", true)];
  assert.equal(proximaPendente(fatias, fatias[2])?.categoryName, "Aluguel");
});

test("a atual nunca é a próxima, mesmo se ainda estiver em aberto", () => {
  const fatias = [fatia("Aluguel"), fatia("Taxas")];
  assert.equal(proximaPendente(fatias, fatias[0])?.categoryName, "Taxas");
  assert.equal(proximaPendente([fatia("Aluguel")], fatia("Aluguel")), null);
});

test("tudo finalizado: não há próxima", () => {
  const fatias = [fatia("Aluguel", true), fatia("Taxas", true)];
  assert.equal(proximaPendente(fatias, fatias[0]), null);
});

test("atual fora da lista: segue a partir de onde ela estaria na ordem", () => {
  const fatias = [fatia("Aluguel"), fatia("Limpeza"), fatia("Taxas")];
  assert.equal(proximaPendente(fatias, fatia("Energia"))?.categoryName, "Limpeza");
  assert.equal(proximaPendente(fatias, fatia("Zeladoria"))?.categoryName, "Aluguel");
});

test("com setor, a próxima pode ser a MESMA categoria em outro setor", () => {
  const fatias = [
    fatia("Marketing", true, "Comercial"),
    fatia("Marketing", false, "Produto"),
    fatia("Viagens", false, "Comercial"),
  ];
  const proxima = proximaPendente(fatias, fatias[0]);
  assert.equal(proxima?.categoryName, "Marketing");
  assert.equal(proxima?.setorNome, "Produto");
});

test("o rótulo leva o setor só quando há setor", () => {
  assert.equal(rotuloFatia(fatia("Limpeza")), "Limpeza");
  assert.equal(rotuloFatia(fatia("Marketing", false, "Comercial")), "Marketing · Comercial");
});
