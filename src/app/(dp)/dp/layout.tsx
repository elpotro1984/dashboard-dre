import { redirect } from "next/navigation";

import { AppShell } from "@/components/app/app-shell";
import { canAccessBiValidation } from "@/lib/auth/bi-validation";
import { getSessionContext } from "@/lib/auth/session";
import { resolveLayoutContext } from "@/lib/context/modules";
import { resolveUserSegments } from "@/lib/context/user-segments";
import { hasCtrlFullView } from "@/lib/ctrl/full-view";
import { getUnreadNotificationsCount } from "@/lib/ctrl/notifications";
import { getDpUser } from "@/lib/dp/auth";
import { getDpEmpresaAtiva } from "@/lib/dp/empresa-ativa";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Layout do módulo Departamento Pessoal (sigiloso). Espelha o do (vb): monta o
 * AppShell e barra quem não tem a concessão do módulo — inclusive admin (ver
 * @/lib/auth/dp). O middleware já barra a rota; este redirect é a segunda
 * linha, para o caso de a rota escapar do matcher.
 */
export default async function DpLayout({ children }: { children: React.ReactNode }) {
  const ctx = await getSessionContext();

  if (!ctx.user) redirect("/login");
  if (!ctx.modules?.dp) redirect("/");

  const { profile, supabase, modules } = ctx;
  const userName = profile?.name || ctx.user.email || "Usuario";
  const userEmail = profile?.email || ctx.user.email || "";
  const dreRole = modules.dre?.role ?? profile?.role ?? "gestor_unidade";
  const navDreRole = modules.dre?.role ?? null;
  const ctrlRoles = modules.ctrl?.roles ?? [];
  const canCase = Boolean(modules.case);
  const canViagens = Boolean(modules.viagens);
  const canViagensAprovar = Boolean(modules.viagens?.aprovador);
  const canContratos = Boolean(modules.contratos);
  const vbRole = modules.vb?.role ?? null;
  const canCaixa = Boolean(modules.caixa);
  const orcamentoPapel = modules.orcamento?.papel ?? null;
  const dpRole = modules.dp?.role ?? null;

  const segments = await resolveUserSegments(supabase, {
    isAdmin: dreRole === "admin",
    userId: profile?.id ?? null,
    companyIds: profile?.company_ids ?? [],
  });

  const { availableModules, activeModule, activeSegmentSlug } = await resolveLayoutContext(
    dreRole,
    ctrlRoles,
    segments,
    "dp",
    canCase,
    canViagens,
    vbRole !== null,
    canCaixa,
    dpRole !== null,
  );

  const unreadNotifications = profile?.id
    ? await getUnreadNotificationsCount(profile.id)
    : 0;

  // Seletor de empresa do topo: só as empresas que esta pessoa pode ver. Falha
  // na leitura (tabela ainda não instalada) some com o seletor, não com o módulo.
  const dpUser = await getDpUser();
  const dpEmpresas = dpUser ? await getDpEmpresaAtiva(createAdminClient(), dpUser).catch(() => null) : null;

  return (
    <AppShell
      userName={userName}
      userEmail={userEmail}
      userRole={navDreRole}
      ctrlRoles={ctrlRoles}
      canCase={canCase}
      canViagens={canViagens}
      canViagensAprovar={canViagensAprovar}
      canContratos={canContratos}
      vbRole={vbRole}
      canCaixa={canCaixa}
      orcamentoPapel={orcamentoPapel}
      dpRole={dpRole}
      dpEmpresas={dpEmpresas?.empresas ?? []}
      activeDpEmpresaId={dpEmpresas?.ativa?.id ?? null}
      segments={segments}
      activeModule={activeModule}
      availableModules={availableModules}
      activeSegmentSlug={activeSegmentSlug}
      canBiValidation={canAccessBiValidation(profile)}
      ctrlFullView={ctrlRoles.length > 0 && hasCtrlFullView(userEmail)}
      unreadNotifications={unreadNotifications}
      userProfile={profile?.profile ?? null}
      tourSeen={profile?.tour_seen ?? false}
    >
      {children}
    </AppShell>
  );
}
