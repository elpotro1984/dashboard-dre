import { hasCaixaGrant } from "@/lib/auth/caixa";
import { hasContratosGrant } from "@/lib/auth/contratos";
import { deriveCtrlRoles, deriveDreRole } from "@/lib/auth/derive-roles";
import { resolveDpRole, type DpRole } from "@/lib/auth/dp";
import { resolveOrcamentoPapel } from "@/lib/auth/orcamento";
import { resolveVbRole } from "@/lib/auth/vb";
import { ctrlRolesFromProfile, isCtrlOrgRole, type CtrlOrgRole } from "@/lib/ctrl/roles";
import { VIAGENS_ENABLED } from "@/lib/viagens/flags";
import type {
  CtrlRole,
  DreRole,
  OrcamentoPapel,
  UserProfileType,
} from "@/lib/supabase/types";

// Acesso EFETIVO por módulo a partir da linha de `users` + `user_module_roles`.
// Puro e fora de session.ts para ser a MESMA conta na sessão e no retrato de
// permissões (scripts/usuarios-retrato-permissoes.ts) — ver
// docs/superpowers/specs/2026-10-26-usuarios-modulo-perfil.md, passo 1.
//
// A montagem é exatamente a que vivia inline em loadSessionContext; mudar uma
// regra aqui muda a sessão de todo mundo.

export type ModuleRoleRow = { module?: string | null; role?: string | null };

// ── Perfil POR MÓDULO (tela de Usuários módulo → perfil, 26/10/2026) ──────────
// Gravado como linha em user_module_roles — sem coluna nova em `users`, para o
// select da sessão nunca quebrar por migration pendente. Regra de todos os
// módulos: perfil GRAVADO ?? o que o `users.profile` dava hoje. Sem linha
// gravada, o resultado é idêntico ao de antes (é o que o retrato confere).

/** Linha do perfil do Financeiro: module='financeiro', role ∈ FINANCEIRO_PERFIS. */
export const FINANCEIRO_MODULE = "financeiro";
/**
 * Linha do perfil do Compras. NÃO é 'ctrl': linhas 'ctrl' antigas ainda existem
 * e são o fallback legado de deriveCtrlRoles para usuário sem perfil.
 */
export const COMPRAS_MODULE = "compras";

export const FINANCEIRO_PERFIS = ["visao_financeira", "csc"] as const;
/**
 * 'legado' = quem tem o Financeiro com um perfil do Compras (diretor, gerente…)
 * e ainda não foi migrado: vê as telas do Financeiro além da whitelist da
 * Visão Financeira, como hoje. Some quando todos tiverem perfil gravado.
 */
export type FinanceiroPerfil = (typeof FINANCEIRO_PERFIS)[number] | "legado";

function perfilGravado(rows: ModuleRoleRow[] | null, module: string): string | null {
  for (const row of rows ?? []) {
    if (row?.module === module && row.role) return row.role;
  }
  return null;
}

function isFinanceiroPerfilGravado(v: string | null): v is (typeof FINANCEIRO_PERFIS)[number] {
  return v !== null && (FINANCEIRO_PERFIS as readonly string[]).includes(v);
}

/**
 * Perfil do Financeiro que o `users.profile` dá hoje. É também o que
 * `canAccessPathByProfile` assume quando não recebe os perfis por módulo.
 */
export function financeiroPerfilDoPerfil(
  profile: UserProfileType | null,
  canFinanceiro: boolean,
): FinanceiroPerfil | null {
  if (profile === "franqueado") return "visao_financeira";
  if (profile === "csc") return "csc";
  if (profile === "admin" || profile === "validador_contrato") return null;
  return canFinanceiro ? "legado" : null;
}

export interface ModuleAccessInput {
  email: string | null;
  profile: UserProfileType | null;
  /** Coluna legada `users.role` — é a que `is_admin()` lê no banco. */
  legacyRole: string | null;
  contractsOnly: boolean;
  canFinanceiro: boolean;
  canCompras: boolean;
  canCase: boolean;
  canViagens: boolean;
  canViagensAprovar: boolean;
  moduleRoles: ModuleRoleRow[] | null;
}

export interface ModuleAccess {
  isAdmin: boolean;
  canFinanceiro: boolean;
  canCompras: boolean;
  canCase: boolean;
  canViagens: boolean;
  canViagensAprovar: boolean;
  canContratos: boolean;
  canCaixa: boolean;
  vbRole: ReturnType<typeof resolveVbRole>;
  dpRole: DpRole | null;
  orcamentoPapel: OrcamentoPapel | null;
  dreRole: DreRole;
  ctrlRoles: CtrlRole[];
  /**
   * Perfil no Financeiro: decide a whitelist da Visão Financeira/CSC (rotas e
   * menu). null para admin (vê tudo) e para quem não tem perfil financeiro.
   */
  financeiroPerfil: FinanceiroPerfil | null;
  /**
   * Perfil no Compras (os 5 da tela). Distingue gerente × gerente_setor, que
   * dão o mesmo CtrlRole, e decide as rotas do /ctrl. null para admin.
   */
  comprasPerfil: CtrlOrgRole | null;
}

export function computeModuleAccess(input: ModuleAccessInput): ModuleAccess {
  const { profile, moduleRoles: rows } = input;
  const isAdmin = profile === "admin" || input.legacyRole === "admin";

  // Admin vive fora dos perfis por módulo (tem tudo), e o validador de contrato
  // segue ilha: linha gravada para eles é ignorada.
  const aceitaPerfilGravado = !isAdmin && profile !== "validador_contrato";

  const finGravado = perfilGravado(rows, FINANCEIRO_MODULE);
  const financeiroPerfil =
    aceitaPerfilGravado && isFinanceiroPerfilGravado(finGravado)
      ? finGravado
      : financeiroPerfilDoPerfil(profile, input.canFinanceiro);

  const comprasGravado = perfilGravado(rows, COMPRAS_MODULE);
  const comprasExplicito =
    aceitaPerfilGravado && isCtrlOrgRole(comprasGravado) ? comprasGravado : null;
  const comprasPerfil: CtrlOrgRole | null =
    comprasExplicito ?? (isCtrlOrgRole(profile) ? profile : null);

  // Com perfil do Compras gravado, os papéis saem DELE (mesmo mapeamento do
  // perfil global, ctrlRolesFromProfile). Sem, deriveCtrlRoles de hoje — que
  // inclui as saídas antecipadas (franqueado/csc, !canCompras, fallback 'ctrl').
  const ctrlRoles = comprasExplicito
    ? input.canCompras
      ? ctrlRolesFromProfile(comprasExplicito)
      : []
    : deriveCtrlRoles(profile, input.canCompras, rows as Array<{ role: string; module: string }> | null);

  return {
    isAdmin,
    canFinanceiro: input.canFinanceiro,
    canCompras: input.canCompras,
    // Admin sempre enxerga o Case (espelha has_case_access() no banco).
    canCase: input.canCase || isAdmin,
    // Admin sempre enxerga Viagens e pode aprovar (espelha has_viagens_access()).
    // VIAGENS_ENABLED=false desliga o módulo pra todos (kill-switch).
    canViagens: VIAGENS_ENABLED && (input.canViagens || isAdmin),
    canViagensAprovar: VIAGENS_ENABLED && (input.canViagensAprovar || isAdmin),
    // Concessão explícita; admin sempre; o perfil 'validador_contrato' e o flag
    // legado contracts_only continuam implicando o módulo.
    canContratos:
      hasContratosGrant(rows) ||
      profile === "validador_contrato" ||
      input.contractsOnly ||
      isAdmin,
    // Caixa: concessão OU admin (modelo do Case/Contratos, não o do VB).
    canCaixa: hasCaixaGrant(rows) || isAdmin,
    // VB: só a concessão, sem override de admin.
    vbRole: resolveVbRole(rows),
    // DP: concessão OU admin (desde 26/10/2026); e-mail bloqueado nunca.
    dpRole: resolveDpRole(rows, input.email, isAdmin),
    // Orçamento: concessão OU admin, papel derivado do perfil.
    orcamentoPapel: resolveOrcamentoPapel(profile ?? (isAdmin ? "admin" : null), rows),
    dreRole: deriveDreRole(profile, input.legacyRole as DreRole | null),
    ctrlRoles,
    financeiroPerfil,
    comprasPerfil: isAdmin ? null : comprasPerfil,
  };
}
