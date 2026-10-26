import { NextResponse } from "next/server";

import { getCurrentSessionContext } from "@/lib/auth/session";
import { createAdminClient } from "@/lib/supabase/admin";

interface Params {
  params: {
    userId: string;
  };
}

/**
 * Ativa/desativa o usuário — o único uso desta rota pela tela de Usuários.
 * Perfil, módulos, empresas e setores são gravados SÓ por
 * PUT /api/users/[userId]/acessos, que valida perfil por módulo. O PATCH do
 * modelo velho (perfil único) saiu na varredura de 26/10/2026: ele gerava o
 * Financeiro "legado", mais amplo que Visão Financeira, e o users.role
 * 'gestor_hero', que abria todas as empresas no banco.
 */
export async function PATCH(request: Request, { params }: Params) {
  const { user, profile } = await getCurrentSessionContext();
  if (!user || !profile) {
    return NextResponse.json({ error: "Nao autenticado." }, { status: 401 });
  }
  if (profile.profile !== "admin") {
    return NextResponse.json({ error: "Acesso restrito ao admin." }, { status: 403 });
  }

  const body = (await request.json()) as Record<string, unknown>;
  if (Object.keys(body).some((k) => k !== "active") || typeof body.active !== "boolean") {
    return NextResponse.json(
      { error: "Acessos são alterados pela tela de Usuários (módulo → perfil)." },
      { status: 410 },
    );
  }
  if (body.active === false && params.userId === user.id) {
    return NextResponse.json({ error: "Você não pode desativar o próprio usuário." }, { status: 400 });
  }

  const { data, error } = await createAdminClient()
    .from("users")
    .update({ active: body.active })
    .eq("id", params.userId)
    .select("id");
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  if (!data || data.length === 0) {
    return NextResponse.json({ error: "Usuário não encontrado." }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}

export async function DELETE(_: Request, { params }: Params) {
  const { supabase, user, profile } = await getCurrentSessionContext();
  if (!user || !profile) {
    return NextResponse.json({ error: "Nao autenticado." }, { status: 401 });
  }
  if (profile.profile !== "admin") {
    return NextResponse.json({ error: "Acesso restrito ao admin." }, { status: 403 });
  }

  const { error } = await supabase
    .from("users")
    .update({ active: false })
    .eq("id", params.userId);
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });

  try {
    const adminClient = createAdminClient();
    await adminClient.auth.admin.updateUserById(params.userId, { ban_duration: "876000h" });
  } catch {
    // Soft delete at application-level is the primary safeguard.
  }

  return NextResponse.json({ ok: true });
}
