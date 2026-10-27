"use client";

import { Building2, ChevronRight, Loader2 } from "lucide-react";
import { useMemo, useState } from "react";

import { BUSCA_A_PARTIR_DE, CampoBusca, filtrarOpcoes, type EmpresaAtivaOpcao } from "@/components/app/empresa-ativa-banner";
import { ctrlOrgColor } from "@/lib/ctrl/org-gate";

/**
 * Seleção OBRIGATÓRIA da empresa, a cada login, para quem acessa mais de uma
 * empresa num módulo multiempresa. Nasceu no Compras (`CtrlOrgGate`) e é a
 * mesma no Departamento Pessoal. O layout do módulo renderiza isto NO LUGAR da
 * página: nenhum dado de tela é buscado nem mostrado antes da escolha.
 *
 * Nada vem pré-selecionado de propósito — a escolha tem de ser um clique
 * consciente. A última empresa usada só ganha uma etiqueta, para orientar.
 */
export function EmpresaAtivaGate({
  opcoes,
  ultimaChave,
  descricao,
  trocar,
}: {
  opcoes: EmpresaAtivaOpcao[];
  ultimaChave: string | null;
  /** O que fica valendo para a empresa escolhida, e como trocar depois. */
  descricao: string;
  trocar: (chave: string) => Promise<boolean>;
}) {
  const [pendingChave, setPendingChave] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busca, setBusca] = useState("");
  const visiveis = useMemo(() => filtrarOpcoes(opcoes, busca), [opcoes, busca]);

  const choose = async (chave: string) => {
    if (pendingChave) return;
    setPendingChave(chave);
    setError(null);
    const ok = await trocar(chave).catch(() => false);
    if (!ok) {
      setPendingChave(null);
      setError("Não foi possível selecionar a empresa. Tente de novo.");
    }
  };

  return (
    <div className="mx-auto flex max-w-xl flex-col items-center py-10 md:py-16">
      <span
        className="flex h-12 w-12 items-center justify-center rounded-full"
        style={{ background: "var(--accent-tint)", color: "var(--color-accent-700)" }}
      >
        <Building2 className="h-6 w-6" />
      </span>
      <h1 className="mt-4 text-center text-2xl font-semibold">Em qual empresa você vai trabalhar?</h1>
      <p className="mt-2 text-center text-sm text-muted-foreground">{descricao}</p>

      {opcoes.length > BUSCA_A_PARTIR_DE && (
        <div className="mt-6 w-full">
          <CampoBusca valor={busca} onChange={setBusca} />
        </div>
      )}

      <div className={`${opcoes.length > BUSCA_A_PARTIR_DE ? "mt-3" : "mt-8"} w-full space-y-3`}>
        {visiveis.length === 0 && <p className="text-center text-sm text-muted-foreground">Nenhuma empresa com esse nome.</p>}
        {visiveis.map((o) => {
          const c = ctrlOrgColor(o.chave);
          const isPending = pendingChave === o.chave;
          return (
            <button
              key={o.chave}
              type="button"
              onClick={() => choose(o.chave)}
              disabled={pendingChave !== null}
              className="group flex w-full items-center gap-4 rounded-[var(--radius-lg)] border border-l-4 px-5 py-4 text-left shadow-[var(--shadow-sm)] transition-all hover:shadow-[var(--shadow-md)] disabled:opacity-60"
              style={{ background: "var(--ch-card)", borderColor: "var(--line-strong)", borderLeftColor: c.solid }}
            >
              <span
                className="flex h-11 w-11 shrink-0 items-center justify-center rounded-[var(--radius-md)] text-lg font-bold"
                style={{ background: c.tint, color: c.solid }}
              >
                {o.nome.charAt(0).toUpperCase()}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-lg font-bold uppercase tracking-wide">{o.nome}</span>
                {o.chave === ultimaChave ? (
                  <span className="text-xs text-muted-foreground">Última empresa utilizada{o.detalhe ? ` · ${o.detalhe}` : ""}</span>
                ) : (
                  o.detalhe && <span className="text-xs text-muted-foreground">{o.detalhe}</span>
                )}
              </span>
              {isPending ? (
                <Loader2 className="h-5 w-5 shrink-0 animate-spin text-muted-foreground" />
              ) : (
                <ChevronRight className="h-5 w-5 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
              )}
            </button>
          );
        })}
      </div>

      {error && <p className="mt-4 text-sm text-destructive">{error}</p>}
    </div>
  );
}
