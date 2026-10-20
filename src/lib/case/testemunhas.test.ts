import { test } from "node:test";
import assert from "node:assert/strict";

import { testemunhasQueAssinam } from "./testemunhas";

const vazio = {
  testemunha_1_nome: null,
  testemunha_1_cpf: null,
  testemunha_1_email: null,
  testemunha_2_nome: null,
  testemunha_2_cpf: null,
  testemunha_2_email: null,
};

test("as duas com e-mail assinam, na ordem", () => {
  const r = testemunhasQueAssinam({
    ...vazio,
    testemunha_1_nome: "Ana Lima", testemunha_1_email: "ana@x.com",
    testemunha_2_nome: " João Reis ", testemunha_2_cpf: "", testemunha_2_email: " joao@x.com ",
  });
  assert.deepEqual(r, [
    { ordem: 1, nome: "Ana Lima", cpf: null, email: "ana@x.com" },
    { ordem: 2, nome: "João Reis", cpf: null, email: "joao@x.com" },
  ]);
});

test("sem e-mail a testemunha fica só no PDF", () => {
  const r = testemunhasQueAssinam({ ...vazio, testemunha_1_nome: "Ana", testemunha_2_nome: "João", testemunha_2_email: "joao@x.com" });
  assert.deepEqual(r.map((t) => [t.ordem, t.nome]), [[2, "João"]]);
  assert.deepEqual(testemunhasQueAssinam({ ...vazio, testemunha_1_email: "   " }), []);
});
