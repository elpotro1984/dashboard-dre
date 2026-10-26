import type { CtrlUserContext } from "@/lib/ctrl/auth";
import type { CtrlOrg } from "@/lib/ctrl/orgs";
import { isCtrlOrgRole, resolveCtrlRolesForOrg } from "@/lib/ctrl/roles";
import { deriveDreRole, type UserProfileEnum } from "@/lib/auth/derive-roles";
import { computeModuleAccess } from "@/lib/auth/module-access";
import type { DreRole } from "@/lib/supabase/types";

// Monta o CtrlUserContext de quem age numa chamada da API externa — o mesmo
// objeto que getCtrlUser montaria pela sessão, com a empresa FORÇADA para a do
// cliente. Puro (recebe as linhas já lidas) para ser testável.

export interface ExtUserRow {
  id: string;
  email: string;
  name: string | null;
  role: string | null;
  profile: string | null;
  active: boolean;
  can_compras: boolean | null;
  user_module_roles: Array<{ role: string; module: string }> | null;
  user_sectors: Array<{ sector_id: string }> | null;
}

export type ExtIdentityResult =
  | { ok: true; ctx: CtrlUserContext }
  | { ok: false; error: string };

/** Escapa curingas do ILIKE: "_" é comum em e-mail e casaria com qualquer caractere. */
export function escapeIlike(value: string): string {
  return value.replace(/[\\%_]/g, (c) => `\\${c}`);
}

export function buildExtCtrlUser(
  email: string,
  user: ExtUserRow | null,
  org: CtrlOrg,
  /** Linha de ctrl_user_orgs do usuário NESTA empresa; undefined = sem concessão. */
  grant: { role: string | null } | undefined,
): ExtIdentityResult {
  if (!user) return { ok: false, error: `Usuário ${email} não cadastrado no Control Hub.` };
  if (!user.active) return { ok: false, error: `Usuário ${email} está inativo no Control Hub.` };
  // Concessão explícita, inclusive para admin: quem age pela API da Feat tem de
  // estar cadastrado na Feat — admin "ver tudo" não vale aqui.
  if (!grant) {
    return { ok: false, error: `Usuário ${email} não tem acesso à empresa ${org.nome} no Compras.` };
  }

  const profile = (user.profile ?? null) as UserProfileEnum | null;
  // Mesma conta da sessão: perfil do Compras gravado ?? o do users.profile.
  const access = computeModuleAccess({
    email: user.email,
    profile,
    legacyRole: user.role,
    contractsOnly: false,
    canFinanceiro: false,
    canCompras: Boolean(user.can_compras),
    canCase: false,
    canViagens: false,
    canViagensAprovar: false,
    moduleRoles: user.user_module_roles,
  });
  const globalRoles = access.ctrlRoles;
  const ctrlRoles = resolveCtrlRolesForOrg(
    profile,
    globalRoles,
    isCtrlOrgRole(grant.role) ? grant.role : null,
  );
  if (ctrlRoles.length === 0) {
    return { ok: false, error: `Usuário ${email} não tem o módulo Compras.` };
  }

  return {
    ok: true,
    ctx: {
      id: user.id,
      name: user.name,
      email: user.email,
      dreRole: deriveDreRole(profile, user.role as DreRole | null),
      profile: access.comprasPerfil ?? profile ?? "solicitante",
      ctrlRoles,
      sectorIds: (user.user_sectors ?? []).map((s) => s.sector_id),
      orgs: [org],
      orgIds: [org.id],
      orgId: org.id,
    },
  };
}
