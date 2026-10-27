import { redirect } from "next/navigation";

import { AppShell } from "@/components/app/app-shell";
import { DpEmpresaGate } from "@/components/dp/dp-empresa-ativa";
import { canAccessBiValidation } from "@/lib/auth/bi-validation";
import { getSessionContext } from "@/lib/auth/session";
import { resolveLayoutContext } from "@/lib/context/modules";
import { resolveUserSegments } from "@/lib/context/user-segments";
import { hasCtrlFullView } from "@/lib/ctrl/full-view";
import { getUnreadNotificationsCount } from "@/lib/ctrl/notifications";
import { getDpUser } from "@/lib/dp/auth";
import { dpEscolhaDeEmpresa, getDpEmpresaAtiva } from "@/lib/dp/empresa-ativa";
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

  // Empresa ativa (a faixa do topo): só as empresas que esta pessoa pode ver.
  // Falha na leitura (tabela ainda não instalada) some com a faixa, não com o módulo.
  const dpUser = await getDpUser();
  const dpEmpresas = dpUser ? await getDpEmpresaAtiva(createAdminClient(), dpUser).catch(() => null) : null;

  // Escolha OBRIGATÓRIA da empresa a cada login, para quem vê mais de uma — o
  // esquema do Compras. A página NÃO é renderizada antes da escolha. Erro ao
  // ler a sessão não prende ninguém fora do módulo: segue sem a pergunta.
  const escolha = dpEmpresas
    ? await dpEscolhaDeEmpresa(supabase, ctx.user.id, dpEmpresas.empresas).catch(() => ({ pendente: false, ultimaId: null }))
    : { pendente: false, ultimaId: null };
  const content = escolha.pendente && dpEmpresas ? <DpEmpresaGate empresas={dpEmpresas.empresas} lastId={escolha.ultimaId} /> : children;

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
      dpEmpresaSelectionPending={escolha.pendente}
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
      {content}
    </AppShell>
  );
}
