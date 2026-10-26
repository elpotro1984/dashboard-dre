import { NextResponse } from "next/server";

import { getCurrentSessionContext } from "@/lib/auth/session";
import { createAdminClient } from "@/lib/supabase/admin";
import type { AcessosForm } from "@/lib/usuarios/acessos";
import { gravarAcessos, planoValidado } from "@/lib/usuarios/gravar-acessos";

// Edição pela tela de Usuários MÓDULO → PERFIL (docs/superpowers/specs/
// 2026-10-26-usuarios-modulo-perfil.md). A tela antiga segue usando
// PATCH /api/users/[userId], intocada.

interface Params {
  params: { userId: string };
}

export async function PUT(request: Request, { params }: Params) {
  const { user, profile } = await getCurrentSessionContext();
  if (!user || !profile) return NextResponse.json({ error: "Nao autenticado." }, { status: 401 });
  if (profile.profile !== "admin") {
    return NextResponse.json({ error: "Acesso restrito ao admin." }, { status: 403 });
  }

  const body = (await request.json().catch(() => null)) as {
    name?: string;
    phone?: string | null;
    position?: string | null;
    acessos?: AcessosForm;
  } | null;
  if (!body?.acessos) return NextResponse.json({ error: "Informe os acessos." }, { status: 400 });

  // Trava contra se trancar fora: quem salva não tira o próprio Admin — o gesto
  // é de outro admin, senão um clique errado deixa a plataforma sem saída.
  if (params.userId === profile.id && !body.acessos.admin) {
    return NextResponse.json(
      { error: "Você não pode tirar o seu próprio Admin — peça a outro administrador." },
      { status: 400 },
    );
  }

  const admin = createAdminClient();
  const { data: alvo, error: alvoErr } = await admin
    .from("users")
    .select("id, email")
    .eq("id", params.userId)
    .maybeSingle();
  if (alvoErr) return NextResponse.json({ error: alvoErr.message }, { status: 400 });
  if (!alvo) return NextResponse.json({ error: "Usuário não encontrado." }, { status: 404 });

  const res = await planoValidado(admin, body.acessos, (alvo.email as string) ?? "");
  if ("error" in res) return NextResponse.json({ error: res.error }, { status: 400 });

  const cadastro: Record<string, unknown> = {};
  if (typeof body.name === "string") {
    if (!body.name.trim()) return NextResponse.json({ error: "Informe o nome." }, { status: 400 });
    cadastro.name = body.name.trim();
  }
  if (body.phone !== undefined) cadastro.phone = body.phone?.trim() || null;
  if (body.position !== undefined) cadastro.position = body.position?.trim() || null;
  if (Object.keys(cadastro).length > 0) {
    const { error } = await admin.from("users").update(cadastro).eq("id", params.userId);
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  }

  const { error } = await gravarAcessos(admin, params.userId, res.plano, profile.id);
  if (error) return NextResponse.json({ error }, { status: 400 });
  return NextResponse.json({ ok: true });
}
