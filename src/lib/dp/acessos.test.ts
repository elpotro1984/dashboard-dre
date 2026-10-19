import assert from "node:assert/strict";
import { test } from "node:test";

import { diffEmpresas, validarConcessao, validarRemocao, type DpEstadoConcessoes } from "@/lib/dp/acessos";

const empresas = new Set(["e1", "e2"]);
const ana = { id: "ana", email: "ana@x.com", active: true };
const estado = (p: Partial<DpEstadoConcessoes> = {}): DpEstadoConcessoes => ({
  quemId: "lucas",
  papelAtual: null,
  gestoresAtivos: ["lucas", "marcelo"],
  ...p,
});

test("concede analista com as empresas (sem repetir)", () => {
  const r = validarConcessao(ana, "analista", ["e1", "e1", "e2"], empresas, estado());
  assert.deepEqual(r, { ok: { acao: "concedeu", papel: "analista", empresas: ["e1", "e2"] } });
});

test("gestor não guarda lista de empresas", () => {
  const r = validarConcessao(ana, "gestor", ["e1"], empresas, estado({ papelAtual: "analista" }));
  assert.deepEqual(r, { ok: { acao: "alterou", papel: "gestor", empresas: [] } });
});

test("e-mail bloqueado nunca recebe, em nenhum papel", () => {
  const carol = { id: "c", email: "Carol@quokka.net.br", active: true };
  assert.ok("erro" in validarConcessao(carol, "analista", [], empresas, estado()));
  assert.ok("erro" in validarConcessao(carol, "gestor", [], empresas, estado()));
});

test("papel desconhecido, usuário inativo e empresa inexistente são recusados", () => {
  assert.ok("erro" in validarConcessao(ana, "admin", [], empresas, estado()));
  assert.ok("erro" in validarConcessao({ ...ana, active: false }, "analista", [], empresas, estado()));
  assert.ok("erro" in validarConcessao(ana, "analista", ["e9"], empresas, estado()));
});

test("ninguém tira o PRÓPRIO papel de gestor", () => {
  const eu = { id: "lucas", email: "lucas@x.com", active: true };
  assert.ok("erro" in validarConcessao(eu, "analista", ["e1"], empresas, estado({ papelAtual: "gestor" })));
  // Continuar gestor (ex.: salvar sem mudar) é permitido.
  assert.ok("ok" in validarConcessao(eu, "gestor", [], empresas, estado({ papelAtual: "gestor" })));
});

test("rebaixar o ÚLTIMO gestor é recusado; com outro gestor, passa", () => {
  const marcelo = { id: "marcelo", email: "m@x.com", active: true };
  const so = estado({ papelAtual: "gestor", gestoresAtivos: ["marcelo"] });
  assert.ok("erro" in validarConcessao(marcelo, "analista", [], empresas, so));
  const dois = estado({ papelAtual: "gestor", gestoresAtivos: ["lucas", "marcelo"] });
  assert.ok("ok" in validarConcessao(marcelo, "analista", [], empresas, dois));
});

test("remoção: não remove a si mesmo, nem o último gestor, nem quem não tem o módulo", () => {
  assert.ok("erro" in validarRemocao("lucas", estado({ papelAtual: "gestor" })));
  assert.ok("erro" in validarRemocao("marcelo", estado({ papelAtual: "gestor", gestoresAtivos: ["marcelo"] })));
  assert.ok("erro" in validarRemocao("ana", estado({ papelAtual: null })));
  assert.deepEqual(validarRemocao("ana", estado({ papelAtual: "analista" })), { ok: true });
  // Linha que a sessão ignora (ex.: e-mail bloqueado) pode ser limpa.
  assert.deepEqual(validarRemocao("carol", estado({ papelAtual: null, linhaSemEfeito: true })), { ok: true });
});

test("diffEmpresas: o que entra e o que sai", () => {
  assert.deepEqual(diffEmpresas(["a", "b"], ["b", "c"]), { inserir: ["c"], apagar: ["a"] });
  assert.deepEqual(diffEmpresas([], []), { inserir: [], apagar: [] });
});
