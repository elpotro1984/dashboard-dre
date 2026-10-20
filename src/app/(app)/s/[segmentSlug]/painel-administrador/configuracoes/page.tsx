import { redirect } from "next/navigation";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";

import { SegmentSelector } from "@/components/app/segment-selector";
import { SettingsCompanies } from "@/components/app/settings-companies";
import { getCurrentSessionContext } from "@/lib/auth/session";
import type { Segment } from "@/lib/supabase/types";

export const dynamic = "force-dynamic";

interface PageProps {
  params: Promise<{ segmentSlug: string }>;
}

// Painel Administrador → Configurações. Gestão de empresas, credenciais Omie,
// teste de conexão, sincronização com período e orçamento (por segmento).
export default async function PainelConfiguracoesPage({ params }: PageProps) {
  const { supabase, user, profile } = await getCurrentSessionContext();
  if (!user) {
    redirect("/login");
  }
  if (!profile || profile.role !== "admin") {
    redirect("/dashboard");
  }

  const { segmentSlug } = await params;

  const { data: allSegments } = await supabase
    .from("segments")
    .select("id,name,slug,display_order,active")
    .eq("active", true)
    .order("display_order");
  const segments = (allSegments as Segment[] | null) ?? [];
  const currentSegment = segments.find((s) => s.slug === segmentSlug) ?? null;
  const segmentId = currentSegment?.id ?? null;

  let companiesQuery = supabase
    .from("companies")
    .select("id,name,active,created_at,omie_app_key,omie_app_secret,regime_tributario");
  if (segmentId) {
    companiesQuery = companiesQuery.eq("segment_id", segmentId);
  }
  const { data: companiesData } = await companiesQuery.order("name");

  const companies = (companiesData ?? []).map((company) => ({
    id: company.id as string,
    name: company.name as string,
    active: company.active as boolean,
    created_at: company.created_at as string,
    has_credentials: Boolean(company.omie_app_key && company.omie_app_secret),
    regime_tributario: (company.regime_tributario as string | null) ?? null,
  }));

  // Estado no módulo Compras: cada CNPJ pode pertencer a uma "empresa do Compras"
  // (ctrl_orgs). A linha da empresa mostra se já está habilitada e se faz parte de
  // um GRUPO (org com mais de um CNPJ, ex.: Viva Company) — aí a gestão é na tela
  // "Empresas do Compras" (Plataforma), não aqui. Leitura com o client do usuário:
  // a página é admin-only e a RLS de ctrl_orgs libera tudo para is_admin().
  const [orgLinksRes, ctrlOrgsRes] = await Promise.all([
    supabase.from("ctrl_org_companies").select("company_id, org_id"),
    supabase.from("ctrl_orgs").select("id, nome"),
  ]);
  const orgNameById = new Map(
    ((ctrlOrgsRes.data ?? []) as Array<{ id: string; nome: string }>).map((o) => [o.id, o.nome]),
  );
  const links = (orgLinksRes.data ?? []) as Array<{ company_id: string; org_id: string }>;
  const cnpjCountByOrg = new Map<string, number>();
  for (const l of links) cnpjCountByOrg.set(l.org_id, (cnpjCountByOrg.get(l.org_id) ?? 0) + 1);
  const comprasByCompany: Record<string, { orgNome: string; grouped: boolean }> = {};
  for (const l of links) {
    comprasByCompany[l.company_id] = {
      orgNome: orgNameById.get(l.org_id) ?? "—",
      grouped: (cnpjCountByOrg.get(l.org_id) ?? 0) > 1,
    };
  }

  return (
    <div className="space-y-6">
      <Link
        href={`/s/${segmentSlug}/painel-administrador`}
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" /> Painel Administrador
      </Link>

      <div className="space-y-1">
        <h1 className="text-2xl font-semibold">Configurações</h1>
        <p className="text-sm text-muted-foreground">
          Gestão de empresas, integração Omie e orçamento — por segmento.
        </p>
      </div>

      {segments.length > 0 ? (
        <div className="flex flex-wrap items-center gap-3">
          <span className="text-sm font-medium text-ink-secondary">Segmento:</span>
          <SegmentSelector segments={segments} activeSlug={segmentSlug} />
        </div>
      ) : null}

      <SettingsCompanies
        initialCompanies={companies}
        segmentId={segmentId}
        currentSegmentSlug={segmentSlug}
        comprasByCompany={comprasByCompany}
      />
    </div>
  );
}
