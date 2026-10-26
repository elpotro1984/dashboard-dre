import "server-only";

import { cache } from "react";

import type { DpRole } from "@/lib/auth/dp";
import { getSessionContext } from "@/lib/auth/session";
import { podeVerEmpresa, type DpEscopo } from "@/lib/dp/escopo";
import { createAdminClient } from "@/lib/supabase/admin";

export interface DpUserContext extends DpEscopo {
  id: string;
  name: string | null;
  email: string;
  role: DpRole;
}

/**
 * Empresas liberadas no DP (`dp_user_empresas`) — para os DOIS papéis desde
 * 26/10/2026 (tela de Usuários módulo → perfil: a Visão Estratégica também é
 * por empresa). Só o admin COM a concessão vê todas. Tabela ausente = nenhuma
 * empresa — falha fechada, nunca "todas".
 */
export async function empresasDoAnalista(userId: string): Promise<string[]> {
  const { data, error } = await createAdminClient().from("dp_user_empresas").select("company_id").eq("user_id", userId);
  if (error) {
    console.error("[dp] dp_user_empresas:", error.message);
    return [];
  }
  return (data ?? []).map((r) => r.company_id as string);
}

/**
 * Escopo de empresa — usado também pela tela inicial, e só para quem JÁ tem a
 * concessão do DP (admin não herda o módulo). Admin com a concessão vê todas as
 * empresas; os demais, só as marcadas para eles.
 */
export async function escopoDp(userId: string, role: DpRole, isAdmin: boolean): Promise<DpEscopo> {
  return { role, empresas: isAdmin ? null : await empresasDoAnalista(userId) };
}

/**
 * Contexto do usuário no Departamento Pessoal, ou null sem concessão — admin
 * incluso (ver @/lib/auth/dp). Memoizado por requisição: layout, página e
 * action pedem o mesmo.
 */
export const getDpUser = cache(async (): Promise<DpUserContext | null> => {
  const ctx = await getSessionContext();
  if (!ctx.user || !ctx.profile || !ctx.modules?.dp) return null;
  const role = ctx.modules.dp.role;
  return {
    id: ctx.profile.id,
    name: ctx.profile.name,
    email: ctx.profile.email,
    ...(await escopoDp(
      ctx.profile.id,
      role,
      ctx.profile.profile === "admin" || ctx.profile.role === "admin",
    )),
  };
});

/**
 * Guard de TODA server action e rota de API do módulo. Lança "Acesso negado."
 * sem concessão. As tabelas `dp_*` são escritas pelo admin client DEPOIS deste
 * guard; quando a ação é de UMA empresa, chame também `exigirEmpresa`.
 */
export async function requireDpUser(): Promise<DpUserContext> {
  const user = await getDpUser();
  if (!user) throw new Error("Acesso negado.");
  return user;
}

/** Só o gestor: Configurações, Acessos, de-para de empresas, sincronização. */
export async function requireDpGestor(): Promise<DpUserContext> {
  const user = await requireDpUser();
  if (user.role !== "gestor") throw new Error("Acesso restrito ao gestor do Departamento Pessoal.");
  return user;
}

/** A pessoa pode mexer nesta empresa? Lança se não — a analista não alcança empresa de outra. */
export function exigirEmpresa(user: DpUserContext, companyId: string | null): void {
  if (!podeVerEmpresa(user, companyId)) throw new Error("Você não tem acesso a esta empresa no Departamento Pessoal.");
}

/** Guard de action de UMA empresa: concessão + a empresa no escopo da pessoa. */
export async function requireDpEmpresa(companyId: string | null): Promise<DpUserContext> {
  const user = await requireDpUser();
  exigirEmpresa(user, companyId);
  return user;
}
