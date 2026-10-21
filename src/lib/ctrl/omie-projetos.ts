import type { SupabaseClient } from "@supabase/supabase-js";

import { createAdminClientIfAvailable } from "@/lib/supabase/admin";
import { getOrgCompanyIds } from "@/lib/ctrl/orgs";
import { decryptSecret } from "@/lib/security/encryption";
import { listProjetosOmie } from "@/lib/omie/contapagar";

// Projetos do Omie para o campo "Projeto" da requisição — CACHEADOS em
// ctrl_omie_options (kind 'projeto'), por CNPJ. Atualização DIÁRIA preguiçosa
// (sem cron): a 1ª leitura após 24h repuxa da Omie e regrava o cache — mesmo
// padrão do câmbio do dólar (getUsdConversion). O botão "Atualizar agora" força
// a repuxada na hora (ver actions/projetos.ts).
//
// Tudo com o ADMIN client (service role): quem usa o formulário pode não ter
// vínculo em user_company_access com o CNPJ, e ler companies.omie_app_* / gravar
// o cache sob a RLS do usuário falharia. O gate de acesso fica em quem chama
// (a página e a action já passam pelo gate do Compras).

const PROJETO_KIND = "projeto";
const TTL_MS = 24 * 60 * 60 * 1000; // 24h = "atualizado diariamente" (lazy).

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Admin = SupabaseClient<any>;

// Repuxa os projetos da Omie de cada CNPJ e regrava o cache (delete + insert por
// company). Best-effort por CNPJ: um que falhe (sem credencial, Omie fora, ou a
// migration do CHECK ainda não aplicada) não derruba os demais.
async function refreshCache(admin: Admin, companyIds: string[]): Promise<void> {
  const { data: comps } = await admin
    .from("companies")
    .select("id, omie_app_key, omie_app_secret")
    .in("id", companyIds);
  const now = new Date().toISOString();
  for (const c of (comps ?? []) as Array<{
    id: string;
    omie_app_key: string | null;
    omie_app_secret: string | null;
  }>) {
    if (!c.omie_app_key || !c.omie_app_secret) continue;
    try {
      const projetos = await listProjetosOmie(
        decryptSecret(c.omie_app_key),
        decryptSecret(c.omie_app_secret),
      );
      await admin
        .from("ctrl_omie_options")
        .delete()
        .eq("company_id", c.id)
        .eq("kind", PROJETO_KIND);
      if (projetos.length > 0) {
        const { error } = await admin.from("ctrl_omie_options").insert(
          projetos.map((p) => ({
            company_id: c.id,
            kind: PROJETO_KIND,
            codigo: p.codigo,
            descricao: p.nome,
            synced_at: now,
          })),
        );
        if (error) throw error;
      }
    } catch (e) {
      console.error("[ctrl] refresh do cache de projetos falhou p/ um CNPJ:", e);
    }
  }
}

// Lê o cache e devolve os NOMES (dedupe + ordem pt-BR) + o synced_at mais recente.
async function readCache(
  admin: Admin,
  companyIds: string[],
): Promise<{ nomes: string[]; latest: number | null }> {
  const { data } = await admin
    .from("ctrl_omie_options")
    .select("descricao, synced_at")
    .in("company_id", companyIds)
    .eq("kind", PROJETO_KIND);
  const rows = (data ?? []) as Array<{ descricao: string | null; synced_at: string }>;
  const nomes = new Set<string>();
  let latest: number | null = null;
  for (const r of rows) {
    const n = (r.descricao ?? "").trim();
    if (n) nomes.add(n);
    const t = new Date(r.synced_at).getTime();
    if (latest === null || t > latest) latest = t;
  }
  return { nomes: Array.from(nomes).sort((a, b) => a.localeCompare(b, "pt-BR")), latest };
}

/**
 * Lista de projetos para o formulário — LÊ do cache; se estiver vazio ou com mais
 * de 24h, repuxa da Omie uma vez e regrava (atualização diária preguiçosa).
 * Best-effort: qualquer falha → lista vazia (o form fica só com "Sem Projeto" +
 * "+ novo"). Chamada no servidor (página da nova requisição e edição).
 */
export async function listProjetosDaOrg(orgId: string | null): Promise<string[]> {
  if (!orgId) return [];
  const admin = createAdminClientIfAvailable();
  if (!admin) return [];
  try {
    const companyIds = await getOrgCompanyIds(admin, orgId);
    if (companyIds.length === 0) return [];
    const cached = await readCache(admin, companyIds);
    if (cached.latest !== null && Date.now() - cached.latest <= TTL_MS) {
      return cached.nomes;
    }
    await refreshCache(admin, companyIds);
    return (await readCache(admin, companyIds)).nomes;
  } catch (e) {
    console.error("[ctrl] listProjetosDaOrg:", e);
    return [];
  }
}

/**
 * Força a repuxada da Omie agora (botão "Atualizar agora") e devolve a lista
 * fresca. Best-effort → lista vazia em falha.
 */
export async function refreshProjetosDaOrg(orgId: string | null): Promise<string[]> {
  if (!orgId) return [];
  const admin = createAdminClientIfAvailable();
  if (!admin) return [];
  try {
    const companyIds = await getOrgCompanyIds(admin, orgId);
    if (companyIds.length === 0) return [];
    await refreshCache(admin, companyIds);
    const { nomes } = await readCache(admin, companyIds);
    return nomes;
  } catch (e) {
    console.error("[ctrl] refreshProjetosDaOrg:", e);
    return [];
  }
}
