import { NextResponse } from "next/server";

import { withExtCtrl } from "@/lib/ext-api/handler";
import { listApprovable } from "@/lib/ext-api/requisicoes-db";

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

// Fila de aprovação de quem age (gerente: setores dele; diretor/csc/admin: todos).
export async function GET(request: Request) {
  return withExtCtrl(request, async ({ ctx }) => NextResponse.json({ aprovacoes: await listApprovable(ctx) }));
}
