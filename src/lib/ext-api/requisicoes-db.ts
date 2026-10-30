import "server-only";

import type { CtrlUserContext } from "@/lib/ctrl/auth";
import {
  etapaDaRequisicao,
  ETAPA_LABEL,
  respostaPendente,
  supplierRowFromHub,
  type FornecedorHub,
} from "@/lib/ext-api/requisicoes";
import { createAdminClient } from "@/lib/supabase/admin";
import type { CtrlRequestStatus } from "@/lib/supabase/types";

// Leituras da API externa. Sempre pelo admin client COM o recorte explícito
// (empresa da chave + criada por quem age): a API serve só ao solicitante,
// então nenhuma leitura aqui alcança requisição de outra pessoa ou empresa.

const COLUMNS = `
  id, request_number, title, description, amount, due_date, status, created_at,
  payment_method, reference_month, reference_year, installment_number, installment_total,
  omie_launch_status, omie_paid_at, scheduled_for, sector_id, expense_type_id, supplier_id,
  ctrl_sectors(name), ctrl_expense_types(name), ctrl_suppliers(name)
`;

interface Row {
  id: string;
  request_number: number;
  title: string;
  description: string | null;
  amount: number;
  due_date: string | null;
  status: CtrlRequestStatus;
  created_at: string;
  payment_method: string | null;
  reference_month: number | null;
  reference_year: number | null;
  installment_number: number | null;
  installment_total: number | null;
  omie_launch_status: string | null;
  omie_paid_at: string | null;
  scheduled_for: string | null;
  sector_id: string;
  expense_type_id: string | null;
  supplier_id: string | null;
  ctrl_sectors: { name: string } | null;
  ctrl_expense_types: { name: string } | null;
  ctrl_suppliers: { name: string } | null;
}

function toView(r: Row) {
  const etapa = etapaDaRequisicao(r);
  return {
    id: r.id,
    numero: r.request_number,
    titulo: r.title,
    descricao: r.description,
    valor: Number(r.amount),
    vencimento: r.due_date,
    referencia: r.reference_month && r.reference_year ? { mes: r.reference_month, ano: r.reference_year } : null,
    formaPagamento: r.payment_method,
    parcela: r.installment_total ? { numero: r.installment_number, total: r.installment_total } : null,
    setor: r.ctrl_sectors ? { id: r.sector_id, nome: r.ctrl_sectors.name } : null,
    tipoDespesa: r.ctrl_expense_types ? { id: r.expense_type_id, nome: r.ctrl_expense_types.name } : null,
    fornecedor: r.ctrl_suppliers ? { id: r.supplier_id, nome: r.ctrl_suppliers.name } : null,
    etapa,
    etapaLabel: ETAPA_LABEL[etapa],
    respostaPendente: respostaPendente(r.status),
    status: r.status,
    pagoEm: r.omie_paid_at,
    criadaEm: r.created_at,
  };
}

export type RequisicaoView = ReturnType<typeof toView>;

export async function listOwnRequests(ctx: CtrlUserContext, limit = 200): Promise<RequisicaoView[]> {
  const { data, error } = await createAdminClient()
    .from("ctrl_requests")
    .select(COLUMNS)
    .eq("org_id", ctx.orgId!)
    .eq("created_by", ctx.id)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw new Error(error.message);
  return ((data ?? []) as unknown as Row[]).map(toView);
}

/** A requisição, se for da empresa da chave E criada por quem age; senão null. */
export async function getOwnRequest(ctx: CtrlUserContext, id: string): Promise<RequisicaoView | null> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const { data, error } = await createAdminClient()
    .from("ctrl_requests")
    .select(COLUMNS)
    .eq("id", id)
    .eq("org_id", ctx.orgId!)
    .eq("created_by", ctx.id)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data ? toView(data as unknown as Row) : null;
}

// ─── Aprovação pelo hubfeat ───────────────────────────────────────────────────
//
// Fila de quem aprova: requisições da empresa da chave na etapa que o papel de
// quem age decide — gerente: `pendente` dos setores vinculados a ele; diretor,
// csc e admin: `pendente` e `pendente_diretor` de qualquer setor. Rateio fica
// fora (a API não cria e o hubfeat não sabe aprovar por setor). A action de
// aprovação refaz as travas de alçada; este recorte só decide o que aparece.

const APPROVAL_COLUMNS = `${COLUMNS},
  justification, observations, created_by,
  creator:users!ctrl_requests_created_by_fkey(name, email)`;

interface ApprovalRow extends Row {
  justification: string | null;
  observations: string | null;
  created_by: string;
  creator: { name: string | null; email: string | null } | null;
}

function toApprovalView(r: ApprovalRow) {
  return {
    ...toView(r),
    solicitante: { id: r.created_by, nome: r.creator?.name ?? r.creator?.email ?? null },
    justificativa: r.justification,
    observacoes: r.observations,
  };
}

export type AprovacaoView = ReturnType<typeof toApprovalView>;

function approvalScope(ctx: CtrlUserContext): { statuses: CtrlRequestStatus[]; sectorIds: string[] | null } | null {
  const wide = ctx.ctrlRoles.some((r) => ["diretor", "csc", "admin"].includes(r));
  if (wide) return { statuses: ["pendente", "pendente_diretor"], sectorIds: null };
  // Gerente sem setor vinculado não tem fila pela API (falha fechada): o
  // fallback "vê tudo" da tela do Compras não vale aqui.
  if (ctx.ctrlRoles.includes("gerente") && ctx.sectorIds.length > 0) {
    return { statuses: ["pendente"], sectorIds: ctx.sectorIds };
  }
  return null;
}

export async function listApprovable(ctx: CtrlUserContext): Promise<AprovacaoView[]> {
  const scope = approvalScope(ctx);
  if (!scope) return [];
  let q = createAdminClient()
    .from("ctrl_requests")
    .select(APPROVAL_COLUMNS)
    .eq("org_id", ctx.orgId!)
    .in("status", scope.statuses)
    .is("deleted_at", null)
    .or("is_rateio.is.null,is_rateio.eq.false")
    .order("created_at", { ascending: true })
    .limit(200);
  if (scope.sectorIds) q = q.in("sector_id", scope.sectorIds);
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  return ((data ?? []) as unknown as ApprovalRow[]).map(toApprovalView);
}

/** A requisição, se está na fila de aprovação de quem age; senão null. */
export async function getApprovableRequest(ctx: CtrlUserContext, id: string): Promise<AprovacaoView | null> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const scope = approvalScope(ctx);
  if (!scope) return null;
  const { data, error } = await createAdminClient()
    .from("ctrl_requests")
    .select(APPROVAL_COLUMNS)
    .eq("id", id)
    .eq("org_id", ctx.orgId!)
    .is("deleted_at", null)
    .maybeSingle();
  if (error) throw new Error(error.message);
  const row = data as unknown as (ApprovalRow & { is_rateio?: boolean }) | null;
  if (!row || !scope.statuses.includes(row.status)) return null;
  if (scope.sectorIds && !scope.sectorIds.includes(row.sector_id)) return null;
  return toApprovalView(row);
}

/**
 * Id do fornecedor do Compras que corresponde ao `fornecedor_hub` do hubfeat,
 * na empresa da chave: por CNPJ/CPF, depois por código Omie; se não houver,
 * cadastra (ver supplierRowFromHub). Fornecedor já existente fica como está —
 * se o Compras o inativou, a trava do envio ao pagamento continua valendo.
 */
export async function resolveFornecedorHub(
  ctx: CtrlUserContext,
  f: FornecedorHub,
): Promise<{ ok: true; supplierId: string } | { ok: false; error: string }> {
  const admin = createAdminClient();
  const orgId = ctx.orgId!;

  // O documento pode estar gravado com ou sem máscara: "%0%4%0%7%..." casa os
  // dois e a comparação exata, normalizada, fica no JS.
  const findByDoc = async () => {
    const { data, error } = await admin
      .from("ctrl_suppliers")
      .select("id, cnpj_cpf")
      .eq("org_id", orgId)
      .neq("status", "rejeitado")
      .ilike("cnpj_cpf", `%${f.documento.split("").join("%")}%`);
    if (error) throw new Error(error.message);
    const docOf = (v: string | null) => (v ?? "").toUpperCase().replace(/[^0-9A-Z]/g, "");
    return (data ?? []).find((s) => docOf(s.cnpj_cpf as string | null) === f.documento)?.id as string | undefined;
  };

  const byDoc = await findByDoc();
  if (byDoc) return { ok: true, supplierId: byDoc };

  const { data: byOmie, error: omieErr } = await admin
    .from("ctrl_suppliers")
    .select("id, org_id")
    .eq("omie_id", f.omieCode)
    .maybeSingle();
  if (omieErr) throw new Error(omieErr.message);
  if (byOmie && byOmie.org_id === orgId) return { ok: true, supplierId: byOmie.id as string };

  // omie_id é único no banco inteiro: se o código já é de um fornecedor de
  // outra empresa (outra conta Omie, número igual), cadastra sem ele.
  const row = supplierRowFromHub(f, { orgId, createdBy: ctx.id, omieId: byOmie ? null : f.omieCode });
  const { data: created, error } = await admin.from("ctrl_suppliers").insert(row).select("id").single();
  if (error) {
    // Corrida com outro envio do mesmo fornecedor: o índice de documento barrou.
    if (error.code === "23505") {
      const again = await findByDoc();
      if (again) return { ok: true, supplierId: again };
    }
    return { ok: false, error: `Não foi possível cadastrar o fornecedor no Compras: ${error.message}` };
  }
  return { ok: true, supplierId: created.id as string };
}

/**
 * Fornecedor e tipo de despesa têm de ser da empresa da chave. createRequest
 * confere só o setor; a tela nunca oferece cadastro de outra empresa, mas uma
 * chamada direta poderia mandar um fornecedor da Viva numa despesa da Feat.
 */
export async function catalogOutsideOrg(
  ctx: CtrlUserContext,
  ids: { supplierId: string; expenseTypeId: string },
): Promise<string | null> {
  const admin = createAdminClient();
  const [{ data: supplier }, { data: type }] = await Promise.all([
    admin.from("ctrl_suppliers").select("org_id").eq("id", ids.supplierId).maybeSingle(),
    admin.from("ctrl_expense_types").select("org_id, active").eq("id", ids.expenseTypeId).maybeSingle(),
  ]);
  if (!supplier || supplier.org_id !== ctx.orgId) return "Fornecedor não encontrado nesta empresa.";
  if (!type || type.org_id !== ctx.orgId || !type.active) return "Tipo de despesa não encontrado nesta empresa.";
  return null;
}
