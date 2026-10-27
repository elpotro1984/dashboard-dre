import { NextResponse } from "next/server";
import { cookies } from "next/headers";

import {
  ACTIVE_CTRL_ORG_COOKIE,
  ACTIVE_DP_EMPRESA_COOKIE,
  ACTIVE_MODULE_COOKIE,
  ACTIVE_SEGMENT_COOKIE,
  CONTEXT_COOKIE_OPTIONS,
  CTRL_ORG_CONFIRMED_COOKIE,
  CTRL_ORG_CONFIRMED_COOKIE_OPTIONS,
  DP_EMPRESA_CONFIRMED_COOKIE,
  VALID_MODULES,
} from "@/lib/context/active-context";
import { getCurrentSessionContext } from "@/lib/auth/session";
import { currentCtrlConfirmationKey } from "@/lib/ctrl/orgs";

interface ContextUpdateBody {
  module?: "dre" | "ctrl" | "case" | "viagens";
  segmentSlug?: string;
  /** Empresa ativa do Compras (slug de ctrl_orgs). Validado na leitura. */
  ctrlOrgSlug?: string;
  /** Empresa ativa do Departamento Pessoal (id). Validada na leitura. */
  dpEmpresaId?: string;
}

export async function POST(request: Request) {
  // Check authentication
  const { user, supabase } = await getCurrentSessionContext();
  if (!user) {
    return NextResponse.json({ error: "Nao autorizado" }, { status: 401 });
  }

  let body: ContextUpdateBody;
  try {
    body = (await request.json()) as ContextUpdateBody;
  } catch {
    return NextResponse.json({ error: "Corpo invalido" }, { status: 400 });
  }

  const store = await cookies();

  if (body.module !== undefined) {
    if (!(VALID_MODULES as readonly string[]).includes(body.module)) {
      return NextResponse.json({ error: "Modulo invalido" }, { status: 400 });
    }
    store.set(ACTIVE_MODULE_COOKIE, body.module, CONTEXT_COOKIE_OPTIONS);
  }

  if (body.segmentSlug !== undefined) {
    if (typeof body.segmentSlug !== "string" || body.segmentSlug.length === 0 || body.segmentSlug.length > 64) {
      return NextResponse.json({ error: "Slug de segmento invalido" }, { status: 400 });
    }
    store.set(ACTIVE_SEGMENT_COOKIE, body.segmentSlug, CONTEXT_COOKIE_OPTIONS);
  }

  if (body.ctrlOrgSlug !== undefined) {
    if (
      typeof body.ctrlOrgSlug !== "string" ||
      body.ctrlOrgSlug.length === 0 ||
      body.ctrlOrgSlug.length > 64
    ) {
      return NextResponse.json({ error: "Empresa invalida" }, { status: 400 });
    }
    // O slug é validado na leitura (getCtrlOrgContext cai na 1ª empresa se o
    // usuário não tiver acesso ao slug), então aqui basta o formato.
    store.set(ACTIVE_CTRL_ORG_COOKIE, body.ctrlOrgSlug, CONTEXT_COOKIE_OPTIONS);
    // Escolher a empresa É a confirmação deste login (seleção obrigatória do
    // Compras). Grava a MESMA chave que getCtrlOrgContext compara. Slug sem
    // acesso não passa: a leitura o trata como cookie inválido e pergunta de novo.
    store.set(
      CTRL_ORG_CONFIRMED_COOKIE,
      await currentCtrlConfirmationKey(supabase, user.id),
      CTRL_ORG_CONFIRMED_COOKIE_OPTIONS,
    );
  }

  if (body.dpEmpresaId !== undefined) {
    const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (typeof body.dpEmpresaId !== "string" || !uuid.test(body.dpEmpresaId)) {
      return NextResponse.json({ error: "Empresa invalida" }, { status: 400 });
    }
    // Aqui basta o formato: getDpEmpresaAtiva ignora empresa que a pessoa não
    // pode ver (o cookie vem do navegador e nunca é obedecido sem conferência).
    store.set(ACTIVE_DP_EMPRESA_COOKIE, body.dpEmpresaId, CONTEXT_COOKIE_OPTIONS);
    // Escolher a empresa É a confirmação deste login (seleção obrigatória do DP,
    // mesma regra do Compras). Empresa fora do escopo não passa: a leitura a
    // trata como cookie inválido e pergunta de novo.
    store.set(
      DP_EMPRESA_CONFIRMED_COOKIE,
      await currentCtrlConfirmationKey(supabase, user.id),
      CTRL_ORG_CONFIRMED_COOKIE_OPTIONS,
    );
  }

  return NextResponse.json({ ok: true });
}
