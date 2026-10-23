"use client";

import { Building2, ChevronRight, Loader2 } from "lucide-react";
import { useState } from "react";

import { switchCtrlOrg } from "@/components/app/ctrl-org-switcher";
import { ctrlOrgColor } from "@/lib/ctrl/org-gate";

interface CtrlOrgOption {
  id: string;
  nome: string;
  slug: string;
}

/**
 * Seleção OBRIGATÓRIA da empresa do Compras, a cada login, para quem acessa
 * mais de uma empresa. O layout do Compras renderiza isto NO LUGAR da página:
 * nenhum dado de tela é buscado nem mostrado antes da escolha.
 *
 * Nada vem pré-selecionado de propósito — a escolha tem de ser um clique
 * consciente. A última empresa usada só ganha uma etiqueta, para orientar.
 */
export function CtrlOrgGate({ orgs, lastSlug }: { orgs: CtrlOrgOption[]; lastSlug: string | null }) {
  const [pendingSlug, setPendingSlug] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const choose = async (slug: string) => {
    if (pendingSlug) return;
    setPendingSlug(slug);
    setError(null);
    const ok = await switchCtrlOrg(slug).catch(() => false);
    if (!ok) {
      setPendingSlug(null);
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
      <p className="mt-2 text-center text-sm text-muted-foreground">
        Requisições, aprovações e envios à Omie desta sessão serão feitos na empresa escolhida. Você pode trocar
        depois pela faixa no topo da tela.
      </p>

      <div className="mt-8 w-full space-y-3">
        {orgs.map((o) => {
          const c = ctrlOrgColor(o.slug);
          const isPending = pendingSlug === o.slug;
          return (
            <button
              key={o.id}
              type="button"
              onClick={() => choose(o.slug)}
              disabled={pendingSlug !== null}
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
                {o.slug === lastSlug && (
                  <span className="text-xs text-muted-foreground">Última empresa utilizada</span>
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
