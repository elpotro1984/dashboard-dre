"use server";

import { revalidatePath } from "next/cache";

import { DP_MODULE, DP_PATH, resolveDpRole, type DpRole } from "@/lib/auth/dp";
import { diffEmpresas, validarConcessao, validarRemocao, type DpEstadoConcessoes } from "@/lib/dp/acessos";
import { requireDpGestor, type DpUserContext } from "@/lib/dp/auth";
import { createAdminClient } from "@/lib/supabase/admin";

// Configurações › Acessos: quem tem o DP, com qual papel e quais empresas. Só
// o GESTOR, e sempre com o admin client — a linha module='dp' em
// user_module_roles só aceita o service role (trigger dp_guard_module_grant).
// As regras (bloqueio nominal, auto-rebaixamento, último gestor) moram em
// @/lib/dp/acessos, puro e testado.

export type DpAcessoResult = { ok: true } | { ok: false; error: string };

type Admin = ReturnType<typeof createAdminClient>;

function falha(error: unknown): { ok: false; error: string } {
  const e = error as { code?: string; message?: string } | null;
  if (e?.code === "PGRST205" || e?.code === "42P01") {
    return { ok: false, error: "Acessos por empresa ainda não instalados no banco (migration 20261019120000)." };
  }
  return { ok: false, error: e?.message || "Erro inesperado." };
}

async function estadoAtual(admin: Admin, quem: DpUserContext, alvoId: string): Promise<DpEstadoConcessoes> {
  const { data, error } = await admin
    .from("user_module_roles")
    .select("user_id, role, users(email, active)")
    .eq("module", DP_MODULE);
  if (error) throw error;
  const porUser = new Map<string, { roles: Array<{ module: string; role: string }>; email: string | null; active: boolean }>();
  for (const r of data ?? []) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const u = (Array.isArray((r as any).users) ? (r as any).users[0] : (r as any).users) as { email: string; active: boolean | null } | null;
    const l = porUser.get(r.user_id as string) ?? { roles: [], email: u?.email ?? null, active: u?.active !== false };
    l.roles.push({ module: DP_MODULE, role: String(r.role) });
    porUser.set(r.user_id as string, l);
  }
  const gestoresAtivos = Array.from(porUser)
    .filter(([, l]) => l.active && resolveDpRole(l.roles, l.email) === "gestor")
    .map(([id]) => id);
  const alvo = porUser.get(alvoId);
  const papelAtual = alvo ? resolveDpRole(alvo.roles, alvo.email) : null;
  return { quemId: quem.id, papelAtual, gestoresAtivos, linhaSemEfeito: Boolean(alvo) && papelAtual === null };
}

async function empresasAtuais(admin: Admin, userId: string): Promise<string[]> {
  const { data, error } = await admin.from("dp_user_empresas").select("company_id").eq("user_id", userId);
  if (error) throw error;
  return (data ?? []).map((r) => r.company_id as string);
}

/** Trilha das concessões. Melhor esforço: a concessão já valeu; o erro vai ao log. */
async function registrar(
  admin: Admin,
  row: { alvo: string; acao: "concedeu" | "alterou" | "removeu"; papel: DpRole | null; empresas: string[]; por: string },
) {
  const { error } = await admin.from("dp_concessoes").insert({
    alvo_user_id: row.alvo,
    acao: row.acao,
    papel: row.papel,
    empresas: row.empresas,
    por_user_id: row.por,
  });
  if (error) console.error("[dp] registrar concessão falhou:", error.message);
}

/**
 * Concede ou altera o DP de um usuário. Ordem das gravações pensada para nunca
 * deixar a pessoa com MAIS acesso do que o pedido no meio do caminho: as
 * empresas são gravadas antes do papel (quem vira analista já encontra a lista
 * pronta), e o papel novo entra antes de o antigo sair (gestor → analista
 * continua gestor até o fim; nunca fica sem linha nenhuma).
 */
export async function salvarAcessoDp(input: { userId: string; papel: string; empresas: string[] }): Promise<DpAcessoResult> {
  try {
    const quem = await requireDpGestor();
    const admin = createAdminClient();

    const { data: alvo, error: eAlvo } = await admin.from("users").select("id, email, active").eq("id", input.userId).maybeSingle();
    if (eAlvo) throw eAlvo;
    if (!alvo) throw new Error("Usuário não encontrado.");

    const pedidas = Array.from(new Set(input.empresas ?? []));
    const { data: comps, error: eComp } = pedidas.length
      ? await admin.from("companies").select("id").eq("active", true).in("id", pedidas)
      : { data: [], error: null };
    if (eComp) throw eComp;

    const regra = validarConcessao(
      { id: alvo.id as string, email: alvo.email as string | null, active: alvo.active !== false },
      input.papel,
      pedidas,
      new Set((comps ?? []).map((c) => c.id as string)),
      await estadoAtual(admin, quem, input.userId),
    );
    if ("erro" in regra) throw new Error(regra.erro);
    const { acao, papel, empresas } = regra.ok;

    // 1. Empresas (gestor fica sem lista: vê todas).
    const diff = diffEmpresas(await empresasAtuais(admin, input.userId), empresas);
    if (diff.inserir.length > 0) {
      const { error } = await admin
        .from("dp_user_empresas")
        .insert(diff.inserir.map((company_id) => ({ user_id: input.userId, company_id, created_by: quem.id })));
      if (error) throw error;
    }
    if (diff.apagar.length > 0) {
      const { error } = await admin.from("dp_user_empresas").delete().eq("user_id", input.userId).in("company_id", diff.apagar);
      if (error) throw error;
    }

    // 2. Papel: o novo entra, depois os outros saem.
    const { error: eUp } = await admin
      .from("user_module_roles")
      .upsert({ user_id: input.userId, module: DP_MODULE, role: papel, granted_by: quem.id }, { onConflict: "user_id,module,role" });
    if (eUp) throw eUp;
    const { error: eDel } = await admin
      .from("user_module_roles")
      .delete()
      .eq("user_id", input.userId)
      .eq("module", DP_MODULE)
      .neq("role", papel);
    if (eDel) throw eDel;

    await registrar(admin, { alvo: input.userId, acao, papel, empresas, por: quem.id });
    revalidatePath(DP_PATH, "layout");
    return { ok: true };
  } catch (error) {
    return falha(error);
  }
}

/** Tira o DP do usuário: a concessão e a lista de empresas. */
export async function removerAcessoDp(input: { userId: string }): Promise<DpAcessoResult> {
  try {
    const quem = await requireDpGestor();
    const admin = createAdminClient();
    const regra = validarRemocao(input.userId, await estadoAtual(admin, quem, input.userId));
    if ("erro" in regra) throw new Error(regra.erro);

    // A concessão sai primeiro: sem ela a lista de empresas não vale nada.
    const { error } = await admin.from("user_module_roles").delete().eq("user_id", input.userId).eq("module", DP_MODULE);
    if (error) throw error;
    const { error: eEmp } = await admin.from("dp_user_empresas").delete().eq("user_id", input.userId);
    if (eEmp) throw eEmp;

    await registrar(admin, { alvo: input.userId, acao: "removeu", papel: null, empresas: [], por: quem.id });
    revalidatePath(DP_PATH, "layout");
    return { ok: true };
  } catch (error) {
    return falha(error);
  }
}
