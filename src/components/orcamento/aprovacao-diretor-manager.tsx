"use client";

import { useState, useTransition } from "react";
import { Loader2 } from "lucide-react";

import { setAprovacaoDiretor, type CompanyBudgetConfig } from "@/lib/orcamento/actions/config";
import { cn } from "@/lib/utils";

/**
 * Chave "Aprovação do diretor" da empresa × ano (Configuração da empresa).
 *
 * Ligada (padrão), a diretoria aprova os itens do orçamento. Desligada, a
 * empresa não tem essa figura e o gestor que monta o orçamento é quem aprova —
 * nos setores dele. As decisões já tomadas ficam como estão.
 */
export function AprovacaoDiretorManager({
  company,
  year,
}: {
  company: CompanyBudgetConfig;
  year: number;
}) {
  const [ligada, setLigada] = useState(company.aprovacaoDiretor);
  const [salvando, iniciar] = useTransition();
  const [feedback, setFeedback] = useState<{ ok: boolean; msg: string } | null>(null);

  function alternar() {
    const next = !ligada;
    setLigada(next);
    setFeedback(null);
    iniciar(async () => {
      const res = await setAprovacaoDiretor(company.companyId, year, next);
      if (res?.error) {
        setLigada(!next);
        setFeedback({ ok: false, msg: res.error });
        return;
      }
      setFeedback({
        ok: true,
        msg: next
          ? `${company.companyName}: a diretoria aprova o orçamento de ${year}.`
          : `${company.companyName}: o gestor que monta aprova o orçamento de ${year}.`,
      });
    });
  }

  return (
    <div className="space-y-4">
      {feedback && (
        <div
          className={cn(
            "rounded-md px-4 py-2 text-sm",
            feedback.ok ? "bg-green-500/10 text-green-700" : "bg-destructive/10 text-destructive",
          )}
        >
          {feedback.msg}
        </div>
      )}

      <div className="flex items-center justify-between gap-4 rounded-lg border px-4 py-3">
        <div className="min-w-0">
          <p className="truncate font-medium">{company.companyName}</p>
          <p className="text-xs text-muted-foreground">
            {ligada
              ? "A diretoria aprova, reprova ou pede revisão de cada item."
              : "Sem diretor: o gestor que monta o orçamento aprova os itens dos setores dele."}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {salvando && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
          <button
            type="button"
            role="switch"
            aria-checked={ligada}
            aria-label={`Aprovação do diretor — ${company.companyName}`}
            disabled={salvando}
            onClick={alternar}
            className={cn(
              "relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors disabled:opacity-50",
              ligada ? "bg-emerald-600" : "bg-muted-foreground/30",
            )}
          >
            <span
              className={cn(
                "inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform",
                ligada ? "translate-x-5" : "translate-x-0.5",
              )}
            />
          </button>
        </div>
      </div>

      <p className="text-xs text-muted-foreground">
        Mudar a chave não desfaz decisões já tomadas: o que foi aprovado continua aprovado. Muda só
        quem decide daqui em diante. O administrador decide sempre, ligada ou não.
      </p>
    </div>
  );
}
