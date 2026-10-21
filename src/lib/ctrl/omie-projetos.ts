import { createAdminClientIfAvailable } from "@/lib/supabase/admin";
import { getOrgCompanyIds } from "@/lib/ctrl/orgs";
import { decryptSecret } from "@/lib/security/encryption";
import { listProjetosAtivos } from "@/lib/omie/contapagar";

// Nomes dos projetos já cadastrados no Omie dos CNPJs da empresa do Compras
// (org) ativa — alimentam o seletor "Projeto" da requisição. É SÓ sugestão: a
// requisição guarda o nome, e o código Omie é resolvido/criado no envio
// (ensureProjetoByNome, no CNPJ pagador). Para franquia (1 CNPJ) a lista é
// exata; para a Viva (5 CNPJs) é a união por nome.
//
// Lê com o ADMIN client (service role): a página já passou pelo gate do Compras,
// e ler `companies.omie_app_*` sob a RLS do usuário falharia para quem não tem
// vínculo em user_company_access com o CNPJ (mesmo enquadramento do lançamento).
// Best-effort: qualquer falha (sem credencial, Omie fora) → lista vazia, e o
// formulário fica só com "Sem Projeto" + criar.
export async function listProjetosDaOrg(orgId: string | null): Promise<string[]> {
  if (!orgId) return [];
  const admin = createAdminClientIfAvailable();
  if (!admin) return [];
  try {
    const companyIds = await getOrgCompanyIds(admin, orgId);
    if (companyIds.length === 0) return [];
    const { data: comps } = await admin
      .from("companies")
      .select("omie_app_key, omie_app_secret")
      .in("id", companyIds);
    const nomes = new Set<string>();
    for (const c of (comps ?? []) as Array<{
      omie_app_key: string | null;
      omie_app_secret: string | null;
    }>) {
      if (!c.omie_app_key || !c.omie_app_secret) continue;
      try {
        const appKey = decryptSecret(c.omie_app_key);
        const appSecret = decryptSecret(c.omie_app_secret);
        for (const nome of await listProjetosAtivos(appKey, appSecret)) nomes.add(nome);
      } catch (e) {
        console.error("[ctrl] listProjetosDaOrg: falha num CNPJ da org:", e);
      }
    }
    return Array.from(nomes).sort((a, b) => a.localeCompare(b, "pt-BR"));
  } catch (e) {
    console.error("[ctrl] listProjetosDaOrg:", e);
    return [];
  }
}
