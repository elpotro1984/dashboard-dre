"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, ChevronDown, Search, TrendingUp } from "lucide-react";

import { AnchoredPopover } from "@/components/common/anchored-popover";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useToast } from "@/components/ui/toaster";
import { desfazerPromocao, registrarPromocao } from "@/lib/dp/actions-folha";
import { rotuloCompetencia } from "@/lib/dp/folha/parametros";
import { ROTULO_ESTADO_PROMOCAO, type DpEstadoPromocao, type DpPromocao } from "@/lib/dp/folha/promocao";
import type { DpFolhaLinhaCargo, DpFolhaPessoa } from "@/lib/dp/folha/queries";

import { inputCls, NumCampo } from "./campos";
import { brl } from "./formato";

// PROMOÇÃO na própria folha: a lista suspensa do cargo (com a busca fixa no
// topo) oferece as linhas da tabela salarial da empresa; escolher abre a
// confirmação com o salário sugerido da linha e o mês de início. A folha passa
// a usar o novo dali em diante e mostra "pendente na Sólides" até a
// sincronização trazer o mesmo salário (regra em @/lib/dp/folha/promocao).

const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

/** A lista de cargos com a busca FIXA no topo. Setas andam, Enter escolhe. */
export function DpListaCargos({
  tabela,
  atualId,
  onEscolher,
}: {
  tabela: DpFolhaLinhaCargo[];
  atualId: string | null;
  onEscolher: (l: DpFolhaLinhaCargo) => void;
}) {
  const [busca, setBusca] = useState("");
  const [ativo, setAtivo] = useState(0);
  const listaRef = useRef<HTMLDivElement>(null);
  const filtradas = useMemo(() => {
    const termos = norm(busca.trim()).split(/\s+/).filter(Boolean);
    return termos.length === 0 ? tabela : tabela.filter((l) => termos.every((t) => norm(`${l.cargo} ${l.setor}`).includes(t)));
  }, [tabela, busca]);
  useEffect(() => setAtivo(0), [busca]);
  useEffect(() => {
    listaRef.current?.querySelector<HTMLElement>(`[data-idx="${ativo}"]`)?.scrollIntoView({ block: "nearest" });
  }, [ativo]);

  return (
    <div className="flex flex-col">
      <div className="sticky top-0 border-b border-border bg-surface-1 p-2">
        <div className="relative">
          <Search className="pointer-events-none absolute left-2 top-2 h-4 w-4 text-ink-muted" />
          <input
            autoFocus
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") {
                e.preventDefault();
                setAtivo((i) => Math.min(i + 1, filtradas.length - 1));
              } else if (e.key === "ArrowUp") {
                e.preventDefault();
                setAtivo((i) => Math.max(i - 1, 0));
              } else if (e.key === "Enter" && filtradas[ativo]) {
                e.preventDefault();
                onEscolher(filtradas[ativo]);
              }
            }}
            placeholder="Buscar cargo ou setor"
            className="w-full rounded-md border border-input bg-background py-1.5 pl-8 pr-2 text-sm"
          />
        </div>
      </div>
      <div ref={listaRef} className="max-h-72 overflow-y-auto py-1" role="listbox">
        {tabela.length === 0 ? (
          <p className="px-3 py-2 text-sm text-ink-muted">A tabela salarial desta empresa está vazia — cadastre os cargos em Cargos e salários.</p>
        ) : filtradas.length === 0 ? (
          <p className="px-3 py-2 text-sm text-ink-muted">Nenhum cargo encontrado.</p>
        ) : (
          filtradas.map((l, i) => (
            <button
              key={l.id}
              type="button"
              role="option"
              aria-selected={i === ativo}
              data-idx={i}
              onMouseEnter={() => setAtivo(i)}
              onClick={() => onEscolher(l)}
              className={`flex w-full items-start gap-2 px-3 py-1.5 text-left text-sm ${i === ativo ? "bg-muted" : ""}`}
            >
              <Check className={`mt-0.5 h-3.5 w-3.5 shrink-0 ${l.id === atualId ? "text-primary" : "invisible"}`} />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-ink-primary">{l.cargo}</span>
                <span className="block text-xs text-ink-muted">
                  {[l.setor || null, brl(l.salario)].filter(Boolean).join(" · ")}
                </span>
              </span>
            </button>
          ))
        )}
      </div>
    </div>
  );
}

/** O que a promoção da pessoa está fazendo agora — a etiqueta da linha. */
export function DpPromocaoSelo({ pessoa }: { pessoa: DpFolhaPessoa }) {
  const p = pessoa.promocao;
  if (p && (p.estado === "pendente" || p.estado === "divergente")) {
    return (
      <span className="ml-2 rounded bg-amber-500/10 px-1.5 text-xs text-amber-800 dark:text-amber-300" title={p.aviso ?? undefined}>
        {ROTULO_ESTADO_PROMOCAO[p.estado]}
      </span>
    );
  }
  if (pessoa.promocaoAgendada) {
    return (
      <span className="ml-2 rounded bg-sky-500/10 px-1.5 text-xs text-sky-800 dark:text-sky-300">
        promoção em {rotuloCompetencia(pessoa.promocaoAgendada.vigencia)}
      </span>
    );
  }
  return null;
}

/** Confirmação da promoção: salário sugerido da linha (editável), mês de início e motivo. */
export function DpPromocaoForm({
  pessoa,
  linha,
  competencia,
  companyId,
  onFeito,
  onCancelar,
}: {
  pessoa: DpFolhaPessoa;
  linha: DpFolhaLinhaCargo;
  competencia: string;
  companyId: string;
  onFeito: () => void;
  onCancelar: () => void;
}) {
  const [salario, setSalario] = useState(linha.salario);
  const [vigencia, setVigencia] = useState(competencia);
  const [motivo, setMotivo] = useState("");
  const [pending, start] = useTransition();
  const router = useRouter();
  const { showToast } = useToast();
  const atual = pessoa.salario;
  const dif = atual ? ((salario - atual) / atual) * 100 : null;

  const registrar = () =>
    start(async () => {
      const res = await registrarPromocao({ companyId, solidesId: pessoa.solidesId, vigencia, linhaId: linha.id, salario, motivo });
      if (!res.ok) {
        showToast({ title: "Promoção não registrada", description: res.error, variant: "destructive" });
        return;
      }
      showToast({
        title: "Promoção registrada",
        description: pessoa.avulso ? pessoa.nome : `${pessoa.nome} — atualize cargo e salário na Sólides.`,
        variant: "success",
      });
      router.refresh();
      onFeito();
    });

  return (
    <div className="space-y-3">
      <div className="grid gap-2 rounded-md border border-border p-3 text-sm sm:grid-cols-2">
        <div>
          <div className="text-xs text-ink-muted">Hoje</div>
          <div className="text-ink-primary">{pessoa.cargo ?? "Sem cargo na Sólides"}</div>
          <div className="tabular-nums text-ink-muted">{atual === null ? "sem salário" : brl(atual)}</div>
        </div>
        <div>
          <div className="text-xs text-ink-muted">Promovido para</div>
          <div className="font-medium text-ink-primary">{linha.cargo}</div>
          <div className="text-ink-muted">
            {[linha.setor || null, `tabela ${brl(linha.salario)}`].filter(Boolean).join(" · ")}
          </div>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <label className="block space-y-0.5">
          <span className="text-xs font-medium text-ink-muted">Salário novo</span>
          <NumCampo valor={salario} onChange={setSalario} />
          {dif !== null && Number.isFinite(dif) && (
            <span className="block text-[11px] text-ink-muted">
              {dif >= 0 ? "+" : ""}
              {dif.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}% sobre o salário de hoje
            </span>
          )}
        </label>
        <label className="block space-y-0.5">
          <span className="text-xs font-medium text-ink-muted">A partir de</span>
          <input type="month" className={inputCls} value={vigencia} onChange={(e) => setVigencia(e.target.value)} />
        </label>
      </div>
      <label className="block space-y-0.5">
        <span className="text-xs font-medium text-ink-muted">Motivo (opcional)</span>
        <input className={inputCls} value={motivo} onChange={(e) => setMotivo(e.target.value)} maxLength={300} placeholder="Ex.: promoção aprovada pela diretoria" />
      </label>
      <p className="text-xs text-ink-muted">
        {pessoa.avulso
          ? "Pessoa fora da Sólides: a folha usa o cargo e o salário novos a partir do mês escolhido."
          : "A folha usa o cargo e o salário novos a partir do mês escolhido e marca a pessoa como “pendente na Sólides”. Atualize a Sólides — quando a sincronização trouxer o mesmo salário, a marca some sozinha."}
      </p>
      <div className="flex justify-end gap-2">
        <button type="button" className="rounded-md border border-input px-3 py-1.5 text-sm hover:bg-muted" disabled={pending} onClick={onCancelar}>
          Cancelar
        </button>
        <button
          type="button"
          disabled={pending || !(salario > 0) || !vigencia}
          onClick={registrar}
          className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
        >
          {pending ? "Aguarde…" : "Registrar promoção"}
        </button>
      </div>
    </div>
  );
}

/** A promoção registrada (vigente ou agendada), com o desfazer. */
export function DpPromocaoInfo({ pessoa, companyId, editavel }: { pessoa: DpFolhaPessoa; companyId: string; editavel: boolean }) {
  const [pending, start] = useTransition();
  const router = useRouter();
  const { showToast } = useToast();
  const itens: Array<{ p: DpPromocao; quando: string; estado: DpEstadoPromocao | null }> = [];
  if (pessoa.promocao && pessoa.promocao.estado !== "refletida") itens.push({ p: pessoa.promocao, quando: "vale desde", estado: pessoa.promocao.estado });
  if (pessoa.promocaoAgendada) itens.push({ p: pessoa.promocaoAgendada, quando: "a partir de", estado: null });
  if (itens.length === 0) return null;
  const desfazer = (id: string) =>
    start(async () => {
      const res = await desfazerPromocao({ companyId, id });
      if (!res.ok) showToast({ title: "Não desfeita", description: res.error, variant: "destructive" });
      else showToast({ title: "Promoção desfeita", variant: "success" });
      router.refresh();
    });
  return (
    <ul className="space-y-1 text-xs">
      {itens.map(({ p, quando, estado }) => (
        <li key={p.id} className="flex flex-wrap items-center gap-x-2 text-ink-muted">
          <TrendingUp className="h-3.5 w-3.5 text-primary" />
          <span>
            <span className="text-ink-primary">{p.cargo}</span> · {brl(p.salario)} · {quando} {rotuloCompetencia(p.vigencia)}
            {estado ? ` · ${ROTULO_ESTADO_PROMOCAO[estado]}` : ""}
            {p.motivo ? ` · ${p.motivo}` : ""}
          </span>
          {editavel && (
            <button type="button" disabled={pending} onClick={() => desfazer(p.id)} className="text-red-700 hover:underline disabled:opacity-50 dark:text-red-400">
              desfazer
            </button>
          )}
        </li>
      ))}
    </ul>
  );
}

/**
 * A célula do cargo na tabela: o cargo que a folha usa, a lista suspensa com a
 * busca no topo e, ao escolher, a confirmação. Painel em portal — a tabela
 * rola na horizontal e cortaria um painel posicionado dentro dela.
 */
export function DpCargoCelula({
  pessoa,
  tabela,
  competencia,
  companyId,
  editavel,
}: {
  pessoa: DpFolhaPessoa;
  tabela: DpFolhaLinhaCargo[];
  competencia: string;
  companyId: string;
  editavel: boolean;
}) {
  const [aberto, setAberto] = useState(false);
  const [escolhida, setEscolhida] = useState<DpFolhaLinhaCargo | null>(null);
  const botaoRef = useRef<HTMLButtonElement>(null);
  const texto = pessoa.cargo ?? "—";

  return (
    // A linha abre a janela da pessoa: o clique no cargo não pode chegar até ela.
    <div onClick={(e) => e.stopPropagation()}>
      {editavel ? (
        <button
          ref={botaoRef}
          type="button"
          onClick={() => setAberto((v) => !v)}
          className="inline-flex max-w-[16rem] items-center gap-1 rounded-md border border-transparent px-1.5 py-0.5 text-left hover:border-input hover:bg-background"
          title="Promover: escolher outro cargo da tabela salarial"
        >
          <span className="truncate">{texto}</span>
          <ChevronDown className="h-3.5 w-3.5 shrink-0 text-ink-muted" />
        </button>
      ) : (
        <span className="px-1.5">{texto}</span>
      )}
      <DpPromocaoSelo pessoa={pessoa} />
      {aberto && (
        <AnchoredPopover anchorRef={botaoRef} onClose={() => setAberto(false)} width={340} label="Escolher cargo">
          <DpListaCargos
            tabela={tabela}
            atualId={pessoa.promocao?.linhaId ?? pessoa.linhaId}
            onEscolher={(l) => {
              setAberto(false);
              setEscolhida(l);
            }}
          />
        </AnchoredPopover>
      )}
      <Dialog open={escolhida !== null} onOpenChange={(o) => !o && setEscolhida(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Promover {pessoa.nome}</DialogTitle>
            <DialogDescription>Cargo e salário novos na folha, a partir do mês escolhido.</DialogDescription>
          </DialogHeader>
          {escolhida && (
            <DpPromocaoForm
              pessoa={pessoa}
              linha={escolhida}
              competencia={competencia}
              companyId={companyId}
              onFeito={() => setEscolhida(null)}
              onCancelar={() => setEscolhida(null)}
            />
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
