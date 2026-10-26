import { NextResponse } from "next/server";

import { resolveAppUrl } from "@/lib/app-url";
import { getCurrentSessionContext } from "@/lib/auth/session";
import { createAdminClient } from "@/lib/supabase/admin";
import type { AcessosForm } from "@/lib/usuarios/acessos";
import { gravarAcessos, planoValidado } from "@/lib/usuarios/gravar-acessos";

// Convite pela tela de Usuários MÓDULO → PERFIL. A tela antiga segue usando
// POST /api/users/invite, intocada.

export async function POST(request: Request) {
  const { user, profile } = await getCurrentSessionContext();
  if (!user || !profile) return NextResponse.json({ error: "Nao autenticado." }, { status: 401 });
  if (profile.profile !== "admin") {
    return NextResponse.json({ error: "Acesso restrito ao admin." }, { status: 403 });
  }

  const body = (await request.json().catch(() => null)) as {
    email?: string;
    name?: string;
    phone?: string;
    position?: string;
    acessos?: AcessosForm;
  } | null;
  const email = body?.email?.trim().toLowerCase();
  const name = body?.name?.trim();
  if (!email || !name || !body?.acessos) {
    return NextResponse.json({ error: "Informe e-mail, nome e os acessos." }, { status: 400 });
  }

  const admin = createAdminClient();
  // Valida ANTES de convidar: convite enviado com acesso recusado deixaria
  // alguém com login e sem nada.
  const res = await planoValidado(admin, body.acessos, email);
  if ("error" in res) return NextResponse.json({ error: res.error }, { status: 400 });

  const { data: convite, error: conviteErr } = await admin.auth.admin.inviteUserByEmail(email, {
    redirectTo: `${resolveAppUrl()}/auth/callback?next=/home`,
    data: { name },
  });
  if (conviteErr || !convite.user) {
    return NextResponse.json({ error: conviteErr?.message ?? "Falha ao enviar convite." }, { status: 400 });
  }
  const novoId = convite.user.id;

  // Linha mínima e SEM módulo nenhum: os acessos entram logo abaixo, pelo mesmo
  // executor da edição. Se ele falhar, a pessoa fica sem acesso, nunca com mais.
  const { error: upsertErr } = await admin.from("users").upsert(
    {
      id: novoId,
      email,
      name,
      phone: body.phone?.trim() || null,
      position: body.position?.trim() || null,
      profile: "solicitante",
      role: "gestor_unidade",
      can_financeiro: false,
      can_compras: false,
      can_case: false,
      can_viagens: false,
      can_viagens_aprovar: false,
      contracts_only: false,
      company_id: null,
      active: true,
    },
    { onConflict: "id" },
  );
  if (upsertErr) return NextResponse.json({ error: upsertErr.message }, { status: 400 });

  const { error } = await gravarAcessos(admin, novoId, res.plano, profile.id);
  if (error) return NextResponse.json({ error }, { status: 400 });
  return NextResponse.json({ ok: true });
}
