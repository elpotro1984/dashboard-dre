import { redirect } from "next/navigation";

import { NovaRequisicaoForm } from "@/components/ctrl/nova-requisicao-form";
import { getCtrlUser, hasCtrlRole } from "@/lib/ctrl/auth";
import { getExpenseTypes } from "@/lib/ctrl/actions/expense-types";
import { getRequestForClone } from "@/lib/ctrl/actions/requests";
import { buildClonePrefill, type ClonePrefill } from "@/lib/ctrl/clone-request";
import { getSectors } from "@/lib/ctrl/actions/sectors";
import { getSuppliers } from "@/lib/ctrl/actions/suppliers";
import { listProjetosDaOrg } from "@/lib/ctrl/omie-projetos";
import { getUsdConversion } from "@/lib/ai/usd";
import { createClient } from "@/lib/supabase/server";

async function getActiveEvents(orgId: string | null) {
  if (!orgId) return [];
  const supabase = await createClient();
  const { data } = await supabase
    .from("ctrl_events")
    .select("id, name, description, is_active, created_by, created_at, updated_at")
    .eq("is_active", true)
    .eq("org_id", orgId) // empresa ativa (multiempresa)
    .order("name");
  return data ?? [];
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function NovaRequisicaoPage({
  searchParams,
}: {
  // ?clonar=<id>: atalho "Clonar requisição" da tela de Requisições.
  searchParams?: { clonar?: string };
}) {
  const ctx = await getCtrlUser();
  if (!ctx) redirect("/login");

  // Contas a Pagar tambem cria requisicao (para qualquer setor) — ver getSectors.
  if (
    !hasCtrlRole(ctx, "solicitante", "gerente", "diretor", "csc", "contas_a_pagar", "admin")
  ) {
    redirect("/ctrl/requisicoes");
  }

  const [
    sectorsSettled,
    expenseTypesSettled,
    suppliersSettled,
    eventsSettled,
    projetosSettled,
    usdSettled,
  ] = await Promise.allSettled([
    getSectors(),
    getExpenseTypes(),
    // Fornecedor ainda não homologado (pendente) TAMBÉM aparece como opção: a
    // requisição pode ser criada e segue o fluxo normal de aprovação. A trava
    // do fornecedor foi movida para o Contas a Pagar (envio para pagamento).
    // Rejeitado continua fora da lista.
    getSuppliers(["aprovado", "pendente"]),
    getActiveEvents(ctx.orgId),
    // Projetos já cadastrados no Omie da empresa ativa (sugestão do campo
    // Projeto). Best-effort: falha → lista vazia (só "Sem Projeto" + criar).
    listProjetosDaOrg(ctx.orgId),
    getUsdConversion(),
  ]);

  const sectors =
    sectorsSettled.status === "fulfilled"
      ? sectorsSettled.value.sectors ?? []
      : [];
  const expenseTypes =
    expenseTypesSettled.status === "fulfilled"
      ? expenseTypesSettled.value.expenseTypes ?? []
      : [];
  const suppliers =
    suppliersSettled.status === "fulfilled"
      ? suppliersSettled.value.suppliers ?? []
      : [];
  const events = eventsSettled.status === "fulfilled" ? eventsSettled.value : [];
  const projetos = projetosSettled.status === "fulfilled" ? projetosSettled.value : [];
  // Câmbio + IOF para compras em dólar (fallback defensivo se a config falhar).
  const usd =
    usdSettled.status === "fulfilled" ? usdSettled.value : { rate: 5, iofRate: 3.5 };

  // Clonar: a original passa pelo recorte da tela de Requisições (só se clona o
  // que se vê na lista). O que é herdado é decidido em buildClonePrefill, contra
  // os cadastros que ESTE usuário tem disponíveis agora.
  const cloneId = searchParams?.clonar;
  let clone: ClonePrefill | null = null;
  let cloneNotFound = false;
  if (cloneId) {
    const source = UUID_RE.test(cloneId) ? await getRequestForClone(cloneId).catch(() => null) : null;
    if (!source) {
      cloneNotFound = true;
    } else {
      clone = buildClonePrefill(
        source.row,
        {
          supplierIds: new Set(suppliers.map((s) => s.id)),
          sectorIds: new Set(sectors.map((s) => s.id)),
          expenseTypeIds: new Set(expenseTypes.map((t) => t.id)),
          eventIds: new Set(events.map((e) => e.id as string)),
          hasEvents: events.length > 0,
        },
        source.installmentGroupTotal,
      );
    }
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">
          {clone ? `Clonar requisição #${clone.sourceNumber}` : "Nova Requisição"}
        </h1>
        <p className="text-muted-foreground">
          {clone
            ? "Os dados vieram da requisição original. Informe o vencimento e a competência, anexe os documentos do novo pagamento e confira antes de enviar."
            : "Preencha os dados para solicitar um pagamento"}
        </p>
      </div>

      {cloneNotFound && (
        <p className="rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:border-amber-900/40 dark:bg-amber-950/30 dark:text-amber-300">
          Não foi possível carregar a requisição para clonar (ela não existe ou você não tem acesso a ela).
          Preencha uma requisição nova abaixo.
        </p>
      )}

      <div className="rounded-lg border bg-card p-6">
        <NovaRequisicaoForm
          sectors={sectors}
          expenseTypes={expenseTypes}
          suppliers={suppliers}
          events={events}
          projetos={projetos}
          usdBrlRate={usd.rate}
          usdIofRate={usd.iofRate}
          clone={clone}
        />
      </div>
    </div>
  );
}
