"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { ExternalLink, FileDown, FileText, Loader2, Paperclip, PenLine, Plus, Receipt, Search } from "lucide-react";

import { getContractAttachmentUrl, getSaleContractUrl, getContratoComprovantes } from "@/lib/case/actions/contracts";
import { useToast } from "@/components/ui/toaster";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { DialogTitle } from "@/components/ui/dialog";
import type { AgendaContract, AgendaImportado } from "@/lib/case/queries";
import type { CaseContractStatus } from "@/lib/case/types";

// ─── Formatação ──────────────────────────────────────────────────────────────

const fmt = new Intl.NumberFormat("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const brl = (v: number) => `R$ ${fmt.format(v)}`;
const brlK = (v: number) =>
  v >= 1_000_000
    ? `R$ ${(v / 1_000_000).toLocaleString("pt-BR", { maximumFractionDigits: 2 })} mi`
    : v >= 1000
      ? `R$ ${(v / 1000).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} mil`
      : brl(v);

const MESES = ["Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho", "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro"];
const MES3 = ["JAN", "FEV", "MAR", "ABR", "MAI", "JUN", "JUL", "AGO", "SET", "OUT", "NOV", "DEZ"];
const WD = ["DOM", "SEG", "TER", "QUA", "QUI", "SEX", "SÁB"];
const WD_LONGO = ["domingo", "segunda-feira", "terça-feira", "quarta-feira", "quinta-feira", "sexta-feira", "sábado"];
const SEM_DATA = "9999-99";

function parseDate(d: string): Date {
  const [y, m, dd] = d.slice(0, 10).split("-").map(Number);
  return new Date(y, m - 1, dd);
}
function diffDias(d: string, hoje: string): number {
  return Math.round((parseDate(d).getTime() - parseDate(hoje).getTime()) / 86_400_000);
}
function relativo(n: number): string {
  if (n === 0) return "hoje";
  if (n === 1) return "amanhã";
  if (n === -1) return "ontem";
  return n > 1 ? `em ${n} dias` : `há ${-n} dias`;
}
function dateBR(d: string | null): string {
  if (!d) return "Sem data";
  const [y, m, day] = d.slice(0, 10).split("-");
  return `${day}/${m}/${y}`;
}
function dataLonga(d: string): string {
  const x = parseDate(d);
  return `${WD_LONGO[x.getDay()]}, ${x.getDate()} de ${MESES[x.getMonth()].toLowerCase()} de ${x.getFullYear()}`;
}
function monthKey(d: string | null): string {
  return d ? d.slice(0, 7) : SEM_DATA;
}
function monthLabel(key: string): string {
  if (key === SEM_DATA) return "Sem data";
  const [y, m] = key.split("-");
  return `${MESES[Number(m) - 1]} ${y}`;
}

// ─── Etapas / status ─────────────────────────────────────────────────────────

type StatusMeta = { label: string; c: string; step: number; next: string; pill: string; ink: string };

const ETAPAS = ["Rascunho", "Aprovação", "Assinatura", "Assinado", "Lançado"];

// `c` pinta pontos/barras (status do design system); `pill`/`ink` têm variante dark.
const ST: Record<CaseContractStatus | "trello", StatusMeta> = {
  rascunho: { label: "Rascunho", c: "#9b9797", step: 0, next: "Finalize o rascunho e envie para aprovação.", pill: "bg-slate-500/15 text-slate-700 dark:text-slate-300", ink: "text-slate-700 dark:text-slate-300" },
  aguardando_aprovacao: { label: "Aguardando aprovação", c: "#F79009", step: 1, next: "Aguardando o aprovador liberar o contrato para assinatura.", pill: "bg-amber-500/15 text-amber-800 dark:text-amber-300", ink: "text-amber-800 dark:text-amber-300" },
  aguardando_assinatura: { label: "Aguardando assinatura", c: "#3B82F6", step: 2, next: "O contratante ainda não assinou. Reenvie o link de assinatura se necessário.", pill: "bg-blue-500/15 text-blue-700 dark:text-blue-300", ink: "text-blue-700 dark:text-blue-300" },
  assinado: { label: "Assinado", c: "#06AED4", step: 3, next: "Contrato assinado. Próximo passo: lançar os títulos no Omie.", pill: "bg-cyan-500/15 text-cyan-800 dark:text-cyan-300", ink: "text-cyan-800 dark:text-cyan-300" },
  lancado: { label: "Lançado no Omie", c: "#12B76A", step: 4, next: "Títulos lançados no Omie. Acompanhe os recebimentos abaixo.", pill: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300", ink: "text-emerald-700 dark:text-emerald-300" },
  parcial: { label: "Lançado parcial", c: "#F79009", step: 4, next: "Só parte dos títulos foi lançada no Omie. Confira os que faltam.", pill: "bg-amber-500/15 text-amber-800 dark:text-amber-300", ink: "text-amber-800 dark:text-amber-300" },
  erro: { label: "Erro no Omie", c: "#EC3013", step: 4, next: "Falha ao lançar os títulos no Omie. Revise o contrato e tente de novo.", pill: "bg-red-500/15 text-red-700 dark:text-red-300", ink: "text-red-700 dark:text-red-300" },
  cancelado: { label: "Cancelado", c: "#9b9797", step: -1, next: "Contrato cancelado.", pill: "bg-zinc-500/15 text-zinc-600 dark:text-zinc-400", ink: "text-zinc-600 dark:text-zinc-400" },
  trello: { label: "Histórico Trello", c: "#9b9797", step: -1, next: "", pill: "bg-zinc-500/15 text-zinc-600 dark:text-zinc-400", ink: "text-zinc-600 dark:text-zinc-400" },
};

const ORDEM_FILTRO: CaseContractStatus[] = ["rascunho", "aguardando_aprovacao", "aguardando_assinatura", "assinado", "lancado", "parcial", "erro", "cancelado"];
const SEMPRE_VISIVEIS = new Set<CaseContractStatus>(["rascunho", "aguardando_aprovacao", "aguardando_assinatura", "assinado", "lancado", "erro"]);

/** Status efetivo: erro em título sobrepõe "lançado". */
function statusDe(c: AgendaContract): CaseContractStatus {
  return c.temErro && c.status !== "cancelado" ? "erro" : c.status;
}

type Pagamento = { has: boolean; pct: number; label: string; bar: string; ink: string };

function pagamento(c: AgendaContract): Pagamento {
  if (c.temErro) return { has: false, pct: 0, label: "Erro ao lançar no Omie", bar: "", ink: ST.erro.ink };
  if (c.titles.length === 0) return { has: false, pct: 0, label: "Sem títulos no Omie", bar: "", ink: "text-ink-muted" };
  const total = c.aReceberTotal + c.aPagarTotal;
  const pago = c.aReceberPago + c.aPagarPago;
  const pct = total > 0 ? Math.min(100, Math.round((pago / total) * 100)) : 0;
  if (total > 0 && pago >= total - 0.005) return { has: true, pct: 100, label: "Quitado", bar: "bg-emerald-500", ink: ST.lancado.ink };
  return { has: true, pct, label: `${pct}% pago`, bar: "bg-blue-500", ink: ST.aguardando_assinatura.ink };
}

// ─── Item unificado (contrato do sistema ou cartão do Trello) ───────────────

type Item =
  | { tipo: "contrato"; key: string; data: string | null; st: CaseContractStatus; c: AgendaContract }
  | { tipo: "trello"; key: string; data: string; st: "trello"; t: AgendaImportado };

type Filtro = CaseContractStatus | "todos" | "trello";

function tituloImportado(t: AgendaImportado): string {
  const partes = [t.categoria, t.turma].filter(Boolean);
  return partes.length > 0 ? partes.join(" - ") : t.titulo_original;
}
function periodoBR(t: AgendaImportado): string {
  return t.event_date_fim ? `${dateBR(t.event_date)} a ${dateBR(t.event_date_fim)}` : dateBR(t.event_date);
}
function itemTitulo(i: Item): string {
  return i.tipo === "contrato" ? i.c.event_name || i.c.client_name : tituloImportado(i.t);
}
function itemAtracoes(i: Item): string {
  const a = i.tipo === "contrato" ? (i.c.atracoes.length > 0 ? i.c.atracoes : [i.c.band_name]) : i.t.atracoes;
  return a.filter(Boolean).join(" + ") || "Atração não informada";
}
function itemLocal(i: Item): string {
  const l = i.tipo === "contrato" ? [i.c.local_name, i.c.local_city] : [i.t.local_name, i.t.local_city];
  return l.filter(Boolean).join(" — ") || "Local não informado";
}
function itemBusca(i: Item): string {
  const base =
    i.tipo === "contrato"
      ? [i.c.event_name, i.c.client_name, i.c.band_name, ...i.c.atracoes, i.c.local_name, i.c.local_city, String(i.c.contract_number)]
      : [i.t.titulo_original, i.t.categoria, i.t.turma, ...i.t.atracoes, i.t.local_name, ...i.t.nps.map(String)];
  return base.filter(Boolean).join(" ").toLowerCase();
}
function itemNp(i: Item): string {
  if (i.tipo === "contrato") return `NP ${i.c.contract_number}`;
  return i.t.nps.length > 0 ? `NP ${i.t.nps.join(", ")} · Trello` : "Importado do Trello";
}

// ─── Peças visuais ───────────────────────────────────────────────────────────

const label = "text-[11px] font-bold uppercase tracking-label text-ink-muted";
const panel = "rounded-viva-lg bg-surface-1 shadow-viva-sm";

function Dot({ c, className = "h-2 w-2" }: { c: string; className?: string }) {
  return <span className={`inline-block shrink-0 rounded-full ${className}`} style={{ background: c }} />;
}

function StatusPill({ st }: { st: CaseContractStatus | "trello" }) {
  const m = ST[st];
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-bold ${m.pill}`}>
      <Dot c={m.c} className="h-1.5 w-1.5" />
      {m.label}
    </span>
  );
}

function EtapasBar({ st }: { st: CaseContractStatus }) {
  const m = ST[st];
  if (m.step < 0) return null;
  return (
    <div className="flex gap-[3px]" aria-label={`Etapa ${m.step + 1} de ${ETAPAS.length}`}>
      {ETAPAS.map((e, i) => (
        <div key={e} className="h-1 flex-1 rounded-full bg-surface-2" style={i <= m.step ? { background: m.c } : undefined} />
      ))}
    </div>
  );
}

// ─── Cabeçalho ───────────────────────────────────────────────────────────────

function Cabecalho({ q, setQ, view, setView }: { q: string; setQ: (v: string) => void; view: "tl" | "cal"; setView: (v: "tl" | "cal") => void }) {
  return (
    <header className="flex flex-wrap items-end justify-between gap-4">
      <div className="min-w-0 space-y-1.5">
        <div className={label}>Case Shows</div>
        <h1 className="text-[28px] font-extrabold leading-tight tracking-tight text-ink-primary">Agenda de Contratos</h1>
        <p className="text-sm text-ink-secondary">
          Todos os eventos contratados, em ordem de data. Clique em um evento para ver contratante, valores e pagamentos.
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-2.5">
        <label className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-muted" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Buscar evento, atração ou contratante"
            className="h-[38px] w-[300px] max-w-full rounded-viva-sm border border-border bg-surface-1 pl-9 pr-3 text-[13px] text-ink-primary outline-none placeholder:text-ink-muted focus:border-ink-secondary"
          />
        </label>
        <div className="flex gap-0.5 rounded-viva-md border border-border bg-surface-1 p-[3px]">
          {(
            [
              ["tl", "Linha do tempo"],
              ["cal", "Calendário"],
            ] as const
          ).map(([k, l]) => (
            <button
              key={k}
              type="button"
              onClick={() => setView(k)}
              className={`h-[30px] rounded-viva-sm px-3.5 text-[13px] font-semibold transition-colors ${
                view === k ? "bg-ink-primary text-surface-1" : "text-ink-secondary hover:bg-surface-2"
              }`}
            >
              {l}
            </button>
          ))}
        </div>
        <Link
          href="/case/contratos/novo"
          className="inline-flex h-[38px] items-center gap-1.5 rounded-viva-sm bg-primary px-4 text-[13px] font-bold text-primary-foreground hover:opacity-90"
        >
          <Plus className="h-4 w-4" /> Novo contrato
        </Link>
      </div>
    </header>
  );
}

// ─── Próximo evento + Atenção ────────────────────────────────────────────────

function ProximoEvento({ i, hoje, onOpen }: { i: Extract<Item, { tipo: "contrato" }>; hoje: string; onOpen: () => void }) {
  const x = parseDate(i.data!);
  const m = ST[i.st];
  return (
    <button
      type="button"
      onClick={onOpen}
      className="flex min-w-0 flex-[1_1_440px] flex-wrap items-stretch gap-7 rounded-viva-lg bg-ink-primary p-7 text-left text-surface-1 transition-opacity hover:opacity-95"
    >
      <div className="flex min-w-[120px] flex-col items-start justify-between gap-4">
        <div className="text-[11px] font-semibold uppercase tracking-label opacity-70">Próximo evento</div>
        <div>
          <div className="text-[72px] font-extrabold leading-[0.9] tracking-tighter">{x.getDate()}</div>
          <div className="text-[15px] font-bold uppercase tracking-display">
            {MES3[x.getMonth()]} · {WD[x.getDay()]}
          </div>
        </div>
        <span className="rounded-full bg-primary px-2.5 py-1 text-xs font-bold text-primary-foreground">{relativo(diffDias(i.data!, hoje))}</span>
      </div>
      <div className="flex min-w-0 flex-[1_1_240px] flex-col gap-3.5 border-l pl-7" style={{ borderColor: "color-mix(in srgb, currentColor 15%, transparent)" }}>
        <div className="text-xs opacity-70">
          NP {i.c.contract_number}
          {i.c.show_time ? ` · ${i.c.show_time}` : ""}
        </div>
        <div className="text-2xl font-extrabold leading-tight [text-wrap:pretty]">{itemTitulo(i)}</div>
        <div className="flex flex-col gap-1 text-sm opacity-80">
          <span>{itemAtracoes(i)}</span>
          <span>{itemLocal(i)}</span>
        </div>
        <div
          className="mt-auto flex flex-wrap items-center justify-between gap-3 border-t pt-3.5"
          style={{ borderColor: "color-mix(in srgb, currentColor 15%, transparent)" }}
        >
          <span className="inline-flex items-center gap-2 text-[13px] font-semibold">
            <Dot c={m.c} /> {m.label}
          </span>
          <span className="text-xl font-extrabold tabular-nums">{brl(i.c.valor_total)}</span>
        </div>
        <div className="text-xs opacity-70">{m.next}</div>
      </div>
    </button>
  );
}

type Alerta = { i: Extract<Item, { tipo: "contrato" }>; n: number; motivo: string };

function alertasDe(items: Item[], hoje: string): Alerta[] {
  const out: Alerta[] = [];
  for (const i of items) {
    if (i.tipo !== "contrato" || !i.data || i.data < hoje) continue;
    const n = diffDias(i.data, hoje);
    let motivo: string | null = null;
    if (i.st === "erro") motivo = "Falha ao lançar títulos no Omie";
    else if (i.st === "parcial" && n <= 30) motivo = "Lançamento parcial no Omie";
    else if (i.st === "aguardando_assinatura" && n <= 35) motivo = "Contratante ainda não assinou";
    else if (i.st === "assinado" && n <= 14) motivo = "Assinado, títulos não lançados";
    else if (i.st === "aguardando_aprovacao" && n <= 30) motivo = "Aguardando aprovação";
    else if (i.st === "rascunho" && n <= 45) motivo = "Ainda em rascunho";
    if (motivo) out.push({ i, n, motivo });
  }
  return out.sort((a, b) => a.n - b.n);
}

function Atencao({ alertas, onOpen }: { alertas: Alerta[]; onOpen: (i: Item) => void }) {
  const [todos, setTodos] = useState(false);
  const visiveis = todos ? alertas : alertas.slice(0, 4);
  return (
    <section className={`${panel} flex min-w-0 flex-[1_1_380px] flex-col overflow-hidden`}>
      <div className="flex items-center justify-between gap-3 bg-primary px-5 py-4 text-primary-foreground">
        <span className="text-[13px] font-bold">Precisa da sua atenção</span>
        <span className="flex h-6 min-w-6 items-center justify-center rounded-full bg-surface-1 px-2 text-xs font-extrabold text-viva-700 dark:text-viva-300">
          {alertas.length}
        </span>
      </div>
      {alertas.length === 0 ? (
        <p className="px-5 py-7 text-[13px] text-ink-muted">Nada pendente para os próximos eventos.</p>
      ) : (
        <div className="flex flex-col">
          {visiveis.map(({ i, n, motivo }) => {
            const x = parseDate(i.data!);
            const m = ST[i.st];
            return (
              <button
                key={i.key}
                type="button"
                onClick={() => onOpen(i)}
                className="flex w-full items-center gap-3.5 border-b border-border px-5 py-3.5 text-left last:border-b-0 hover:bg-surface-2/60"
              >
                <div className="flex w-11 shrink-0 flex-col items-center leading-none">
                  <span className="text-xl font-extrabold text-ink-primary">{x.getDate()}</span>
                  <span className="text-[10px] font-bold tracking-display text-ink-muted">{MES3[x.getMonth()]}</span>
                </div>
                <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span className="truncate text-sm font-bold text-ink-primary">{itemTitulo(i)}</span>
                  <span className={`inline-flex items-center gap-1.5 text-xs font-semibold ${m.ink}`}>
                    <Dot c={m.c} className="h-1.5 w-1.5" />
                    {motivo}
                  </span>
                </div>
                <span className="shrink-0 text-xs text-ink-muted">{relativo(n)}</span>
              </button>
            );
          })}
          {alertas.length > 4 && (
            <button type="button" onClick={() => setTodos((v) => !v)} className="px-5 py-3 text-left text-xs font-bold text-ink-secondary hover:bg-surface-2/60">
              {todos ? "Mostrar menos" : `Ver todos (${alertas.length})`}
            </button>
          )}
        </div>
      )}
    </section>
  );
}

// ─── Meses + resumo do mês ───────────────────────────────────────────────────

function ResumoMes({
  meses,
  mes,
  setMes,
  doMes,
}: {
  meses: Array<{ key: string; count: number; valor: number }>;
  mes: string;
  setMes: (k: string) => void;
  doMes: Item[];
}) {
  const max = Math.max(1, ...meses.map((m) => m.valor));
  const sis = doMes.filter((i): i is Extract<Item, { tipo: "contrato" }> => i.tipo === "contrato" && i.st !== "cancelado");
  const valor = sis.reduce((a, i) => a + i.c.valor_total, 0);
  const servicos = sis.reduce((a, i) => a + i.c.valor_servicos, 0);
  const rT = sis.reduce((a, i) => a + i.c.aReceberTotal, 0);
  const rP = sis.reduce((a, i) => a + i.c.aReceberPago, 0);
  const rPct = rT > 0 ? Math.round((rP / rT) * 100) : 0;
  const assinados = sis.filter((i) => ["assinado", "lancado", "parcial"].includes(i.st)).length;
  const pendentes = sis.filter((i) => ["rascunho", "aguardando_aprovacao", "aguardando_assinatura", "erro"].includes(i.st)).length;

  const kpis = [
    { label: "Eventos no mês", value: String(doMes.length), sub: `${assinados} com contrato assinado` },
    { label: "Valor contratado", value: brl(valor), sub: `${brl(servicos)} de BV / serviços` },
    { label: "Recebido do cliente", value: brl(rP), sub: rT > 0 ? `${rPct}% de ${brl(rT)} lançados` : "Nenhum título lançado", bar: rPct },
    { label: "Contratos pendentes", value: String(pendentes), sub: "aprovação, assinatura ou erro" },
  ];

  return (
    <section className={panel}>
      <div className="flex gap-1 overflow-x-auto border-b border-border px-3 pt-3">
        {meses.map((m) => {
          const ativo = m.key === mes;
          return (
            <button
              key={m.key}
              type="button"
              onClick={() => setMes(m.key)}
              className={`flex min-w-[132px] flex-1 flex-col gap-2 border-b-[3px] px-3.5 pb-3.5 pt-3 text-left hover:bg-surface-2/60 ${
                ativo ? "border-primary" : "border-transparent"
              }`}
            >
              <div className="flex items-baseline justify-between gap-2">
                <span className={`whitespace-nowrap text-sm font-bold ${ativo ? "text-ink-primary" : "text-ink-secondary"}`}>{monthLabel(m.key)}</span>
                <span className="whitespace-nowrap text-xs text-ink-muted">{m.count} eventos</span>
              </div>
              <div className="h-1 overflow-hidden rounded-full bg-surface-2">
                <div className={`h-1 rounded-full ${ativo ? "bg-primary" : "bg-ink-muted"}`} style={{ width: `${Math.round((m.valor / max) * 100)}%` }} />
              </div>
              <span className="text-xs font-semibold tabular-nums text-ink-secondary">{brlK(m.valor)}</span>
            </button>
          );
        })}
      </div>
      <div className="grid grid-cols-[repeat(auto-fit,minmax(200px,1fr))]">
        {kpis.map((k) => (
          <div key={k.label} className="flex flex-col gap-1.5 border-r border-border px-6 py-5 last:border-r-0">
            <span className="text-xs font-semibold text-ink-muted">{k.label}</span>
            <span className="text-[26px] font-extrabold tabular-nums tracking-tight text-ink-primary">{k.value}</span>
            {k.bar !== undefined && (
              <div className="h-1.5 overflow-hidden rounded-full bg-surface-2">
                <div className="h-1.5 rounded-full bg-emerald-500" style={{ width: `${k.bar}%` }} />
              </div>
            )}
            <span className="text-xs text-ink-secondary">{k.sub}</span>
          </div>
        ))}
      </div>
    </section>
  );
}

// ─── Etapas (filtro didático) ────────────────────────────────────────────────

function EtapasFiltro({ doMes, filtro, setFiltro, temTrello }: { doMes: Item[]; filtro: Filtro; setFiltro: (f: Filtro) => void; temTrello: boolean }) {
  const count = (k: Filtro) => (k === "todos" ? doMes.length : doMes.filter((i) => i.st === k).length);
  const opcoes: Array<{ key: Filtro; step: string; label: string; c: string }> = [
    { key: "todos", step: "TODOS", label: "Todos", c: "#201e1d" },
    ...ORDEM_FILTRO.filter((k) => SEMPRE_VISIVEIS.has(k) || count(k) > 0).map((k) => ({
      key: k as Filtro,
      step: k === "erro" ? "ATENÇÃO" : k === "cancelado" ? "FORA DO FLUXO" : `ETAPA ${ST[k].step + 1}`,
      label: k === "lancado" ? "Lançado" : ST[k].label,
      c: ST[k].c,
    })),
    ...(temTrello ? [{ key: "trello" as Filtro, step: "HISTÓRICO", label: "Trello", c: ST.trello.c }] : []),
  ];
  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-[13px] font-bold uppercase tracking-label text-ink-secondary">Etapas do contrato</h2>
        <span className="text-xs text-ink-muted">Cada contrato passa por estas etapas, da esquerda para a direita. Clique para filtrar.</span>
      </div>
      <div className="flex flex-wrap gap-2">
        {opcoes.map((o) => {
          const n = count(o.key);
          const ativo = filtro === o.key;
          return (
            <button
              key={o.key}
              type="button"
              onClick={() => setFiltro(ativo && o.key !== "todos" ? "todos" : o.key)}
              className={`flex flex-[1_1_140px] flex-col gap-2.5 rounded-viva-md border px-3.5 py-3 text-left transition-colors hover:border-ink-primary ${
                ativo ? "bg-surface-2" : "border-border bg-surface-1"
              } ${n === 0 && !ativo ? "opacity-50" : ""}`}
              style={ativo ? { borderColor: o.key === "todos" ? undefined : o.c } : undefined}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="text-[11px] font-bold tracking-display text-ink-muted">{o.step}</span>
                {o.key === "todos" ? <span className="h-2 w-2 rounded-full bg-ink-primary" /> : <Dot c={o.c} />}
              </div>
              <div className="flex items-baseline justify-between gap-2">
                <span className="text-[13px] font-bold text-ink-primary">{o.label}</span>
                <span className="text-xl font-extrabold tabular-nums text-ink-primary">{n}</span>
              </div>
            </button>
          );
        })}
      </div>
    </section>
  );
}

// ─── Linha do tempo ──────────────────────────────────────────────────────────

function ItemCard({ i, onOpen }: { i: Item; onOpen: () => void }) {
  const isTrello = i.tipo === "trello";
  const pag = i.tipo === "contrato" ? pagamento(i.c) : null;
  const hora = i.tipo === "contrato" ? i.c.show_time : i.t.event_date_fim ? periodoBR(i.t) : null;
  return (
    <button
      type="button"
      onClick={onOpen}
      className={`flex w-full flex-wrap items-stretch gap-5 rounded-viva-md border px-5 py-[18px] text-left transition-shadow hover:shadow-viva-md ${
        isTrello ? "border-dashed border-border bg-surface-1" : "border-border bg-surface-1 shadow-viva-sm"
      }`}
    >
      <div className="flex min-w-0 flex-[1_1_300px] flex-col gap-1.5">
        <div className="flex flex-wrap items-center gap-2 text-xs text-ink-muted">
          <span className="font-semibold">{itemNp(i)}</span>
          {hora && (
            <>
              <span>·</span>
              <span>{hora}</span>
            </>
          )}
        </div>
        <span className="text-[17px] font-extrabold leading-snug text-ink-primary [text-wrap:pretty]">{itemTitulo(i)}</span>
        <span className="text-[13px] text-ink-secondary">{itemAtracoes(i)}</span>
        <span className="text-[13px] text-ink-muted">{itemLocal(i)}</span>
      </div>
      <div className="flex min-w-[180px] flex-[0_1_220px] flex-col gap-1.5">
        <span className="self-start">
          <StatusPill st={i.st} />
        </span>
        {i.tipo === "contrato" && <EtapasBar st={i.st} />}
      </div>
      <div className="flex min-w-[160px] flex-[0_1_200px] flex-col items-end justify-between gap-2.5 text-right">
        <span className="text-lg font-extrabold tabular-nums text-ink-primary">{i.tipo === "contrato" ? brl(i.c.valor_total) : "—"}</span>
        <div className="flex w-full flex-col items-end gap-1.5">
          {pag?.has && (
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-surface-2">
              <div className={`h-1.5 rounded-full ${pag.bar}`} style={{ width: `${pag.pct}%` }} />
            </div>
          )}
          <span className={`text-xs font-semibold ${pag ? pag.ink : "text-ink-muted"}`}>{pag ? pag.label : "Sem valores (Trello)"}</span>
        </div>
      </div>
    </button>
  );
}

function LinhaDoTempo({ items, hoje, mes, onOpen }: { items: Item[]; hoje: string; mes: string; onOpen: (i: Item) => void }) {
  const dias = useMemo(() => {
    const m = new Map<string, Item[]>();
    for (const i of items) {
      const k = i.data ?? SEM_DATA;
      if (!m.has(k)) m.set(k, []);
      m.get(k)!.push(i);
    }
    return Array.from(m.entries()).sort((a, b) => a[0].localeCompare(b[0]));
  }, [items]);

  if (items.length === 0) {
    return <p className={`${panel} p-12 text-center text-sm text-ink-muted`}>Nenhum evento neste mês com o filtro atual.</p>;
  }

  const hx = parseDate(hoje);
  const marcador = (
    <div key="hoje" className="flex items-center gap-3 py-2.5">
      <div className="flex w-[72px] shrink-0 justify-center">
        <span className="rounded-full bg-primary px-2.5 py-1 text-[11px] font-extrabold tracking-display text-primary-foreground">HOJE</span>
      </div>
      <div className="h-0.5 flex-1 bg-primary" />
      <span className="text-xs font-bold text-viva-700 dark:text-viva-300">
        {WD_LONGO[hx.getDay()]}, {hx.getDate()} de {MESES[hx.getMonth()].toLowerCase()}
      </span>
    </div>
  );

  const out: React.ReactNode[] = [];
  let marcou = monthKey(hoje) !== mes;
  for (const [dia, lista] of dias) {
    if (!marcou && dia >= hoje) {
      out.push(marcador);
      marcou = true;
    }
    const semData = dia === SEM_DATA;
    const x = semData ? null : parseDate(dia);
    const n = semData ? 0 : diffDias(dia, hoje);
    out.push(
      <div key={dia} className={`flex gap-3 ${!semData && n < 0 ? "opacity-60" : ""}`}>
        <div className="flex w-[72px] shrink-0 flex-col items-center gap-0.5 pt-4">
          {x ? (
            <>
              <span className={`text-[30px] font-extrabold leading-none ${n === 0 ? "text-primary" : "text-ink-primary"}`}>{x.getDate()}</span>
              <span className="text-[11px] font-bold tracking-display text-ink-muted">{WD[x.getDay()]}</span>
              <span className="mt-1 text-center text-[11px] text-ink-muted">{relativo(n)}</span>
            </>
          ) : (
            <span className="text-center text-[11px] font-bold tracking-display text-ink-muted">SEM DATA</span>
          )}
          <div className="mt-2.5 w-px flex-1 bg-border" />
        </div>
        <div className="flex min-w-0 flex-1 flex-col gap-2 py-2">
          {lista.map((i) => (
            <ItemCard key={i.key} i={i} onOpen={() => onOpen(i)} />
          ))}
        </div>
      </div>,
    );
  }
  if (!marcou) out.push(marcador);
  return <section className="flex flex-col">{out}</section>;
}

// ─── Calendário ──────────────────────────────────────────────────────────────

function Calendario({ items, hoje, mes, onOpen }: { items: Item[]; hoje: string; mes: string; onOpen: (i: Item) => void }) {
  if (mes === SEM_DATA) {
    return <p className={`${panel} p-12 text-center text-sm text-ink-muted`}>Eventos sem data aparecem só na linha do tempo.</p>;
  }
  const [y, mo] = mes.split("-").map(Number);
  const inicio = new Date(y, mo - 1, 1).getDay();
  const nDias = new Date(y, mo, 0).getDate();
  const total = Math.ceil((inicio + nDias) / 7) * 7;
  const celulas = Array.from({ length: total }, (_, idx) => {
    const d = idx - inicio + 1;
    const dentro = d >= 1 && d <= nDias;
    const ds = dentro ? `${mes}-${String(d).padStart(2, "0")}` : "";
    return { d, dentro, ds, eventos: dentro ? items.filter((i) => i.data?.slice(0, 10) === ds) : [] };
  });
  return (
    <section className={`${panel} overflow-hidden`}>
      <div className="grid grid-cols-7 border-b border-border">
        {WD.map((w) => (
          <div key={w} className="px-3 py-2.5 text-[11px] font-bold tracking-display text-ink-muted">
            {w}
          </div>
        ))}
      </div>
      <div className="grid grid-cols-7">
        {celulas.map((c, idx) => (
          <div
            key={idx}
            className={`flex min-h-[120px] min-w-0 flex-col gap-1 border-b border-r border-border p-2 ${c.dentro ? "bg-surface-1" : "bg-surface-0"}`}
          >
            {c.dentro && (
              <span
                className={`flex h-6 min-w-6 items-center justify-center self-start rounded-full px-1.5 text-xs font-bold ${
                  c.ds === hoje ? "bg-primary text-primary-foreground" : c.ds < hoje ? "text-ink-muted" : "text-ink-primary"
                }`}
              >
                {c.d}
              </span>
            )}
            {c.eventos.map((i) => (
              <button
                key={i.key}
                type="button"
                onClick={() => onOpen(i)}
                title={itemTitulo(i)}
                className="flex w-full min-w-0 items-center rounded-viva-sm border-l-[3px] px-1.5 py-1 text-left text-[11px] font-semibold text-ink-primary hover:brightness-95"
                style={{ borderLeftColor: ST[i.st].c, background: `${ST[i.st].c}1f` }}
              >
                <span className="truncate">{itemTitulo(i)}</span>
              </button>
            ))}
          </div>
        ))}
      </div>
    </section>
  );
}

// ─── Painel lateral: contrato ────────────────────────────────────────────────

function DownloadButtons({ c }: { c: AgendaContract }) {
  const { showToast } = useToast();
  const [loading, setLoading] = useState<null | "art" | "venda">(null);

  async function open(kind: "art" | "venda") {
    setLoading(kind);
    try {
      const res = kind === "art" ? await getContractAttachmentUrl(c.id) : await getSaleContractUrl(c.id);
      if ("error" in res) showToast({ variant: "destructive", title: res.error });
      else window.open(res.url, "_blank", "noopener,noreferrer");
    } finally {
      setLoading(null);
    }
  }

  const btn = "inline-flex h-[38px] items-center gap-1.5 rounded-viva-sm border border-border bg-surface-1 px-3.5 text-[13px] font-bold text-ink-primary hover:bg-surface-2 disabled:opacity-50";
  const primario = c.status === "rascunho" ? { href: `/case/contratos/${c.id}/editar`, label: "Continuar edição" } : { href: `/case/contratos/${c.id}`, label: "Abrir contrato" };

  return (
    <div className="flex flex-wrap gap-2">
      <Link href={primario.href} className="inline-flex h-[38px] items-center rounded-viva-sm bg-primary px-3.5 text-[13px] font-bold text-primary-foreground hover:opacity-90">
        {primario.label}
      </Link>
      {c.status === "aguardando_assinatura" && c.sign_url && (
        <a href={c.sign_url} target="_blank" rel="noopener noreferrer" className={btn}>
          <PenLine className="h-4 w-4" /> Link de assinatura
        </a>
      )}
      {c.has_sale_contract && (
        <button type="button" className={btn} disabled={loading !== null} onClick={() => open("venda")}>
          {loading === "venda" ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileDown className="h-4 w-4" />}
          Contrato de venda
        </button>
      )}
      {c.has_attachment && (
        <button type="button" className={btn} disabled={loading !== null} onClick={() => open("art")}>
          {loading === "art" ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileText className="h-4 w-4" />}
          Contrato do artista
        </button>
      )}
    </div>
  );
}

function Stepper({ st }: { st: CaseContractStatus }) {
  const m = ST[st];
  return (
    <div className="flex">
      {ETAPAS.map((e, idx) => {
        const feito = idx < m.step || (idx === m.step && st === "lancado");
        const atual = idx === m.step && !feito;
        const erro = atual && (st === "erro" || st === "parcial");
        return (
          <div key={e} className="relative flex min-w-0 flex-1 flex-col items-center gap-2">
            {idx > 0 && <div className="absolute left-0 right-1/2 top-[11px] h-0.5 bg-surface-2" style={idx <= m.step ? { background: m.c } : undefined} />}
            {idx < ETAPAS.length - 1 && (
              <div className="absolute left-1/2 right-0 top-[11px] h-0.5 bg-surface-2" style={idx < m.step ? { background: m.c } : undefined} />
            )}
            <div
              className={`relative flex h-6 w-6 items-center justify-center rounded-full border-2 text-[11px] font-extrabold ${
                feito || erro ? "text-white" : atual ? "bg-surface-1" : "border-border bg-surface-1 text-ink-muted"
              }`}
              style={feito || erro ? { background: m.c, borderColor: m.c } : atual ? { borderColor: m.c, color: m.c } : undefined}
            >
              {erro ? "!" : feito ? "✓" : idx + 1}
            </div>
            <span className={`text-center text-[11px] font-semibold ${feito || atual ? "text-ink-primary" : "text-ink-muted"}`}>{e}</span>
          </div>
        );
      })}
    </div>
  );
}

function SheetCabecalho({ np, st, titulo, data, extra }: { np: string; st: CaseContractStatus | "trello"; titulo: string; data: string | null; extra: string }) {
  const x = data ? parseDate(data) : null;
  return (
    <div className="space-y-3.5 border-b border-border bg-surface-1 px-7 py-6 pr-12">
      <div className="flex flex-wrap items-center gap-2.5">
        <span className="text-xs font-semibold text-ink-muted">{np}</span>
        <StatusPill st={st} />
      </div>
      <DialogTitle className="text-[22px] font-extrabold leading-tight text-ink-primary [text-wrap:pretty]">{titulo}</DialogTitle>
      <div className="flex items-center gap-4">
        <div className="flex h-16 w-16 flex-col items-center justify-center rounded-viva-md bg-ink-primary leading-none text-surface-1">
          <span className="text-[26px] font-extrabold">{x ? x.getDate() : "—"}</span>
          <span className="mt-0.5 text-[10px] font-bold tracking-display">{x ? MES3[x.getMonth()] : ""}</span>
        </div>
        <div className="flex flex-col gap-0.5 text-[13px]">
          <span className="font-bold text-ink-primary">{data ? dataLonga(data) : "Sem data de evento"}</span>
          <span className="text-ink-secondary">{extra}</span>
        </div>
      </div>
    </div>
  );
}

function Bloco({ titulo, children, className = "" }: { titulo: string; children: React.ReactNode; className?: string }) {
  return (
    <section className={`flex flex-col gap-1.5 rounded-viva-md bg-surface-1 px-[18px] py-4 ${className}`}>
      <span className={label}>{titulo}</span>
      {children}
    </section>
  );
}

function ContratoSheet({ i, hoje, onClose }: { i: Extract<Item, { tipo: "contrato" }> | null; hoje: string; onClose: () => void }) {
  const { showToast } = useToast();
  const [comprovantes, setComprovantes] = useState<Record<string, Array<{ nome: string; url: string }>> | null>(null);
  const [loadingComp, setLoadingComp] = useState(false);

  useEffect(() => {
    setComprovantes(null);
    setLoadingComp(false);
  }, [i?.key]);

  async function carregarComprovantes(id: string) {
    setLoadingComp(true);
    const res = await getContratoComprovantes(id);
    setLoadingComp(false);
    if ("error" in res) {
      showToast({ variant: "destructive", title: res.error });
      return;
    }
    const map: Record<string, Array<{ nome: string; url: string }>> = {};
    for (const t of res.titulos) map[t.titleId] = t.anexos;
    setComprovantes(map);
    if (res.titulos.length === 0) showToast({ title: "Nenhum comprovante anexado no Omie para este contrato." });
  }

  const c = i?.c;
  const m = i ? ST[i.st] : null;
  const custPct = c && c.valor_total > 0 ? Math.round((c.valor_custodia / c.valor_total) * 100) : 0;
  const barras = c
    ? [
        c.aReceberTotal > 0 && { label: "Recebido do cliente", total: c.aReceberTotal, pago: c.aReceberPago },
        c.aPagarTotal > 0 && { label: "Repassado ao artista (custódia)", total: c.aPagarTotal, pago: c.aPagarPago },
      ].filter((b): b is { label: string; total: number; pago: number } => Boolean(b))
    : [];
  const temLancados = Boolean(c?.titles.some((t) => t.omie_codigo));

  return (
    <Sheet open={i !== null} onOpenChange={(o) => !o && onClose()}>
      <SheetContent className="left-auto right-0 flex w-full max-w-[560px] flex-col overflow-y-auto border-l border-r-0 bg-surface-0 p-0">
        {i && c && m && (
          <>
            <SheetCabecalho
              np={`NP ${c.contract_number}`}
              st={i.st}
              titulo={itemTitulo(i)}
              data={c.event_date}
              extra={[c.show_time ? `Show às ${c.show_time}` : null, c.event_date ? relativo(diffDias(c.event_date, hoje)) : null].filter(Boolean).join(" · ")}
            />
            <div className="flex flex-col gap-4 px-7 pb-8 pt-5">
              {m.step >= 0 && (
                <section className="flex flex-col gap-3.5 rounded-viva-md bg-surface-1 px-5 py-[18px]">
                  <Stepper st={i.st} />
                  <p className={`rounded-viva-sm px-3 py-2.5 text-[13px] font-semibold ${m.pill}`}>{m.next}</p>
                </section>
              )}

              <div className="grid grid-cols-[repeat(auto-fit,minmax(200px,1fr))] gap-3">
                <Bloco titulo="Atrações">
                  {(c.atracoes.length > 0 ? c.atracoes : [c.band_name]).map((a) => (
                    <span key={a} className="text-sm font-semibold text-ink-primary">
                      {a}
                    </span>
                  ))}
                </Bloco>
                <Bloco titulo="Local">
                  <span className="text-sm font-semibold text-ink-primary">{c.local_name || "Não informado"}</span>
                  {c.local_city && <span className="text-[13px] text-ink-secondary">{c.local_city}</span>}
                  {c.local_address && <span className="text-xs text-ink-muted">{c.local_address}</span>}
                </Bloco>
              </div>

              <Bloco titulo="Contratante">
                <span className="text-sm font-bold text-ink-primary">{c.client_name}</span>
                <div className="space-y-0.5 text-[13px] text-ink-secondary">
                  {c.client_doc && (
                    <div>
                      {c.client_pf ? "CPF" : "CNPJ"} {c.client_doc}
                    </div>
                  )}
                  {c.client_resp_legal && <div>Resp. legal: {c.client_resp_legal}</div>}
                  {(c.client_email || c.client_phone) && <div className="break-all">{[c.client_email, c.client_phone].filter(Boolean).join(" · ")}</div>}
                  {(c.client_endereco || c.client_cidade_estado) && (
                    <div className="text-ink-muted">{[c.client_endereco, c.client_cidade_estado].filter(Boolean).join(", ")}</div>
                  )}
                </div>
              </Bloco>

              <section className="flex flex-col gap-4 rounded-viva-md bg-surface-1 px-5 py-[18px]">
                <div className="flex items-baseline justify-between gap-3">
                  <span className={label}>Valores</span>
                  <span className="text-2xl font-extrabold tabular-nums text-ink-primary">{brl(c.valor_total)}</span>
                </div>
                <div className="flex h-2.5 gap-0.5 overflow-hidden rounded-full">
                  <div className="bg-ink-primary" style={{ width: `${custPct}%` }} />
                  <div className="flex-1 bg-primary" />
                </div>
                <div className="flex justify-between gap-3 text-[13px]">
                  <div className="flex flex-col gap-0.5">
                    <span className="inline-flex items-center gap-1.5 text-ink-secondary">
                      <span className="h-2 w-2 rounded-sm bg-ink-primary" /> Custódia (repasse ao artista)
                    </span>
                    <span className="font-bold tabular-nums text-ink-primary">{brl(c.valor_custodia)}</span>
                  </div>
                  <div className="flex flex-col items-end gap-0.5 text-right">
                    <span className="inline-flex items-center gap-1.5 text-ink-secondary">
                      <span className="h-2 w-2 rounded-sm bg-primary" /> BV / Serviços
                    </span>
                    <span className="font-bold tabular-nums text-ink-primary">{brl(c.valor_servicos)}</span>
                  </div>
                </div>
              </section>

              <section className="flex flex-col gap-3.5 rounded-viva-md bg-surface-1 px-5 py-[18px]">
                <div className="flex items-center justify-between gap-2">
                  <span className={label}>Pagamentos no Omie</span>
                  {temLancados && comprovantes === null && (
                    <button
                      type="button"
                      onClick={() => carregarComprovantes(c.id)}
                      disabled={loadingComp}
                      className="inline-flex items-center gap-1 rounded-viva-sm border border-border px-2 py-1 text-[11px] font-bold text-ink-secondary hover:bg-surface-2 disabled:opacity-50"
                    >
                      {loadingComp ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Receipt className="h-3.5 w-3.5" />}
                      {loadingComp ? "Buscando…" : "Comprovantes"}
                    </button>
                  )}
                </div>
                {c.titles.length === 0 ? (
                  <p className="text-[13px] text-ink-secondary">Os títulos são criados no Omie depois que o contrato é assinado.</p>
                ) : (
                  <>
                    {c.temErro && <p className={`text-[13px] font-semibold ${ST.erro.ink}`}>Um ou mais títulos falharam ao lançar no Omie.</p>}
                    {barras.map((b) => {
                      const pct = b.total > 0 ? Math.min(100, (b.pago / b.total) * 100) : 0;
                      return (
                        <div key={b.label} className="flex flex-col gap-1.5">
                          <div className="flex justify-between gap-3 text-[13px]">
                            <span className="font-semibold text-ink-primary">{b.label}</span>
                            <span className="tabular-nums">
                              <strong className="text-ink-primary">{brl(b.pago)}</strong> <span className="text-ink-muted">de {brl(b.total)}</span>
                            </span>
                          </div>
                          <div className="h-2 overflow-hidden rounded-full bg-surface-2">
                            <div className={`h-2 rounded-full ${b.pago >= b.total - 0.005 ? "bg-emerald-500" : "bg-blue-500"}`} style={{ width: `${pct}%` }} />
                          </div>
                        </div>
                      );
                    })}
                    <ul className="flex flex-col divide-y divide-border border-t border-border pt-1">
                      {c.titles.map((t) => {
                        const comps = comprovantes?.[t.id] ?? [];
                        const cor = t.pago ? ST.lancado.c : t.status === "erro" ? ST.erro.c : t.status === "lancado" ? ST.aguardando_assinatura.c : "#9b9797";
                        return (
                          <li key={t.id} className="py-2 text-xs">
                            <div className="flex items-center justify-between gap-2">
                              <span className="flex min-w-0 items-center gap-2 text-ink-secondary" title={t.descricao}>
                                <Dot c={cor} />
                                <span className="truncate">
                                  {t.descricao}
                                  {t.vencimento ? <span className="text-ink-muted"> · vence {dateBR(t.vencimento)}</span> : null}
                                  {t.omie_codigo ? <span className="text-ink-muted"> · #{t.omie_codigo}</span> : null}
                                </span>
                              </span>
                              <span className="shrink-0 font-semibold tabular-nums text-ink-primary">{brl(t.valor)}</span>
                            </div>
                            {comps.length > 0 && (
                              <div className="mt-1.5 flex flex-wrap gap-1.5 pl-4">
                                {comps.map((a, j) => (
                                  <a
                                    key={j}
                                    href={a.url}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    title={a.nome}
                                    className="inline-flex items-center gap-1 rounded-viva-sm border border-border px-1.5 py-0.5 text-[11px] text-ink-secondary hover:bg-surface-2"
                                  >
                                    <Paperclip className="h-3 w-3" />
                                    <span className="max-w-[160px] truncate">{a.nome}</span>
                                  </a>
                                ))}
                              </div>
                            )}
                          </li>
                        );
                      })}
                    </ul>
                    {comprovantes !== null && (
                      <p className="text-[11px] text-ink-muted">
                        {Object.keys(comprovantes).length === 0 ? "Nenhum comprovante anexado no Omie." : "Comprovantes carregados do Omie (links válidos por alguns minutos)."}
                      </p>
                    )}
                  </>
                )}
              </section>

              <DownloadButtons c={c} />
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}

// ─── Painel lateral: Trello ──────────────────────────────────────────────────

function HistoricoTrelloSection({ historico, desde }: { historico: AgendaImportado["historico"]; desde: string | null }) {
  const [soComentarios, setSoComentarios] = useState(false);
  const comentarios = historico.filter((h) => h.tipo === "comentario").length;
  const visiveis = soComentarios ? historico.filter((h) => h.tipo === "comentario") : historico;
  if (historico.length === 0 && !desde) return null;

  const chip = (ativo: boolean) =>
    `rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${ativo ? "bg-ink-primary text-surface-1" : "border border-border text-ink-secondary hover:bg-surface-2"}`;

  return (
    <section className="flex flex-col gap-2 rounded-viva-md bg-surface-1 px-5 py-[18px]">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className={label}>
          Histórico · {comentarios} comentário{comentarios === 1 ? "" : "s"}
        </span>
        {comentarios > 0 && comentarios < historico.length && (
          <div className="flex gap-1.5">
            <button type="button" className={chip(!soComentarios)} onClick={() => setSoComentarios(false)}>
              Tudo
            </button>
            <button type="button" className={chip(soComentarios)} onClick={() => setSoComentarios(true)}>
              Só comentários
            </button>
          </div>
        )}
      </div>
      {desde && (
        <p className="rounded-viva-sm bg-amber-500/10 px-3 py-2 text-[11px] text-amber-800 dark:text-amber-300">
          O que aconteceu neste cartão antes de {dateBR(desde)} não veio no arquivo exportado — está só no Trello.
        </p>
      )}
      <ol className="space-y-1.5">
        {visiveis.map((h, idx) =>
          h.tipo === "comentario" ? (
            <li key={idx} className="rounded-viva-sm border border-border bg-surface-0 p-3">
              <div className="mb-1 text-[11px] text-ink-muted">
                <span className="font-semibold text-ink-secondary">{h.autor ?? "—"}</span> comentou · {dateBR(h.data)}
              </div>
              <p className="whitespace-pre-line break-words text-xs leading-relaxed text-ink-secondary">{h.texto}</p>
            </li>
          ) : (
            <li key={idx} className="flex gap-2 px-1 text-[11px] leading-snug text-ink-muted">
              <span className="shrink-0 tabular-nums">{dateBR(h.data)}</span>
              <span className="min-w-0 break-words">
                <span className="font-semibold text-ink-secondary">{h.autor ?? "—"}</span> {h.texto}
              </span>
            </li>
          ),
        )}
      </ol>
    </section>
  );
}

function TrelloSheet({ i, hoje, onClose }: { i: Extract<Item, { tipo: "trello" }> | null; hoje: string; onClose: () => void }) {
  const t = i?.t;
  return (
    <Sheet open={i !== null} onOpenChange={(o) => !o && onClose()}>
      <SheetContent className="left-auto right-0 flex w-full max-w-[560px] flex-col overflow-y-auto border-l border-r-0 bg-surface-0 p-0">
        {i && t && (
          <>
            <SheetCabecalho
              np={itemNp(i)}
              st="trello"
              titulo={tituloImportado(t)}
              data={t.event_date}
              extra={[t.event_date_fim ? periodoBR(t) : null, relativo(diffDias(t.event_date, hoje))].filter(Boolean).join(" · ")}
            />
            <div className="flex flex-col gap-4 px-7 pb-8 pt-5">
              <div className="grid grid-cols-[repeat(auto-fit,minmax(200px,1fr))] gap-3">
                <Bloco titulo="Atrações">
                  {t.atracoes.length > 0 ? (
                    t.atracoes.map((a) => (
                      <span key={a} className="text-sm font-semibold text-ink-primary">
                        {a}
                      </span>
                    ))
                  ) : (
                    <span className="text-sm text-ink-muted">Não informada no cartão</span>
                  )}
                </Bloco>
                <Bloco titulo="Local">
                  <span className="text-sm font-semibold text-ink-primary">{t.local_name || "Não informado"}</span>
                  {t.local_city && <span className="text-[13px] text-ink-secondary">{t.local_city}</span>}
                  {(t.unidade || t.intermediacao) && (
                    <span className="text-xs text-ink-muted">{[t.unidade, t.intermediacao ? "contrato de intermédio" : null].filter(Boolean).join(" · ")}</span>
                  )}
                </Bloco>
              </div>

              {t.observacao && (
                <Bloco titulo="Descrição do cartão">
                  <p className="whitespace-pre-line text-[13px] text-ink-secondary">{t.observacao}</p>
                </Bloco>
              )}

              {t.anexos.length > 0 && (
                <Bloco titulo={`Anexos no Trello (${t.anexos.length})`}>
                  <ul className="space-y-1">
                    {t.anexos.map((a, idx) => (
                      <li key={idx}>
                        <a href={a.url} target="_blank" rel="noopener noreferrer" title={a.nome} className="flex min-w-0 items-center gap-1.5 text-[13px] text-ink-secondary hover:text-ink-primary hover:underline">
                          <Paperclip className="h-3.5 w-3.5 shrink-0 text-ink-muted" />
                          <span className="truncate">{a.nome}</span>
                        </a>
                      </li>
                    ))}
                  </ul>
                  <p className="text-[11px] text-ink-muted">Os arquivos continuam no Trello — é preciso estar logado lá para abrir.</p>
                </Bloco>
              )}

              <HistoricoTrelloSection historico={t.historico} desde={t.historico_desde} />

              <p className="rounded-viva-md border border-dashed border-border px-4 py-3.5 text-[13px] text-ink-secondary">
                Evento do controle antigo (Trello). Não tem valores nem pagamentos no sistema.
              </p>

              {t.origem_url && (
                <a
                  href={t.origem_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex h-[38px] items-center gap-1.5 self-start rounded-viva-sm border border-border bg-surface-1 px-3.5 text-[13px] font-bold text-ink-primary hover:bg-surface-2"
                >
                  <ExternalLink className="h-4 w-4" /> Abrir no Trello
                </a>
              )}
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}

// ─── Página ──────────────────────────────────────────────────────────────────

export function AgendaView({ contracts, importados = [], hoje }: { contracts: AgendaContract[]; importados?: AgendaImportado[]; hoje: string }) {
  const todos = useMemo<Item[]>(() => {
    const a: Item[] = contracts.map((c) => ({ tipo: "contrato", key: `c-${c.id}`, data: c.event_date, st: statusDe(c), c }));
    const b: Item[] = importados.map((t) => ({ tipo: "trello", key: `t-${t.id}`, data: t.event_date, st: "trello", t }));
    return [...a, ...b].sort(
      (x, y) =>
        (x.data ?? "9999").localeCompare(y.data ?? "9999") ||
        ((x.tipo === "contrato" ? x.c.show_time : null) ?? "").localeCompare((y.tipo === "contrato" ? y.c.show_time : null) ?? ""),
    );
  }, [contracts, importados]);

  const meses = useMemo(() => {
    const m = new Map<string, { key: string; count: number; valor: number }>();
    for (const i of todos) {
      const k = monthKey(i.data);
      if (!m.has(k)) m.set(k, { key: k, count: 0, valor: 0 });
      const e = m.get(k)!;
      e.count++;
      if (i.tipo === "contrato" && i.st !== "cancelado") e.valor += i.c.valor_total;
    }
    return Array.from(m.values()).sort((a, b) => a.key.localeCompare(b.key));
  }, [todos]);

  const [mes, setMes] = useState(() => {
    const atual = monthKey(hoje);
    if (meses.some((m) => m.key === atual)) return atual;
    return (meses.find((m) => m.key > atual && m.key !== SEM_DATA) ?? meses[meses.length - 1])?.key ?? atual;
  });
  const [filtro, setFiltro] = useState<Filtro>("todos");
  const [q, setQ] = useState("");
  const [view, setView] = useState<"tl" | "cal">("tl");
  const [aberto, setAberto] = useState<Item | null>(null);

  const doMes = useMemo(() => todos.filter((i) => monthKey(i.data) === mes), [todos, mes]);
  const busca = q.trim().toLowerCase();
  const visiveis = useMemo(
    () => doMes.filter((i) => (filtro === "todos" || i.st === filtro) && (!busca || itemBusca(i).includes(busca))),
    [doMes, filtro, busca],
  );

  const proximo = useMemo(
    () => todos.find((i): i is Extract<Item, { tipo: "contrato" }> => i.tipo === "contrato" && !!i.data && i.data >= hoje && i.st !== "cancelado") ?? null,
    [todos, hoje],
  );
  const alertas = useMemo(() => alertasDe(todos, hoje), [todos, hoje]);

  const trocarMes = (k: string) => {
    setMes(k);
    setFiltro("todos");
  };

  return (
    <div className="mx-auto flex max-w-[1440px] flex-col gap-6">
      <Cabecalho q={q} setQ={setQ} view={view} setView={setView} />

      <div className="flex flex-wrap gap-4">
        {proximo && <ProximoEvento i={proximo} hoje={hoje} onOpen={() => setAberto(proximo)} />}
        <Atencao alertas={alertas} onOpen={setAberto} />
      </div>

      <ResumoMes meses={meses} mes={mes} setMes={trocarMes} doMes={doMes} />

      <EtapasFiltro doMes={doMes} filtro={filtro} setFiltro={setFiltro} temTrello={importados.length > 0} />

      {view === "tl" ? (
        <LinhaDoTempo items={visiveis} hoje={hoje} mes={mes} onOpen={setAberto} />
      ) : (
        <Calendario items={visiveis} hoje={hoje} mes={mes} onOpen={setAberto} />
      )}

      <ContratoSheet i={aberto?.tipo === "contrato" ? aberto : null} hoje={hoje} onClose={() => setAberto(null)} />
      <TrelloSheet i={aberto?.tipo === "trello" ? aberto : null} hoje={hoje} onClose={() => setAberto(null)} />
    </div>
  );
}
