import type { SupabaseClient } from "@supabase/supabase-js";

import { readActiveCtrlOrgSlug, readCtrlOrgConfirmedSession } from "@/lib/context/active-context";
import { confirmationKey, needsOrgConfirmation, sessionIdFromAccessToken } from "@/lib/ctrl/org-gate";
import { isCtrlOrgRole, type CtrlOrgRole } from "@/lib/ctrl/roles";

// Empresa do Compras (a "organização de compras" — grupo de CNPJs). Ver
// docs/superpowers/specs/2026-10-06-ctrl-multiempresa-design.md.

export interface CtrlOrg {
  id: string;
  nome: string;
  slug: string;
}

export interface CtrlOrgContext {
  /** Empresas que o usuário pode acessar (admin → todas as ativas). */
  orgs: CtrlOrg[];
  orgIds: string[];
  /** Empresa ativa (cookie validado contra `orgs`; senão a 1ª). null só se não há empresa. */
  activeOrgId: string | null;
  activeOrg: CtrlOrg | null;
  /**
   * Papel do Compras do usuário NA empresa ativa (override de `ctrl_user_orgs.role`),
   * ou null = usa o perfil global. Consumido só por `resolveCtrlRolesForOrg`
   * (@/lib/ctrl/roles). Para admin vem null (admin é global) ou simplesmente é
   * ignorado na resolução. Ver o spec de 2026-10-07.
   */
  activeOrgRole: CtrlOrgRole | null;
  /**
   * true = o usuário acessa mais de uma empresa e ainda NÃO escolheu a empresa
   * neste login: o layout do Compras troca o conteúdo pela tela de seleção
   * obrigatória e as ações críticas recusam. Ver @/lib/ctrl/org-gate.
   */
  needsConfirmation: boolean;
}

/**
 * Chave do login atual para a confirmação da empresa (session_id do Supabase
 * Auth). Lida do access token do cookie — sem ida à rede; o usuário já foi
 * validado por getUser() na sessão. Usada aqui e pela rota /api/context, que
 * grava a confirmação: as duas pontas TÊM de calcular a mesma chave.
 */
export async function currentCtrlConfirmationKey(
  supabase: SupabaseClient,
  userId: string,
): Promise<string> {
  let sessionId: string | null = null;
  try {
    const { data } = await supabase.auth.getSession();
    sessionId = sessionIdFromAccessToken(data.session?.access_token);
  } catch {
    sessionId = null;
  }
  return confirmationKey(sessionId, userId);
}

/**
 * Empresas do Compras que o usuário pode acessar + qual está ativa.
 *
 * A RLS de `ctrl_orgs` já faz o recorte (admin vê todas; os demais só as
 * concedidas em `ctrl_user_orgs`), então basta ler a tabela com o client do
 * usuário — não é preciso saber aqui se é admin.
 *
 * A empresa ativa vem do cookie `active_ctrl_org`, validada contra a lista; se o
 * cookie estiver ausente ou apontar para uma empresa que o usuário não acessa,
 * cai na primeira (nunca erra por cookie velho).
 */
export async function getCtrlOrgContext(
  supabase: SupabaseClient,
  /** Usuário da sessão — necessário para a seleção obrigatória. Sem ele não há gate. */
  userId?: string | null,
): Promise<CtrlOrgContext> {
  const { data } = await supabase
    .from("ctrl_orgs")
    .select("id, nome, slug")
    .eq("ativo", true)
    .order("nome");
  const orgs = ((data ?? []) as CtrlOrg[]) ?? [];
  const orgIds = orgs.map((o) => o.id);

  // Concessões EXPLÍCITAS do usuário (ctrl_user_orgs; a RLS devolve só as dele).
  // Servem para o DEFAULT: o admin VÊ todas as empresas, mas o padrão deve ser
  // uma empresa CONCEDIDA a ele — senão uma empresa nova e vazia (ex.: a Feat,
  // primeira por ordem alfabética) viraria o padrão e a tela abriria sem dados.
  // O `role` é o override de papel POR EMPRESA (null = usa o perfil global).
  const { data: grantRows } = await supabase
    .from("ctrl_user_orgs")
    .select("org_id, role");
  const grantedIds = new Set((grantRows ?? []).map((r) => r.org_id as string));
  const roleByOrg = new Map<string, CtrlOrgRole>();
  (grantRows ?? []).forEach((r) => {
    const orgId = r.org_id as string;
    const role = (r as { role?: string | null }).role ?? null;
    if (isCtrlOrgRole(role)) roleByOrg.set(orgId, role);
  });

  const slug = await readActiveCtrlOrgSlug();
  const byCookie = slug ? orgs.find((o) => o.slug === slug) : undefined;
  const firstGranted = orgs.find((o) => grantedIds.has(o.id));
  // Precedência: cookie válido → 1ª empresa concedida → 1ª visível (fallback).
  const active = byCookie ?? firstGranted ?? orgs[0] ?? null;

  // Seleção obrigatória a cada login (só com mais de uma empresa). O fallback
  // acima continua escolhendo uma empresa para nada quebrar, mas enquanto a
  // escolha não for confirmada neste login o layout não mostra dado nenhum.
  let needsConfirmation = false;
  if (userId && orgs.length > 1) {
    const [confirmedKey, currentKey] = await Promise.all([
      readCtrlOrgConfirmedSession(),
      currentCtrlConfirmationKey(supabase, userId),
    ]);
    needsConfirmation = needsOrgConfirmation({
      orgCount: orgs.length,
      confirmedKey,
      currentKey,
      cookieSlugValid: Boolean(byCookie),
    });
  }

  return {
    orgs,
    orgIds,
    activeOrgId: active?.id ?? null,
    activeOrg: active ?? null,
    // Admin pode não ter linha para a empresa ativa (vê todas via RLS) → null,
    // que a resolução trata como "usa o global" (e admin é ignorado de todo jeito).
    activeOrgRole: active ? roleByOrg.get(active.id) ?? null : null,
    needsConfirmation,
  };
}

/**
 * CNPJs pagadores de uma empresa — alimenta o picker de empresa pagadora do
 * Contas a Pagar (restringe o pagamento aos CNPJs da empresa ativa). Lazy: só é
 * chamado onde o pagador importa, para não pesar em todo `getCtrlUser`.
 */
export async function getOrgCompanyIds(
  supabase: SupabaseClient,
  orgId: string | null,
): Promise<string[]> {
  if (!orgId) return [];
  const { data } = await supabase
    .from("ctrl_org_companies")
    .select("company_id")
    .eq("org_id", orgId);
  return (data ?? []).map((r) => r.company_id as string);
}
