import assert from "node:assert/strict";
import { test } from "node:test";

import { biValidationCompanyScope, biValidationInScope } from "@/lib/auth/bi-validation";
import { resolveAllowedCompanyIds } from "@/lib/dashboard/dre";
import { papelLegado } from "@/lib/usuarios/acessos";

// Varredura de 26/10/2026: empresa no Financeiro vem SÓ da tela de Usuários
// (user_company_access). Estes testes travam as brechas fechadas naquele dia.

const TODAS = ["a", "b", "c"];

/** Client falso: só responde a leitura de user_company_access. */
function clientCom(linhas: string[]) {
  const chain = {
    select: () => chain,
    eq: () => Promise.resolve({ data: linhas.map((company_id) => ({ company_id })), error: null }),
  };
  return { from: () => chain } as never;
}

test("Financeiro: só as empresas gravadas na tela, qualquer que seja o papel legado", async () => {
  for (const role of ["gestor_unidade", "gestor_hero"]) {
    const ids = await resolveAllowedCompanyIds(
      clientCom(["b"]),
      { id: "u", role, can_financeiro: true } as never,
      TODAS,
    );
    assert.deepEqual(ids, ["b"], role);
  }
});

test("Financeiro: sem perfil ou sem o módulo, nenhuma empresa", async () => {
  assert.deepEqual(await resolveAllowedCompanyIds(clientCom(["a"]), null, TODAS), []);
  assert.deepEqual(
    await resolveAllowedCompanyIds(
      clientCom(["a"]),
      { id: "u", role: "gestor_unidade", can_financeiro: false } as never,
      TODAS,
    ),
    [],
  );
});

test("Financeiro: lista vazia não cai no users.company_id legado", async () => {
  const ids = await resolveAllowedCompanyIds(
    clientCom([]),
    { id: "u", role: "gestor_unidade", can_financeiro: true, company_id: "a" } as never,
    TODAS,
  );
  assert.deepEqual(ids, []);
});

test("Financeiro: admin vê todas", async () => {
  const ids = await resolveAllowedCompanyIds(clientCom([]), { id: "u", role: "admin" } as never, TODAS);
  assert.deepEqual(ids, TODAS);
});

test("users.role nunca volta a ser gestor_hero (abria todas as empresas no RLS)", () => {
  for (const p of ["diretor", "contas_a_pagar", "gerente", "solicitante", "franqueado", "csc"] as const) {
    assert.equal(papelLegado(p), "gestor_unidade", p);
  }
  assert.equal(papelLegado("admin"), "admin");
});

test("Validação de Relatório BI: CSC só nas empresas do próprio Financeiro", () => {
  const csc = { profile: "csc", role: "gestor_unidade", company_ids: ["a"], can_financeiro: true } as const;
  const escopo = biValidationCompanyScope(csc as never);
  assert.ok(biValidationInScope(escopo, "a"));
  assert.ok(!biValidationInScope(escopo, "b"));
  assert.deepEqual(
    biValidationCompanyScope({ ...csc, can_financeiro: false } as never),
    [],
  );
  assert.equal(biValidationCompanyScope({ profile: "admin", role: "admin", company_ids: [] } as never), null);
});
