import { NextResponse } from "next/server";

import { rejectRequest } from "@/lib/ctrl/actions/requests";
import { extError, withExtCtrl } from "@/lib/ext-api/handler";
import { getApprovableRequest } from "@/lib/ext-api/requisicoes-db";

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

// Reprovação pelo hubfeat, com motivo obrigatório (vai para o solicitante).
export async function POST(request: Request, { params }: { params: { id: string } }) {
  return withExtCtrl(request, async ({ ctx }) => {
    const body = (await request.json().catch(() => null)) as { motivo?: unknown } | null;
    const motivo = typeof body?.motivo === "string" ? body.motivo.trim() : "";
    if (!motivo) return extError(400, "Informe o motivo da reprovação em `motivo`.");
    if (!(await getApprovableRequest(ctx, params.id))) {
      return extError(404, "Requisição não encontrada na sua fila de aprovação.");
    }
    const result = await rejectRequest(params.id, motivo);
    if ("error" in result && result.error) return extError(400, result.error);
    return NextResponse.json({ ok: true });
  });
}
