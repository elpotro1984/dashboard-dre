"use server";

// Cadastro das EMPRESAS DO COMPRAS (ctrl_orgs + ctrl_org_companies) — o painel
// admin "Empresas do Compras" em Plataforma. Até aqui criar org e anexar CNPJ só
// se fazia por migration (a Viva na 20261006130000, a Feat na 20261007140000);
// este módulo é o primeiro caminho de tela para isso.
//
// Escrita: admin-only, com o SERVICE ROLE depois do gate — é o que o comentário
// da migration de ctrl_orgs já previa ("o app grava com o service role depois do
// gate, como no resto do módulo"). A RLS de ctrl_orgs/ctrl_org_companies exige
// is_admin() como segunda linha de defesa.

import { revalidatePath } from "next/cache";

import { getCurrentSessionContext } from "@/lib/auth/session";
import { createAdminClient } from "@/lib/supabase/admin";

const PATH = "/admin/empresas-compras";

type ActionResult = { ok: true } | { error: string };

async function requireAdmin(): Promise<{ ok: true } | { error: string }> {
  const { user, profile } = await getCurrentSessionContext();
  if (!user || !profile) return { error: "Não autenticado." };
  if (profile.profile !== "admin") return { error: "Acesso restrito ao admin." };
  return { ok: true };
}

/** slug a partir do nome (sem acento, minúsculo, hifenizado). Vazio → "empresa". */
function slugify(nome: string): string {
  const s = nome
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  return s || "empresa";
}

export async function createCtrlOrg(input: {
  nome: string;
  companyIds?: string[];
}): Promise<{ ok: true; orgId: string; skipped: number } | { error: string }> {
  const gate = await requireAdmin();
  if ("error" in gate) return gate;

  const nome = input.nome.trim();
  if (!nome) return { error: "Informe o nome da empresa." };

  const admin = createAdminClient();

  // slug único: gera do nome e desempata com sufixo numérico contra os existentes.
  const base = slugify(nome);
  const { data: existing } = await admin.from("ctrl_orgs").select("slug");
  const taken = new Set((existing ?? []).map((r) => r.slug as string));
  let slug = base;
  for (let i = 2; taken.has(slug); i++) slug = `${base}-${i}`;

  const { data: org, error } = await admin
    .from("ctrl_orgs")
    .insert({ nome, slug })
    .select("id")
    .single();
  if (error || !org) return { error: error?.message ?? "Falha ao criar a empresa." };

  // Anexa os CNPJs escolhidos. unique(company_id): um CNPJ que já esteja em outra
  // org volta 23505 — não derruba a criação, só é contado em `skipped`.
  let skipped = 0;
  const companyIds = Array.from(new Set(input.companyIds ?? []));
  for (const companyId of companyIds) {
    const { error: linkErr } = await admin
      .from("ctrl_org_companies")
      .insert({ org_id: org.id, company_id: companyId });
    if (linkErr) skipped += 1;
  }

  revalidatePath(PATH);
  return { ok: true, orgId: org.id as string, skipped };
}

export async function renameCtrlOrg(orgId: string, nome: string): Promise<ActionResult> {
  const gate = await requireAdmin();
  if ("error" in gate) return gate;
  const nomeTrim = nome.trim();
  if (!nomeTrim) return { error: "Informe o nome da empresa." };
  const admin = createAdminClient();
  const { error } = await admin.from("ctrl_orgs").update({ nome: nomeTrim }).eq("id", orgId);
  if (error) return { error: error.message };
  revalidatePath(PATH);
  return { ok: true };
}

export async function setCtrlOrgAtivo(orgId: string, ativo: boolean): Promise<ActionResult> {
  const gate = await requireAdmin();
  if ("error" in gate) return gate;
  const admin = createAdminClient();
  const { error } = await admin.from("ctrl_orgs").update({ ativo }).eq("id", orgId);
  if (error) return { error: error.message };
  revalidatePath(PATH);
  return { ok: true };
}

export async function addCtrlOrgCompany(orgId: string, companyId: string): Promise<ActionResult> {
  const gate = await requireAdmin();
  if ("error" in gate) return gate;
  const admin = createAdminClient();
  const { error } = await admin
    .from("ctrl_org_companies")
    .insert({ org_id: orgId, company_id: companyId });
  if (error) {
    // unique(company_id): o CNPJ já paga por outra empresa do Compras.
    if (error.code === "23505") {
      return { error: "Essa empresa (CNPJ) já está vinculada a outra empresa do Compras." };
    }
    return { error: error.message };
  }
  revalidatePath(PATH);
  return { ok: true };
}

export async function removeCtrlOrgCompany(
  orgId: string,
  companyId: string,
): Promise<ActionResult> {
  const gate = await requireAdmin();
  if ("error" in gate) return gate;
  const admin = createAdminClient();
  const { error } = await admin
    .from("ctrl_org_companies")
    .delete()
    .eq("org_id", orgId)
    .eq("company_id", companyId);
  if (error) return { error: error.message };
  revalidatePath(PATH);
  return { ok: true };
}
