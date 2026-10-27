"use client";

import { ArrowLeftRight, Building2, Loader2, RefreshCw, Search } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ctrlOrgColor } from "@/lib/ctrl/org-gate";

/** Uma empresa do seletor. `chave` é o que o cookie guarda (slug no Compras, id no DP). */
export interface EmpresaAtivaOpcao {
  chave: string;
  nome: string;
  /** Linha discreta embaixo do nome (ex.: "12 colaboradores"). */
  detalhe?: string | null;
}

/** A partir de quantas empresas a lista ganha busca (o gestor do DP vê o grupo inteiro). */
export const BUSCA_A_PARTIR_DE = 8;

const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

export function filtrarOpcoes(opcoes: EmpresaAtivaOpcao[], busca: string): EmpresaAtivaOpcao[] {
  const q = norm(busca.trim());
  return q ? opcoes.filter((o) => norm(o.nome).includes(q)) : opcoes;
}

export function lerCookie(name: string): string | null {
  const hit = document.cookie.split("; ").find((c) => c.startsWith(`${name}=`));
  if (!hit) return null;
  try {
    return decodeURIComponent(hit.slice(name.length + 1));
  } catch {
    return null;
  }
}

/**
 * Faixa da EMPRESA ATIVA de um módulo multiempresa, fixa logo abaixo da barra
 * do topo em todas as telas dele. Nasceu no Compras (`CtrlOrgBanner`) e é a
 * mesma no Departamento Pessoal. Aparece só quando a pessoa acessa mais de uma
 * empresa — com uma só não há o que confundir. Três defesas contra trabalhar na
 * empresa errada:
 *  - destaque: nome grande, na cor própria da empresa (ctrlOrgColor);
 *  - troca confirmada: "Trocar de X para Y?" antes de mudar;
 *  - aba desencontrada: ao voltar a esta aba, se a empresa foi trocada em outra,
 *    a tela é coberta até recarregar.
 */
export function EmpresaAtivaBanner({
  opcoes,
  ativaChave,
  cookie,
  modulo,
  oQueMuda,
  trocar,
}: {
  opcoes: EmpresaAtivaOpcao[];
  ativaChave: string | null;
  /** Cookie da empresa ativa — é por ele que se percebe a troca feita em outra aba. */
  cookie: string;
  /** "Compras", "Departamento Pessoal". */
  modulo: string;
  /** O que passa a valer para a nova empresa: "Requisições e envios à Omie" (concorda com "feitos"). */
  oQueMuda: string;
  /** Grava a empresa e recarrega a página; false se não conseguiu. */
  trocar: (chave: string) => Promise<boolean>;
}) {
  const [open, setOpen] = useState(false);
  const [target, setTarget] = useState<EmpresaAtivaOpcao | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [staleTab, setStaleTab] = useState(false);
  const [busca, setBusca] = useState("");

  const active = opcoes.find((o) => o.chave === ativaChave) ?? null;
  const others = useMemo(() => filtrarOpcoes(opcoes.filter((o) => o.chave !== ativaChave), busca), [opcoes, ativaChave, busca]);

  useEffect(() => {
    if (!active) return;
    const check = () => {
      const noCookie = lerCookie(cookie);
      setStaleTab(Boolean(noCookie) && noCookie !== active.chave);
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
  }, [active, cookie]);

  // Uma empresa (ou nenhuma) → sem faixa.
  if (opcoes.length <= 1 || !active) return null;

  const color = ctrlOrgColor(active.chave);

  const closeAll = () => {
    if (pending) return;
    setOpen(false);
    setTarget(null);
    setError(null);
    setBusca("");
  };

  const confirmSwitch = async () => {
    if (!target) return;
    setPending(true);
    setError(null);
    const ok = await trocar(target.chave).catch(() => false);
    if (!ok) {
      setPending(false);
      setError("Não foi possível trocar a empresa. Tente de novo.");
    }
  };

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
        aria-label={`Empresa ativa do ${modulo}: ${active.nome}`}
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
                <DialogDescription>Todas as telas do {modulo} passam a mostrar a empresa escolhida.</DialogDescription>
              </DialogHeader>
              {opcoes.length > BUSCA_A_PARTIR_DE && <CampoBusca valor={busca} onChange={setBusca} />}
              <div className="max-h-[50vh] space-y-2 overflow-y-auto">
                {others.length === 0 && <p className="py-2 text-sm text-muted-foreground">Nenhuma empresa com esse nome.</p>}
                {others.map((o) => {
                  const c = ctrlOrgColor(o.chave);
                  return (
                    <button
                      key={o.chave}
                      type="button"
                      onClick={() => setTarget(o)}
                      className="flex w-full items-center gap-3 rounded-lg border px-4 py-3 text-left transition-colors hover:bg-muted"
                    >
                      <span className="h-8 w-1.5 shrink-0 rounded-full" style={{ background: c.solid }} />
                      <span className="min-w-0">
                        <span className="block truncate font-semibold">{o.nome}</span>
                        {o.detalhe && <span className="block text-xs text-muted-foreground">{o.detalhe}</span>}
                      </span>
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
                  Trocar de <strong>{active.nome}</strong> para <strong>{target.nome}</strong>? {oQueMuda} feitos depois disso
                  serão da <strong>{target.nome}</strong>.
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
          achando que é outra. */}
      {staleTab && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 p-4">
          <div className="w-full max-w-md rounded-xl border bg-background p-6 shadow-xl">
            <h2 className="text-lg font-semibold">A empresa foi trocada em outra aba</h2>
            <p className="mt-2 text-sm text-muted-foreground">
              Esta aba ainda mostra <strong>{active.nome}</strong>, mas a empresa ativa do {modulo} mudou. Recarregue
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

export function CampoBusca({ valor, onChange }: { valor: string; onChange: (v: string) => void }) {
  return (
    <div className="relative">
      <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
      <input
        autoFocus
        value={valor}
        onChange={(e) => onChange(e.target.value)}
        placeholder="Buscar empresa"
        className="w-full rounded-md border border-input bg-background py-2 pl-8 pr-2 text-sm"
      />
    </div>
  );
}
