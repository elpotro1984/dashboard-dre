"use client";

import { ArrowLeftRight, Building2, Loader2, RefreshCw } from "lucide-react";
import { useEffect, useState } from "react";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ctrlOrgColor } from "@/lib/ctrl/org-gate";

interface CtrlOrgOption {
  id: string;
  nome: string;
  slug: string;
}

// Mesmo nome de ACTIVE_CTRL_ORG_COOKIE (active-context.ts, que é server-only
// por importar next/headers) — manter os dois em sincronia.
const ACTIVE_CTRL_ORG_COOKIE = "active_ctrl_org";

/**
 * Grava a empresa ativa do Compras E a confirmação deste login (/api/context) e
 * recarrega a página inteira. Recarga inteira, não router.refresh(): formulário
 * meio preenchido com setor/fornecedor da empresa anterior não pode sobreviver
 * à troca.
 */
export async function switchCtrlOrg(slug: string): Promise<boolean> {
  const res = await fetch("/api/context", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ctrlOrgSlug: slug }),
  });
  if (!res.ok) return false;
  window.location.reload();
  return true;
}

function readCookie(name: string): string | null {
  const hit = document.cookie.split("; ").find((c) => c.startsWith(`${name}=`));
  if (!hit) return null;
  try {
    return decodeURIComponent(hit.slice(name.length + 1));
  } catch {
    return null;
  }
}

/**
 * Faixa da EMPRESA ATIVA do Compras, fixa logo abaixo da barra do topo em todas
 * as telas do módulo. Aparece só quando o usuário acessa mais de uma empresa —
 * com uma só não há o que confundir. Três defesas contra trabalhar na empresa
 * errada:
 *  - destaque: nome grande, na cor própria da empresa (ctrlOrgColor);
 *  - troca confirmada: "Trocar de X para Y?" antes de mudar;
 *  - aba desencontrada: ao voltar a esta aba, se a empresa foi trocada em outra,
 *    a tela é coberta até recarregar (o servidor também recusa o envio — ver
 *    ctrlActiveOrgError; isto é o aviso antes do clique).
 */
export function CtrlOrgBanner({ orgs, activeSlug }: { orgs: CtrlOrgOption[]; activeSlug: string | null }) {
  const [open, setOpen] = useState(false);
  const [target, setTarget] = useState<CtrlOrgOption | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [staleTab, setStaleTab] = useState(false);

  const active = orgs.find((o) => o.slug === activeSlug) ?? null;

  useEffect(() => {
    if (!active) return;
    const check = () => {
      const cookieSlug = readCookie(ACTIVE_CTRL_ORG_COOKIE);
      setStaleTab(Boolean(cookieSlug) && cookieSlug !== active.slug);
    };
    const onVisible = () => {
      if (document.visibilityState === "visible") check();
    };
    window.addEventListener("focus", check);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.removeEventListener("focus", check);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [active]);

  // Uma empresa (ou nenhuma) → sem faixa.
  if (orgs.length <= 1 || !active) return null;

  const color = ctrlOrgColor(active.slug);

  const closeAll = () => {
    if (pending) return;
    setOpen(false);
    setTarget(null);
    setError(null);
  };

  const confirmSwitch = async () => {
    if (!target) return;
    setPending(true);
    setError(null);
    const ok = await switchCtrlOrg(target.slug).catch(() => false);
    if (!ok) {
      setPending(false);
      setError("Não foi possível trocar a empresa. Tente de novo.");
    }
  };

  const others = orgs.filter((o) => o.slug !== active.slug);

  return (
    <>
      {/* Superfície levemente tingida + filete na cor da empresa: destaca sem
          competir com o vermelho, que segue sendo o único acento do sistema. */}
      <div
        className="sticky top-[50px] z-[29] flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-l-4 px-[var(--ch-band-x)] py-2"
        style={{
          background: color.tint,
          borderLeftColor: color.solid,
          borderBottomColor: "var(--line-strong)",
          color: "var(--color-text)",
        }}
        role="status"
        aria-label={`Empresa ativa do Compras: ${active.nome}`}
      >
        <div className="flex min-w-0 items-center gap-2.5">
          <Building2 className="h-4 w-4 shrink-0" strokeWidth={2} style={{ color: color.solid }} />
          <span className="text-xs font-medium uppercase tracking-wider" style={{ color: "var(--ink-55)" }}>
            Você está trabalhando em
          </span>
          <span className="truncate text-sm font-bold uppercase tracking-wide" style={{ color: color.solid }}>
            {active.nome}
          </span>
        </div>
        <button type="button" onClick={() => setOpen(true)} className="ch-btn ch-btn--secondary ml-auto">
          <ArrowLeftRight className="h-3.5 w-3.5" strokeWidth={2} />
          Trocar empresa
        </button>
      </div>

      <Dialog open={open} onOpenChange={(v) => (v ? setOpen(true) : closeAll())}>
        <DialogContent className="sm:max-w-md">
          {!target ? (
            <>
              <DialogHeader>
                <DialogTitle>Trocar de empresa</DialogTitle>
                <DialogDescription>
                  Todas as telas do Compras passam a mostrar a empresa escolhida.
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-2">
                {others.map((o) => {
                  const c = ctrlOrgColor(o.slug);
                  return (
                    <button
                      key={o.id}
                      type="button"
                      onClick={() => setTarget(o)}
                      className="flex w-full items-center gap-3 rounded-lg border px-4 py-3 text-left transition-colors hover:bg-muted"
                    >
                      <span className="h-8 w-1.5 shrink-0 rounded-full" style={{ background: c.solid }} />
                      <span className="font-semibold">{o.nome}</span>
                    </button>
                  );
                })}
              </div>
            </>
          ) : (
            <>
              <DialogHeader>
                <DialogTitle>Confirmar a troca de empresa</DialogTitle>
                <DialogDescription>
                  Trocar de <strong>{active.nome}</strong> para <strong>{target.nome}</strong>? Requisições e
                  envios à Omie feitos depois disso serão da <strong>{target.nome}</strong>.
                </DialogDescription>
              </DialogHeader>
              {error && <p className="text-sm text-destructive">{error}</p>}
              <DialogFooter className="gap-2 sm:gap-0">
                <button
                  type="button"
                  onClick={() => setTarget(null)}
                  disabled={pending}
                  className="ch-btn ch-btn--secondary ch-btn--lg"
                >
                  Voltar
                </button>
                <button
                  type="button"
                  onClick={confirmSwitch}
                  disabled={pending}
                  className="ch-btn ch-btn--primary ch-btn--lg"
                >
                  {pending && <Loader2 className="h-4 w-4 animate-spin" />}
                  Trocar para {target.nome}
                </button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>

      {/* Aba desencontrada: a empresa foi trocada em outra aba. Cobre a tela até
          recarregar — continuar aqui seria trabalhar olhando uma empresa e
          gravando em outra. */}
      {staleTab && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 p-4">
          <div className="w-full max-w-md rounded-xl border bg-background p-6 shadow-xl">
            <h2 className="text-lg font-semibold">A empresa foi trocada em outra aba</h2>
            <p className="mt-2 text-sm text-muted-foreground">
              Esta aba ainda mostra <strong>{active.nome}</strong>, mas a empresa ativa do Compras mudou. Recarregue
              para continuar na empresa certa.
            </p>
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="ch-btn ch-btn--primary ch-btn--lg mt-5 w-full"
            >
              <RefreshCw className="h-4 w-4" />
              Recarregar a página
            </button>
          </div>
        </div>
      )}
    </>
  );
}
