import assert from "node:assert/strict";
import { test } from "node:test";

import { canAccessPathByProfile } from "@/lib/auth/access";
import { computeModuleAccess, type ModuleRoleRow } from "@/lib/auth/module-access";
import type { UserProfileType } from "@/lib/supabase/types";

// Passo 2 do desenho "módulo → perfil" (docs/superpowers/specs/
// 2026-10-26-usuarios-modulo-perfil.md): sem perfil gravado, passar os perfis
// por módulo para canAccessPathByProfile tem de dar EXATAMENTE o resultado de
// antes, para todo perfil × combinação de módulos × e-mail × rota.

const PERFIS: UserProfileType[] = [
  "admin",
  "contas_a_pagar",
  "gerente",
  "gerente_setor",
  "diretor",
  "validador_contrato",
  "solicitante",
  "franqueado",
  "csc",
];
const ROTAS = [
  "/home",
  "/dashboard",
  "/fluxo-de-caixa",
  "/budget-forecast",
  "/comparativos-anuais",
  "/kpis",
  "/conexoes",
  "/financeiro/business-intelligence",
  "/financeiro/documentos",
  "/financeiro/validacao-relatorio",
  "/financeiro/relatorios",
  "/mapeamento",
  "/configuracoes",
  "/s/x/dashboard",
  "/s/x/kpis",
  "/s/x/mapeamento",
  "/ctrl",
  "/ctrl/requisicoes",
  "/ctrl/aprovacoes",
  "/ctrl/contas-a-pagar",
  "/ctrl/orcamento",
  "/ctrl/orcamento/editar",
  "/ctrl/relatorios",
  "/ctrl/admin/fornecedores",
  "/ctrl/configuracoes",
  "/ctrl/manual",
  "/orcamento",
  "/case",
  "/contratos",
  "/caixa",
  "/dp",
  "/vb",
  "/usuarios",
  "/admin",
  "/pendente",
];
// null, um e-mail com liberações nominais (Validação Relatório + visão completa
// do Compras) e um sem nada.
const EMAILS = [null, "marcela@quokka.net.br", "fulano@exemplo.com"];

test("sem perfil gravado, os perfis por módulo não mudam rota nenhuma", () => {
  let casos = 0;
  for (const profile of PERFIS) {
    for (let mask = 0; mask < 4; mask++) {
      const canFinanceiro = Boolean(mask & 1);
      const canCompras = Boolean(mask & 2);
      for (const email of EMAILS) {
        const a = computeModuleAccess({
          email,
          profile,
          legacyRole: null,
          contractsOnly: false,
          canFinanceiro,
          canCompras,
          canCase: false,
          canViagens: false,
          canViagensAprovar: false,
          moduleRoles: null,
        });
        const perfis = { financeiro: a.financeiroPerfil, compras: a.comprasPerfil };
        for (const r of ROTAS) {
          const antes = canAccessPathByProfile(r, profile, canFinanceiro, canCompras, false, false, false, email);
          const depois = canAccessPathByProfile(
            r, profile, canFinanceiro, canCompras, false, false, false, email,
            false, false, false, false, perfis,
          );
          assert.equal(depois, antes, `${profile} fin=${canFinanceiro} compras=${canCompras} ${email} ${r}`);
          casos++;
        }
      }
    }
  }
  assert.ok(casos > 3000);
});

function rota(path: string, profile: UserProfileType, rows: ModuleRoleRow[]): boolean {
  const email = "fulano@exemplo.com";
  const a = computeModuleAccess({
    email,
    profile,
    legacyRole: null,
    contractsOnly: false,
    canFinanceiro: true,
    canCompras: true,
    canCase: false,
    canViagens: false,
    canViagensAprovar: false,
    moduleRoles: rows,
  });
  return canAccessPathByProfile(path, profile, true, true, false, false, false, email,
    false, false, false, false, { financeiro: a.financeiroPerfil, compras: a.comprasPerfil });
}

test("Visão Financeira + Diretor: whitelist no Financeiro, regras de diretor no Compras", () => {
  const rows = [{ module: "financeiro", role: "visao_financeira" }];
  assert.equal(rota("/dashboard", "diretor", rows), true);
  assert.equal(rota("/financeiro/business-intelligence", "diretor", rows), true);
  assert.equal(rota("/conexoes", "diretor", rows), false);
  assert.equal(rota("/financeiro/relatorios", "diretor", rows), false);
  assert.equal(rota("/s/x/mapeamento", "diretor", rows), false);
  assert.equal(rota("/ctrl/aprovacoes", "diretor", rows), true);
  assert.equal(rota("/ctrl/relatorios", "diretor", rows), true);
  assert.equal(rota("/ctrl/contas-a-pagar", "diretor", rows), false);
  assert.equal(rota("/ctrl/configuracoes", "diretor", rows), false);
  assert.equal(rota("/usuarios", "diretor", rows), false);
  assert.equal(rota("/admin", "diretor", rows), false);
});

test("CSC gravado + Contas a Pagar: Validação Relatório e o Contas a Pagar", () => {
  const rows = [{ module: "financeiro", role: "csc" }];
  assert.equal(rota("/financeiro/validacao-relatorio", "contas_a_pagar", rows), true);
  assert.equal(rota("/ctrl/contas-a-pagar", "contas_a_pagar", rows), true);
  assert.equal(rota("/conexoes", "contas_a_pagar", rows), false);
});

test("franqueado com perfil do Compras gravado entra no /ctrl conforme o perfil", () => {
  const rows = [{ module: "compras", role: "solicitante" }];
  assert.equal(rota("/ctrl/requisicoes", "franqueado", rows), true);
  assert.equal(rota("/ctrl/aprovacoes", "franqueado", rows), false);
  assert.equal(rota("/dashboard", "franqueado", rows), true);
  assert.equal(rota("/conexoes", "franqueado", rows), false);
});

test("franqueado SEM perfil do Compras continua fora do /ctrl", () => {
  assert.equal(rota("/ctrl/requisicoes", "franqueado", []), false);
});
