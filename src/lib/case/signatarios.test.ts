import { test } from "node:test";
import assert from "node:assert/strict";

import { lerSignatarios } from "./signatarios";

const PEDRO = "pedro@caseshows.com.br";

const doc = (signers: unknown[]) => ({ key: "d1", status: "running", signers });

test("cliente assinou, testemunha falta, contratado na fila", () => {
  const r = lerSignatarios(
    doc([
      { name: "Pedro", email: PEDRO, sign_as: "contractor", group: 2 },
      { name: "Ana", email: "ana@x.com", sign_as: "contractor", group: 1, signature: { signed_at: "2026-10-10T12:00:00Z" } },
      { name: "João", email: "joao@x.com", sign_as: "witness", group: 1 },
    ]),
    PEDRO,
  );
  assert.deepEqual(
    r.map((s) => [s.nome, s.papel, s.situacao]),
    [
      ["Ana", "Contratante", "assinou"],
      ["João", "Testemunha", "aguardando"],
      ["Pedro", "Contratado", "na_fila"],
    ],
  );
  assert.equal(r[0].assinadoEm, "2026-10-10T12:00:00Z");
});

test("grupo 1 completo passa a vez ao contratado", () => {
  const r = lerSignatarios(
    doc([
      { name: "Ana", email: "ana@x.com", sign_as: "contractor", group: 1, signature: { signed_at: "2026-10-10" } },
      { name: "Pedro", email: "PEDRO@caseshows.com.br", sign_as: "contractor", group: 2 },
    ]),
    PEDRO,
  );
  assert.equal(r[1].papel, "Contratado");
  assert.equal(r[1].situacao, "aguardando");
});

test("sem grupo (sequência desligada) todos aguardam juntos", () => {
  const r = lerSignatarios(doc([{ name: "Ana", email: "a@x" }, { name: "Bia", email: "b@x" }]), PEDRO);
  assert.deepEqual(r.map((s) => s.situacao), ["aguardando", "aguardando"]);
});

test("signed_at fora de signature também conta; nome vazio cai no e-mail", () => {
  const r = lerSignatarios(doc([{ email: "a@x", signed_at: "2026-10-01" }]), PEDRO);
  assert.equal(r[0].nome, "a@x");
  assert.equal(r[0].situacao, "assinou");
});

test("documento sem signers devolve lista vazia", () => {
  assert.deepEqual(lerSignatarios({}, PEDRO), []);
  assert.deepEqual(lerSignatarios(null, PEDRO), []);
});
