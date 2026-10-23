import { NextResponse } from "next/server";

import { createRequest } from "@/lib/ctrl/actions/requests";
import { extError, withExtCtrl } from "@/lib/ext-api/handler";
import { withIdempotency } from "@/lib/ext-api/idempotency";
import { parseCreateRequest, parseFornecedorHub, type Etapa } from "@/lib/ext-api/requisicoes";
import {
  catalogOutsideOrg,
  getOwnRequest,
  listOwnRequests,
  resolveFornecedorHub,
} from "@/lib/ext-api/requisicoes-db";

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

// Requisições criadas por quem age, na empresa da chave. `?etapa=` filtra.
export async function GET(request: Request) {
  return withExtCtrl(request, async ({ ctx }) => {
    const etapa = new URL(request.url).searchParams.get("etapa") as Etapa | null;
    const all = await listOwnRequests(ctx);
    return NextResponse.json({ requisicoes: etapa ? all.filter((r) => r.etapa === etapa) : all });
  });
}

export async function POST(request: Request) {
  return withExtCtrl(request, async ({ client, ctx }) => {
    const body = await request.json().catch(() => null);

    // O hubfeat manda o fornecedor do cadastro dele (`fornecedor_hub`) em vez
    // de um id do Compras; aqui ele vira o `supplier_id` correspondente.
    let input = body;
    if (body && typeof body === "object" && !Array.isArray(body) && body.fornecedor_hub && !body.supplier_id) {
      const hub = parseFornecedorHub(body.fornecedor_hub);
      if (!hub.ok) return extError(400, hub.error);
      const resolved = await resolveFornecedorHub(ctx, hub.fornecedor);
      if (!resolved.ok) return extError(400, resolved.error);
      input = { ...body, supplier_id: resolved.supplierId };
    }

    const parsed = parseCreateRequest(input, ctx);
    if (!parsed.ok) return extError(400, parsed.error);
    const outside = await catalogOutsideOrg(ctx, {
      supplierId: parsed.input.supplier_id!,
      expenseTypeId: parsed.input.expense_type_id!,
    });
    if (outside) return extError(400, outside);

    return withIdempotency(request, client.id, ctx.id, body, async () => {
      const result = await createRequest(parsed.input);
      if ("error" in result && result.error) return extError(400, result.error);
      if (!("requestId" in result) || !result.requestId) {
        return extError(500, "A requisição não foi criada.");
      }
      const requisicao = await getOwnRequest(ctx, result.requestId);
      return NextResponse.json(
        {
          requisicao,
          // Parcelas e recorrência criam várias linhas; esta é a primeira.
          totalCriadas: result.totalCreated,
          verificacaoOrcamento: result.verification ?? null,
        },
        { status: 201 },
      );
    });
  });
}
