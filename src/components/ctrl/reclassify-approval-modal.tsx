"use client";

import { Info, Loader2, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { withCurrent, type CadastroOption } from "@/components/ctrl/edit-expense-routing-modal";
import {
  reclassifyRequestInApproval,
  verifyBudget,
  type BudgetVerification,
} from "@/lib/ctrl/actions/requests";
import { isForcedDirectorRouting, isManagerFinalSector } from "@/lib/ctrl/routing";

type NamedRef = { name: string } | { name: string }[] | null | undefined;

export interface ReclassifyReq {
  id: string;
  request_number: number;
  amount: number;
  status: string;
  approval_tier: string | null;
  sector_id?: string | null;
  expense_type_id?: string | null;
  due_date: string | null;
  reference_month?: number | null;
  reference_year?: number | null;
  created_by: string;
  ctrl_sectors?: NamedRef;
  ctrl_expense_types?: NamedRef;
}

function nameOf(v: NamedRef): string | null {
  if (!v) return null;
  return Array.isArray(v) ? v[0]?.name ?? null : v.name;
}

// Mês/ano em que o orçamento é confrontado — o mesmo critério do servidor
// (planRerouteAfterEdit): o vencimento, com fallback para a competência.
function budgetPeriod(req: ReclassifyReq): { month: number; year: number } | null {
  if (req.due_date) {
    const d = new Date(req.due_date + "T00:00:00");
    return { month: d.getMonth() + 1, year: d.getFullYear() };
  }
  if (req.reference_month && req.reference_year) {
    return { month: req.reference_month, year: req.reference_year };
  }
  return null;
}

// Precisa do diretor com este enquadramento? (fora do orçamento e o setor não
// dispensa o diretor, ou roteamento fixo ao diretor)
function needsDirector(tier: string | null, sectorId: string | null | undefined, createdBy: string) {
  if (isForcedDirectorRouting({ sector_id: sectorId, created_by: createdBy })) return true;
  return tier === "nivel_3" && !isManagerFinalSector(sectorId);
}

// Reclassificação de setor/tipo de despesa na tela de Aprovações, ENQUANTO a
// requisição aguarda o gerente ou o diretor. O orçamento é recalculado com o
// novo enquadramento e a alçada muda junto — a prévia abaixo mostra o resultado
// antes de salvar, com a mesma verificação que o servidor refaz ao gravar.
export function ReclassifyApprovalModal({
  req,
  sectors,
  expenseTypes,
  onClose,
  onSaved,
}: {
  req: ReclassifyReq;
  sectors: CadastroOption[];
  expenseTypes: CadastroOption[];
  onClose: () => void;
  onSaved: (message: string) => void;
}) {
  const [sectorId, setSectorId] = useState(req.sector_id ?? "");
  const [expenseTypeId, setExpenseTypeId] = useState(req.expense_type_id ?? "");
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [preview, setPreview] = useState<BudgetVerification | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  // Só a resposta da ÚLTIMA escolha vale: trocar o tipo duas vezes rápido não
  // pode deixar na tela a prévia do primeiro.
  const previewSeq = useRef(0);

  const currentSector = nameOf(req.ctrl_sectors);
  const currentType = nameOf(req.ctrl_expense_types);
  const sectorOptions = withCurrent(sectors, req.sector_id, currentSector);
  const typeOptions = withCurrent(expenseTypes, req.expense_type_id, currentType);

  const changed =
    sectorId !== (req.sector_id ?? "") || expenseTypeId !== (req.expense_type_id ?? "");
  const period = budgetPeriod(req);

  useEffect(() => {
    const seq = ++previewSeq.current;
    setPreview(null);
    setPreviewError(null);
    if (!changed || !sectorId || !expenseTypeId) {
      setPreviewLoading(false);
      return;
    }
    if (!period) {
      setPreviewLoading(false);
      setPreviewError("Requisição sem vencimento e sem competência — não dá para confrontar o orçamento.");
      return;
    }
    setPreviewLoading(true);
    verifyBudget(sectorId, expenseTypeId, Number(req.amount), period.month, period.year)
      .then((res) => {
        if (seq !== previewSeq.current) return;
        setPreviewLoading(false);
        if ("error" in res) setPreviewError(res.error);
        else setPreview(res);
      })
      .catch((err) => {
        if (seq !== previewSeq.current) return;
        setPreviewLoading(false);
        setPreviewError(err instanceof Error ? err.message : String(err));
      });
    // period vem de req, que não muda enquanto o modal está aberto.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sectorId, expenseTypeId, changed]);

  const directorBefore = needsDirector(req.approval_tier, req.sector_id, req.created_by);
  const forcedAfter = isForcedDirectorRouting({ sector_id: sectorId, created_by: req.created_by });
  const directorAfter = preview ? needsDirector(preview.approvalTier, sectorId, req.created_by) : null;

  // O que acontece com a alçada, em uma frase.
  let nextStep: string | null = null;
  if (preview) {
    if (forcedAfter) {
      nextStep = "Segue para o Diretor — este setor/solicitante vai sempre direto a ele.";
    } else if (directorAfter) {
      nextStep = directorBefore
        ? "Continua exigindo o Gerente e, depois dele, o Diretor."
        : "Passa a exigir o Diretor depois do Gerente.";
    } else {
      nextStep = directorBefore
        ? "Aguarda só o Gerente — a etapa do Diretor deixa de ser necessária."
        : "Aguarda só o Gerente.";
    }
  }
  const managerRestarts = req.status === "pendente_diretor" && !forcedAfter;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!sectorId) {
      setError("Selecione o setor.");
      return;
    }
    if (!expenseTypeId) {
      setError("Selecione o tipo de despesa.");
      return;
    }
    if (!changed) {
      setError("Nada foi alterado — escolha outro setor ou tipo de despesa.");
      return;
    }
    if (!reason.trim()) {
      setError("Informe o motivo da alteração.");
      return;
    }

    setSaving(true);
    const res = await reclassifyRequestInApproval(req.id, {
      sector_id: sectorId,
      expense_type_id: expenseTypeId,
      reason: reason.trim(),
    });
    setSaving(false);
    if ("error" in res && res.error) {
      setError(res.error);
      return;
    }
    const destino = "status" in res && res.status === "pendente_diretor" ? "o Diretor" : "o Gerente";
    onSaved(`Requisição #${req.request_number} reclassificada — aguardando ${destino}.`);
  }

  const inputCls =
    "w-full rounded-md border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring";
  const fmt = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-xl border bg-background shadow-lg">
        <div className="flex items-center justify-between border-b px-6 py-4">
          <div>
            <h3 className="font-semibold">Reclassificar requisição #{req.request_number}</h3>
            <p className="text-sm text-muted-foreground">
              Setor e tipo de despesa — o orçamento e a alçada são recalculados
            </p>
          </div>
          <button onClick={onClose} aria-label="Fechar" className="text-muted-foreground hover:text-foreground">
            <X className="h-4 w-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4 px-6 py-4">
          <div className="rounded-md border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
            <span className="font-medium text-foreground">Hoje:</span> {currentSector ?? "Sem setor"} ·{" "}
            {currentType ?? "Sem tipo de despesa"} · {fmt.format(Number(req.amount))} —{" "}
            {req.status === "pendente_diretor" ? "aguardando o Diretor" : "aguardando o Gerente"}
            {directorBefore && req.status === "pendente" ? " (depois, o Diretor)" : ""}
          </div>

          <div className="space-y-1.5">
            <label className="text-sm font-medium">Setor</label>
            <select value={sectorId} onChange={(e) => setSectorId(e.target.value)} required className={inputCls}>
              <option value="">Selecione…</option>
              {sectorOptions.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </div>

          <div className="space-y-1.5">
            <label className="text-sm font-medium">Tipo de despesa</label>
            <select
              value={expenseTypeId}
              onChange={(e) => setExpenseTypeId(e.target.value)}
              required
              className={inputCls}
            >
              <option value="">Selecione…</option>
              {typeOptions.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          </div>

          {/* Prévia do orçamento e da alçada com o novo enquadramento. */}
          {changed && sectorId && expenseTypeId && (
            <div
              className={`space-y-1 rounded-md border px-3 py-2 text-xs ${
                preview
                  ? directorAfter
                    ? "border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-900/40 dark:bg-amber-950/20 dark:text-amber-300"
                    : "border-emerald-200 bg-emerald-50 text-emerald-900 dark:border-emerald-900/40 dark:bg-emerald-950/20 dark:text-emerald-300"
                  : "bg-muted/30 text-muted-foreground"
              }`}
            >
              {previewLoading ? (
                <p className="flex items-center gap-1.5">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  Conferindo o orçamento…
                </p>
              ) : previewError ? (
                <p className="text-destructive">{previewError}</p>
              ) : preview ? (
                <>
                  <p className="font-medium">{preview.statusLabel}</p>
                  {nextStep && <p>{nextStep}</p>}
                  {managerRestarts && (
                    <p>
                      O Gerente já tinha aprovado com o enquadramento anterior — a aprovação recomeça por ele.
                    </p>
                  )}
                </>
              ) : null}
            </div>
          )}

          <div className="flex items-start gap-2 rounded-md border border-sky-200 bg-sky-50 px-3 py-2 text-xs text-sky-800 dark:border-sky-900/40 dark:bg-sky-950/20 dark:text-sky-300">
            <Info className="mt-0.5 h-4 w-4 shrink-0" />
            <span>
              O valor sai do orçamento do enquadramento atual e passa a contar no novo assim que você salvar.
              O solicitante é avisado, e a alteração fica no histórico da requisição.
            </span>
          </div>

          <div className="space-y-1.5">
            <label className="text-sm font-medium">
              Motivo da alteração <span className="text-destructive">*</span>
            </label>
            <textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={3}
              required
              placeholder="Ex.: a despesa é de Cursos, não de Treinamentos."
              className={inputCls + " resize-none"}
            />
          </div>

          {error && (
            <div className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</div>
          )}

          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-md border px-4 py-2 text-sm font-medium hover:bg-muted"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={saving || !changed}
              className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-60"
            >
              {saving && <Loader2 className="h-4 w-4 animate-spin" />}
              Salvar reclassificação
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
