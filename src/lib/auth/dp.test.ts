import assert from "node:assert/strict";
import { test } from "node:test";

import { canAccessPathByProfile, defaultLandingFor } from "@/lib/auth/access";
import { dpBloqueado, hasDpGrant, isDpGestorPath, isDpPath, resolveDpRole } from "@/lib/auth/dp";

test("resolveDpRole: gestor prevalece; analista sozinho é analista", () => {
  assert.equal(resolveDpRole([{ module: "dp", role: "analista" }]), "analista");
  assert.equal(
    resolveDpRole([
      { module: "dp", role: "analista" },
      { module: "dp", role: "gestor" },
    ]),
    "gestor",
  );
  assert.equal(resolveDpRole([{ module: "vb", role: "gestor" }]), null);
});

test("e-mail bloqueado não entra no DP nem com linha de gestor (sem caixa)", () => {
  const rows = [{ module: "dp", role: "gestor" }];
  assert.equal(resolveDpRole(rows, "carol@quokka.net.br"), null);
  assert.equal(resolveDpRole(rows, "  Carol@Quokka.NET.br "), null);
  assert.equal(hasDpGrant(rows, "carol@quokka.net.br"), false);
  assert.equal(dpBloqueado("carol@quokka.net.br"), true);
  assert.equal(dpBloqueado(""), false);
  assert.equal(resolveDpRole(rows, "lucas@quokka.net.br"), "gestor");
});

test("isDpGestorPath: configurações do grupo e de-para de empresas; hub e telas da empresa não", () => {
  assert.equal(isDpGestorPath("/dp/configuracoes/parametros"), true);
  assert.equal(isDpGestorPath("/dp/empresas"), true);
  assert.equal(isDpGestorPath("/dp/configuracoes"), false);
  assert.equal(isDpGestorPath("/dp/configuracoes/centros-custo"), false);
  assert.equal(isDpGestorPath("/dp/configuracoes/encargos"), false);
  // A tela de Acessos saiu em 26/10/2026 (o DP é concedido pela tela de Usuários).
  assert.equal(isDpGestorPath("/dp/configuracoes/acessos"), false);
  assert.equal(isDpGestorPath("/dp/cargos"), false);
  assert.equal(isDpGestorPath("/dp/colaboradores"), false);
  assert.equal(isDpGestorPath("/dp/configuracoesx"), false);
});

test("admin herda o DP como gestor (26/10/2026), salvo e-mail bloqueado", () => {
  assert.equal(resolveDpRole([], "fulano@exemplo.com", true), "gestor");
  assert.equal(resolveDpRole([{ module: "dp", role: "analista" }], "fulano@exemplo.com", true), "gestor");
  assert.equal(resolveDpRole([], "carol@quokka.net.br", true), null);
  assert.equal(hasDpGrant([], "fulano@exemplo.com", true), true);
  assert.equal(resolveDpRole([], "fulano@exemplo.com"), null, "sem admin e sem linha, nada");
});

test("hasDpGrant: só a linha module='dp' com papel conhecido concede", () => {
  assert.equal(hasDpGrant(null), false);
  assert.equal(hasDpGrant([]), false);
  assert.equal(hasDpGrant([{ module: "vb", role: "gestor" }]), false);
  assert.equal(hasDpGrant([{ module: "dp", role: "gestor" }]), true);
});

test("hasDpGrant: papel desconhecido ou ausente falha fechado", () => {
  assert.equal(hasDpGrant([{ module: "dp", role: "admin" }]), false);
  assert.equal(hasDpGrant([{ module: "dp" }]), false);
});

test("isDpPath: raiz e subrotas, sem casar prefixo solto", () => {
  assert.equal(isDpPath("/dp"), true);
  assert.equal(isDpPath("/dp/colaboradores"), true);
  assert.equal(isDpPath("/dpx"), false);
});

// (pathname, profile, canFinanceiro, canCompras, canCase, canViagens,
//  canContratos, email, canVb, canCaixa, canOrcamento, canDp)
const args = (canDp: boolean) =>
  [true, true, true, false, true, "x@y.z", true, true, true, canDp] as const;

test("/dp: admin SEM concessão é negado (sem override)", () => {
  assert.equal(canAccessPathByProfile("/dp", "admin", ...args(false)), false);
  assert.equal(canAccessPathByProfile("/dp/folha", "admin", ...args(false)), false);
});

test("/dp: com concessão entra, em qualquer perfil fora da ilha", () => {
  assert.equal(canAccessPathByProfile("/dp", "admin", ...args(true)), true);
  assert.equal(canAccessPathByProfile("/dp", "franqueado", ...args(true)), true);
});

test("/dp: validador de contrato segue ilha mesmo com concessão", () => {
  assert.equal(canAccessPathByProfile("/dp", "validador_contrato", ...args(true)), false);
});

test("defaultLandingFor: só o DP já tira da tela de espera", () => {
  assert.equal(
    defaultLandingFor("solicitante", false, false, false, false, false, false, false, false, true),
    "/home",
  );
});
