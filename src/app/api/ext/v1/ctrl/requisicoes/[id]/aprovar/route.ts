import { NextResponse } from "next/server";

import { approveRequest } from "@/lib/ctrl/actions/requests";
import { extError, withExtCtrl } from "@/lib/ext-api/handler";
import { getApprovableRequest } from "@/lib/ext-api/requisicoes-db";

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

// Aprovação pelo hubfeat. O recorte da fila (empresa da chave + etapa + setor)
// é conferido antes: approveRequest confia no papel e não olha a empresa.
export async function POST(request: Request, { params }: { params: { id: string } }) {
  return withExtCtrl(request, async ({ ctx }) => {
    const body = (await request.json().catch(() => null)) as { comentario?: unknown } | null;
    const comentario = typeof body?.comentario === "string" ? body.comentario.trim() : "";
    if (!(await getApprovableRequest(ctx, params.id))) {
      return extError(404, "Requisição não encontrada na sua fila de aprovação.");
    }
    const result = await approveRequest(params.id, comentario || undefined);
    if ("error" in result && result.error) return extError(400, result.error);
    return NextResponse.json({ ok: true });
  });
}
