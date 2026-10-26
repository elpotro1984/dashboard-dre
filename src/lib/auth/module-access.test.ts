import assert from "node:assert/strict";
import { test } from "node:test";

import { computeModuleAccess, type ModuleAccessInput } from "@/lib/auth/module-access";

const base: ModuleAccessInput = {
  email: "pessoa@exemplo.com",
  profile: "solicitante",
  legacyRole: null,
  contractsOnly: false,
  canFinanceiro: false,
  canCompras: false,
  canCase: false,
  canViagens: false,
  canViagensAprovar: false,
  moduleRoles: null,
};

test("admin pela coluna legada users.role também é admin", () => {
  const a = computeModuleAccess({ ...base, profile: "gerente", legacyRole: "admin" });
  assert.equal(a.isAdmin, true);
  assert.equal(a.canCase, true);
  assert.equal(a.canCaixa, true);
  assert.equal(a.canContratos, true);
});

test("admin NÃO herda o VB (só a concessão)", () => {
  const a = computeModuleAccess({ ...base, profile: "admin" });
  assert.equal(a.vbRole, null);
  assert.equal(a.orcamentoPapel, "admin");
});

test("admin herda o DP como gestor (26/10/2026), inclusive pela coluna legada", () => {
  assert.equal(computeModuleAccess({ ...base, profile: "admin" }).dpRole, "gestor");
  assert.equal(computeModuleAccess({ ...base, profile: "gerente", legacyRole: "admin" }).dpRole, "gestor");
  assert.equal(computeModuleAccess(base).dpRole, null);
});

test("e-mail bloqueado não entra no DP mesmo com a concessão", () => {
  const a = computeModuleAccess({
    ...base,
    profile: "admin",
    email: "carol@quokka.net.br",
    moduleRoles: [{ module: "dp", role: "gestor" }],
  });
  assert.equal(a.dpRole, null);
});

test("validador de contrato e flag legado implicam o módulo Contratos", () => {
  assert.equal(computeModuleAccess({ ...base, profile: "validador_contrato" }).canContratos, true);
  assert.equal(computeModuleAccess({ ...base, contractsOnly: true }).canContratos, true);
  assert.equal(computeModuleAccess(base).canContratos, false);
});

test("Compras: perfil sem a marca can_compras não ganha papel; franqueado nunca", () => {
  assert.deepEqual(computeModuleAccess({ ...base, profile: "diretor" }).ctrlRoles, []);
  assert.deepEqual(
    computeModuleAccess({ ...base, profile: "diretor", canCompras: true }).ctrlRoles,
    ["diretor"],
  );
  assert.deepEqual(
    computeModuleAccess({ ...base, profile: "franqueado", canCompras: true }).ctrlRoles,
    [],
  );
});

test("Orçamento: a concessão só vale para perfil elegível", () => {
  const rows = [{ module: "orcamento", role: "auto" }];
  assert.equal(computeModuleAccess({ ...base, profile: "gerente", moduleRoles: rows }).orcamentoPapel, "construtor_amplo");
  assert.equal(computeModuleAccess({ ...base, profile: "gerente_setor", moduleRoles: rows }).orcamentoPapel, "construtor");
  assert.equal(computeModuleAccess({ ...base, profile: "diretor", moduleRoles: rows }).orcamentoPapel, "validador");
  assert.equal(computeModuleAccess({ ...base, profile: "solicitante", moduleRoles: rows }).orcamentoPapel, null);
});

// ── Perfil POR MÓDULO (passo 2) ─────────────────────────────────────────────

test("sem linha gravada, os perfis por módulo são os do users.profile", () => {
  assert.equal(computeModuleAccess({ ...base, profile: "franqueado" }).financeiroPerfil, "visao_financeira");
  assert.equal(computeModuleAccess({ ...base, profile: "csc" }).financeiroPerfil, "csc");
  assert.equal(computeModuleAccess({ ...base, profile: "diretor", canFinanceiro: true }).financeiroPerfil, "legado");
  assert.equal(computeModuleAccess({ ...base, profile: "diretor" }).financeiroPerfil, null);
  assert.equal(computeModuleAccess({ ...base, profile: "gerente_setor" }).comprasPerfil, "gerente_setor");
  assert.equal(computeModuleAccess({ ...base, profile: "franqueado" }).comprasPerfil, null);
  assert.equal(computeModuleAccess({ ...base, profile: "admin" }).comprasPerfil, null);
  assert.equal(computeModuleAccess({ ...base, profile: "admin" }).financeiroPerfil, null);
});

test("Visão Financeira gravada + Diretor no Compras", () => {
  const a = computeModuleAccess({
    ...base,
    profile: "diretor",
    canFinanceiro: true,
    canCompras: true,
    moduleRoles: [{ module: "financeiro", role: "visao_financeira" }],
  });
  assert.equal(a.financeiroPerfil, "visao_financeira");
  assert.equal(a.comprasPerfil, "diretor");
  assert.deepEqual(a.ctrlRoles, ["diretor"]);
});

test("perfil do Compras gravado vale mesmo com profile franqueado", () => {
  const rows = [{ module: "compras", role: "gerente_setor" }];
  const a = computeModuleAccess({ ...base, profile: "franqueado", canCompras: true, moduleRoles: rows });
  assert.equal(a.comprasPerfil, "gerente_setor");
  assert.deepEqual(a.ctrlRoles, ["gerente"]);
  // Sem a marca do módulo, o perfil gravado não dá papel nenhum.
  assert.deepEqual(computeModuleAccess({ ...base, profile: "franqueado", moduleRoles: rows }).ctrlRoles, []);
});

test("admin e validador de contrato ignoram perfil gravado", () => {
  const rows = [
    { module: "compras", role: "solicitante" },
    { module: "financeiro", role: "visao_financeira" },
  ];
  const adm = computeModuleAccess({ ...base, profile: "admin", canCompras: true, moduleRoles: rows });
  assert.deepEqual(adm.ctrlRoles, ["admin"]);
  assert.equal(adm.financeiroPerfil, null);
  const val = computeModuleAccess({ ...base, profile: "validador_contrato", canCompras: true, moduleRoles: rows });
  assert.deepEqual(val.ctrlRoles, []);
  assert.equal(val.financeiroPerfil, null);
});

test("valor desconhecido na linha gravada falha fechado (cai no perfil de hoje)", () => {
  const a = computeModuleAccess({
    ...base,
    profile: "solicitante",
    canCompras: true,
    moduleRoles: [
      { module: "compras", role: "admin" },
      { module: "financeiro", role: "tudo" },
    ],
  });
  assert.deepEqual(a.ctrlRoles, ["solicitante"]);
  assert.equal(a.financeiroPerfil, null);
});

test("Orçamento: Preenchedor amplo gravado", () => {
  const a = computeModuleAccess({
    ...base,
    profile: "gerente_setor",
    moduleRoles: [{ module: "orcamento", role: "construtor_amplo" }],
  });
  assert.equal(a.orcamentoPapel, "construtor_amplo");
});
