import { NextResponse } from "next/server";

import { acrescimosReservados, AVISO_EMPRESA_RESERVADA, podeConcederReservado } from "@/lib/auth/concessao-reservada";
import { getCurrentSessionContext } from "@/lib/auth/session";
import { createAdminClient } from "@/lib/supabase/admin";

// GET: list company access for a user (admin only)
export async function GET(request: Request) {
  const { user, profile } = await getCurrentSessionContext();
  if (!user || !profile) {
    return NextResponse.json({ error: "Nao autenticado." }, { status: 401 });
  }
  if (profile.role !== "admin") {
    return NextResponse.json({ error: "Acesso restrito ao admin." }, { status: 403 });
  }

  const userId = new URL(request.url).searchParams.get("userId");
  if (!userId) {
    return NextResponse.json({ error: "userId obrigatorio." }, { status: 400 });
  }

  const adminClient = createAdminClient();
  const { data, error } = await adminClient
    .from("user_company_access")
    .select("company_id")
    .eq("user_id", userId);

  if (error) return NextResponse.json({ error: error.message }, { status: 400 });

  const companyIds = (data ?? []).map((row) => row.company_id);
  return NextResponse.json({ companyIds });
}

// POST: set company access for a user (admin only) — replaces all existing
export async function POST(request: Request) {
  const { user, profile } = await getCurrentSessionContext();
  if (!user || !profile) {
    return NextResponse.json({ error: "Nao autenticado." }, { status: 401 });
  }
  if (profile.role !== "admin") {
    return NextResponse.json({ error: "Acesso restrito ao admin." }, { status: 403 });
  }

  const body = (await request.json()) as { userId: string; companyIds: string[] };
  if (!body.userId || !Array.isArray(body.companyIds)) {
    return NextResponse.json({ error: "userId e companyIds[] obrigatorios." }, { status: 400 });
  }

  const adminClient = createAdminClient();

  // Nenhuma tela chama esta rota, mas ela grava user_company_access: a mesma
  // trava da tela de Usuários vale aqui — só o Lucas acrescenta Dataforte,
  // VE Franqueadora e SPDX (@/lib/auth/concessao-reservada).
  if (!podeConcederReservado(profile.id)) {
    const { data: atual, error: atualError } = await adminClient
      .from("user_company_access")
      .select("company_id")
      .eq("user_id", body.userId);
    if (atualError) return NextResponse.json({ error: atualError.message }, { status: 400 });
    const acrescidas = acrescimosReservados(
      { financeiro: body.companyIds, orcamento: [], setoresOrcamento: {} },
      { financeiro: (atual ?? []).map((r) => r.company_id as string), orcamento: [], setoresOrcamento: {} },
    );
    if (acrescidas.length > 0) return NextResponse.json({ error: AVISO_EMPRESA_RESERVADA }, { status: 403 });
  }

  const { error: deleteError } = await adminClient
    .from("user_company_access")
    .delete()
    .eq("user_id", body.userId);

  if (deleteError) return NextResponse.json({ error: deleteError.message }, { status: 400 });

  if (body.companyIds.length > 0) {
    const rows = body.companyIds.map((companyId) => ({
      user_id: body.userId,
      company_id: companyId,
    }));
    const { error: insertError } = await adminClient
      .from("user_company_access")
      .insert(rows);

    if (insertError) return NextResponse.json({ error: insertError.message }, { status: 400 });
  }

  return NextResponse.json({ ok: true });
}
