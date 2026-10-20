import { redirect } from "next/navigation";

import { CtrlOrgsManager } from "@/components/ctrl/ctrl-orgs-manager";
import { getSessionContext } from "@/lib/auth/session";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

// Empresas do Compras (ctrl_orgs). Admin-only (Plataforma). Uma "empresa do
// Compras" é uma org — um grupo de CNPJs (a Viva Company junta 5; a Feat tem 1).
// A tela lê com o admin client porque companies/ctrl_orgs têm RLS por vínculo e
// o admin precisa ver TODAS as empresas para montar as orgs (mesmo padrão do
// Caixa e das páginas /contratos).
export default async function EmpresasComprasPage() {
  const { user, profile } = await getSessionContext();
  if (!user) redirect("/login");
  if (profile?.profile !== "admin") redirect("/home");

  const admin = createAdminClient();

  const [orgsRes, linksRes, companiesRes] = await Promise.all([
    admin.from("ctrl_orgs").select("id, nome, slug, ativo").order("nome"),
    admin.from("ctrl_org_companies").select("org_id, company_id"),
    admin.from("companies").select("id, name").eq("active", true).order("name"),
  ]);

  const companies = (companiesRes.data ?? []) as Array<{ id: string; name: string }>;
  const companyName = new Map(companies.map((c) => [c.id, c.name]));
  const links = (linksRes.data ?? []) as Array<{ org_id: string; company_id: string }>;

  const companiesByOrg = new Map<string, Array<{ id: string; name: string }>>();
  const takenCompanyIds = new Set<string>();
  for (const l of links) {
    takenCompanyIds.add(l.company_id);
    const arr = companiesByOrg.get(l.org_id) ?? [];
    arr.push({ id: l.company_id, name: companyName.get(l.company_id) ?? l.company_id });
    companiesByOrg.set(l.org_id, arr);
  }

  const orgs = ((orgsRes.data ?? []) as Array<{
    id: string;
    nome: string;
    slug: string;
    ativo: boolean;
  }>).map((o) => ({
    ...o,
    companies: (companiesByOrg.get(o.id) ?? []).sort((a, b) =>
      a.name.localeCompare(b.name, "pt-BR"),
    ),
  }));

  // CNPJs disponíveis = empresas ativas ainda não vinculadas a NENHUMA org (a
  // trava unique(company_id) impede um CNPJ em duas orgs — a tela só oferece os
  // livres para não produzir um erro que ela já sabe prever).
  const available = companies
    .filter((c) => !takenCompanyIds.has(c.id))
    .map((c) => ({ id: c.id, name: c.name }));

  return <CtrlOrgsManager orgs={orgs} available={available} />;
}
