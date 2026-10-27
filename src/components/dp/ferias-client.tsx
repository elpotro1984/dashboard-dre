"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ChevronLeft, ChevronRight, Loader2, Lock, Plus, Trash2 } from "lucide-react";

import { FilterTable, type FilterColumn } from "@/components/data-table/filter-table";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useToast } from "@/components/ui/toaster";
import { formatDayBR } from "@/lib/ctrl/datetime";
import { excluirFerias, salvarFerias } from "@/lib/dp/actions-ferias";
import { diasDeFerias, erroDasFerias, valorCalculadoFerias } from "@/lib/dp/ferias";
import type { DpFeriasDoMes, DpFeriasLinha } from "@/lib/dp/ferias-queries";
import { rotuloCompetencia, somarMeses } from "@/lib/dp/folha/parametros";

import { inputCls, NumCampoOpcional } from "./folha/campos";
import { brl } from "./folha/formato";

const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

type Edicao = { linha: DpFeriasLinha | null } | null;

/**
 * Pagamento de férias, mês a mês: as férias que começam no mês. Clicar no nome
 * abre a férias para editar ou excluir; "Lançar férias" abre uma nova.
 */
export function DpFeriasClient({ companyId, dados }: { companyId: string; dados: DpFeriasDoMes }) {
  const { competencia, linhas } = dados;
  const [edicao, setEdicao] = useState<Edicao>(null);
  const hrefMes = (n: number) => `?competencia=${somarMeses(competencia, n)}`;

  const colunas = useMemo<FilterColumn<DpFeriasLinha>[]>(() => {
    const lotacao = (key: string, label: string, valor: (l: DpFeriasLinha) => string | null, sem: string): FilterColumn<DpFeriasLinha> => ({
      key,
      label,
      plain: (l) => valor(l) ?? sem,
      sortVal: (l) => (valor(l) ? norm(valor(l)!) : "￿"),
      cell: (l) => valor(l) ?? <span className="text-ink-muted">—</span>,
    });
    const data = (key: string, label: string, valor: (l: DpFeriasLinha) => string): FilterColumn<DpFeriasLinha> => ({
      key,
      label,
      plain: (l) => formatDayBR(valor(l)),
      sortVal: valor,
      className: "whitespace-nowrap",
    });
    return [
      {
        key: "nome",
        label: "Colaborador",
        plain: (l) => l.nome,
        sortVal: (l) => norm(l.nome),
        className: "whitespace-nowrap",
        cell: (l) => (
          <button type="button" onClick={() => setEdicao({ linha: l })} className="inline-flex items-center gap-1 text-left text-ink-primary hover:underline">
            {l.travada && <Lock className="h-3.5 w-3.5 text-ink-muted" aria-label="Folha fechada" />}
            {l.nome}
          </button>
        ),
      },
      lotacao("setor", "Setor", (l) => l.setor, "Sem setor"),
      lotacao("centro", "Centro de custo", (l) => l.centroCusto, "Sem centro de custo"),
      data("inicio", "Início", (l) => l.inicio),
      data("fim", "Término", (l) => l.fim),
      { key: "dias", label: "Dias", kind: "number", align: "right", plain: (l) => String(l.dias), sortVal: (l) => l.dias, numeric: (l) => l.dias },
      {
        key: "valor",
        label: "Valor",
        kind: "number",
        align: "right",
        plain: (l) => brl(l.valor),
        sortVal: (l) => l.valor,
        numeric: (l) => l.valor,
        className: "whitespace-nowrap",
        cell: (l) => (
          <>
            {brl(l.valor)}
            {l.valorManual !== null ? (
              <span className="block text-[11px] text-ink-muted">
                <span className="rounded bg-sky-500/10 px-1 text-sky-800 dark:text-sky-300">manual</span> calculado {brl(l.calculado.total)}
              </span>
            ) : null}
          </>
        ),
      },
    ];
  }, []);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Link href={hrefMes(-1)} className="rounded-md border border-input p-1.5 hover:bg-muted" aria-label="Mês anterior">
          <ChevronLeft className="h-4 w-4" />
        </Link>
        <span className="min-w-24 text-center text-lg font-semibold text-ink-primary">{rotuloCompetencia(competencia)}</span>
        <Link href={hrefMes(1)} className="rounded-md border border-input p-1.5 hover:bg-muted" aria-label="Próximo mês">
          <ChevronRight className="h-4 w-4" />
        </Link>
        <button
          type="button"
          onClick={() => setEdicao({ linha: null })}
          className="ml-auto inline-flex items-center gap-1 rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90"
        >
          <Plus className="h-4 w-4" /> Lançar férias
        </button>
      </div>
      <p className="text-xs text-ink-muted">
        Cada férias aparece no mês do início, com o valor inteiro (é quando o recibo é pago, até 2 dias antes). O valor é calculado como o
        recibo — salário ÷ 30 × dias + 1/3 (estágio: sem o terço) — e pode ser trocado à mão. A Folha do mês tira daqui os dias de férias
        de cada mês, inclusive quando as férias atravessam a virada.
      </p>

      {linhas.length === 0 ? (
        <p className="text-sm text-ink-muted">Nenhuma férias começando em {rotuloCompetencia(competencia)}.</p>
      ) : (
        <FilterTable
          rows={linhas}
          columns={colunas}
          rowKey={(l) => l.id}
          emptyMessage="Ninguém corresponde aos filtros."
          footer={(vis) => (
            <>
              <td colSpan={5} className="px-3 py-2 font-medium text-ink-primary">
                Total ({vis.length})
              </td>
              <td className="px-3 py-2 text-right font-medium tabular-nums text-ink-primary">{vis.reduce((s, l) => s + l.dias, 0)}</td>
              <td className="whitespace-nowrap px-3 py-2 text-right font-medium tabular-nums text-ink-primary">{brl(vis.reduce((s, l) => s + l.valor, 0))}</td>
            </>
          )}
        />
      )}

      {edicao && (
        <FeriasDialog companyId={companyId} dados={dados} linha={edicao.linha} onClose={() => setEdicao(null)} />
      )}
    </div>
  );
}

function FeriasDialog({
  companyId,
  dados,
  linha,
  onClose,
}: {
  companyId: string;
  dados: DpFeriasDoMes;
  linha: DpFeriasLinha | null;
  onClose: () => void;
}) {
  const [solidesId, setSolidesId] = useState<number | null>(linha?.solidesId ?? null);
  const [inicio, setInicio] = useState(linha?.inicio ?? "");
  const [fim, setFim] = useState(linha?.fim ?? "");
  const [valorManual, setValorManual] = useState<number | null>(linha?.valorManual ?? null);
  const [observacao, setObservacao] = useState(linha?.observacao ?? "");
  const [busca, setBusca] = useState("");
  const [confirmarExclusao, setConfirmarExclusao] = useState(false);
  const [pending, start] = useTransition();
  const router = useRouter();
  const { showToast } = useToast();

  const travada = linha?.travada ?? null;
  const pessoa = dados.pessoas.find((p) => p.solidesId === solidesId) ?? null;
  const dias = diasDeFerias(inicio, fim);
  const calculado = pessoa ? valorCalculadoFerias(pessoa.salario, pessoa.contrato, dias) : null;
  const erro =
    !pessoa ? null : erroDasFerias({ inicio, fim }, pessoa.periodos.filter((p) => p.id !== linha?.id));
  const opcoes = useMemo(() => {
    const q = norm(busca.trim());
    return dados.pessoas.filter((p) => !q || norm(p.nome).includes(q) || p.solidesId === solidesId);
  }, [dados.pessoas, busca, solidesId]);

  const salvar = () =>
    start(async () => {
      if (!pessoa) return;
      const r = await salvarFerias({
        companyId,
        id: linha?.id ?? null,
        solidesId: pessoa.solidesId,
        inicio,
        fim,
        valorManual,
        observacao: observacao.trim() || null,
      });
      if (!r.ok) {
        showToast({ title: "Não salvo", description: r.error, variant: "destructive" });
        return;
      }
      const mes = inicio.slice(0, 7);
      showToast({
        title: linha ? "Férias alteradas" : "Férias lançadas",
        description: mes !== dados.competencia ? `Começam em ${rotuloCompetencia(mes)} — aparecem naquele mês.` : undefined,
        variant: "success",
      });
      onClose();
      router.refresh();
    });

  const excluir = () =>
    start(async () => {
      if (!linha) return;
      const r = await excluirFerias({ companyId, id: linha.id });
      if (!r.ok) {
        showToast({ title: "Não excluído", description: r.error, variant: "destructive" });
        return;
      }
      showToast({ title: "Férias excluídas", variant: "success" });
      onClose();
      router.refresh();
    });

  return (
    <Dialog open onOpenChange={(v) => !v && !pending && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{linha ? `Férias de ${linha.nome}` : "Lançar férias"}</DialogTitle>
          <DialogDescription>
            {travada ?? "Os dias saem das datas; o valor é calculado e pode ser trocado à mão."}
          </DialogDescription>
        </DialogHeader>

        <fieldset disabled={Boolean(travada) || pending} className="space-y-3">
          <label className="block space-y-1 text-xs">
            <span className="text-ink-muted">Colaborador</span>
            {linha ? (
              <p className="text-sm font-medium text-ink-primary">{linha.nome}</p>
            ) : (
              <>
                <input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar colaborador" className={inputCls} />
                <select
                  value={solidesId ?? ""}
                  onChange={(e) => setSolidesId(e.target.value ? Number(e.target.value) : null)}
                  className={inputCls}
                  size={Math.min(6, Math.max(2, opcoes.length))}
                  aria-label="Colaborador"
                >
                  {opcoes.map((p) => (
                    <option key={p.solidesId} value={p.solidesId}>
                      {p.nome}
                    </option>
                  ))}
                </select>
              </>
            )}
          </label>

          <div className="grid grid-cols-3 gap-3">
            <label className="block space-y-1 text-xs">
              <span className="text-ink-muted">Início</span>
              <input type="date" value={inicio} onChange={(e) => setInicio(e.target.value)} className={inputCls} />
            </label>
            <label className="block space-y-1 text-xs">
              <span className="text-ink-muted">Término</span>
              <input type="date" value={fim} min={inicio || undefined} onChange={(e) => setFim(e.target.value)} className={inputCls} />
            </label>
            <div className="space-y-1 text-xs">
              <span className="text-ink-muted">Dias de férias</span>
              <p className="py-1 text-sm font-semibold tabular-nums text-ink-primary">{dias || "—"}</p>
            </div>
          </div>

          <div className="space-y-1 text-xs">
            <span className="text-ink-muted">Valor</span>
            {calculado && dias > 0 ? (
              <p className="text-ink-secondary">
                Calculado: <strong className="tabular-nums">{brl(calculado.total)}</strong>{" "}
                <span className="text-ink-muted">
                  (férias {brl(calculado.ferias)}
                  {calculado.terco ? ` + 1/3 ${brl(calculado.terco)}` : " — estágio, sem o terço"})
                </span>
                {pessoa?.salario === null && <span className="text-amber-700 dark:text-amber-400"> · sem salário na Sólides</span>}
              </p>
            ) : (
              <p className="text-ink-muted">Escolha o colaborador e as datas para ver o valor calculado.</p>
            )}
            <div className="max-w-[12rem]">
              <NumCampoOpcional valor={valorManual} auto={calculado?.total ?? 0} onChange={setValorManual} ariaLabel="Valor manual" />
            </div>
            <p className="text-[11px] text-ink-muted">Em branco = vale o calculado. Digite para usar outro valor (ex.: o da contabilidade).</p>
          </div>

          <label className="block space-y-1 text-xs">
            <span className="text-ink-muted">Observação</span>
            <input value={observacao} onChange={(e) => setObservacao(e.target.value)} maxLength={300} className={inputCls} />
          </label>

          {erro && <p className="text-sm text-red-700 dark:text-red-400">{erro}</p>}
        </fieldset>

        <DialogFooter className="gap-2 sm:justify-between sm:gap-0">
          <div>
            {linha && !travada && (
              confirmarExclusao ? (
                <button type="button" disabled={pending} onClick={excluir} className="inline-flex items-center gap-1 rounded-md bg-red-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-red-700">
                  <Trash2 className="h-4 w-4" /> Confirmar exclusão
                </button>
              ) : (
                <button type="button" disabled={pending} onClick={() => setConfirmarExclusao(true)} className="inline-flex items-center gap-1 rounded-md border border-input px-3 py-1.5 text-sm text-red-700 hover:bg-muted dark:text-red-400">
                  <Trash2 className="h-4 w-4" /> Excluir
                </button>
              )
            )}
          </div>
          <div className="flex gap-2">
            <button type="button" disabled={pending} onClick={onClose} className="rounded-md border border-input px-3 py-1.5 text-sm hover:bg-muted">
              {travada ? "Fechar" : "Cancelar"}
            </button>
            {!travada && (
              <button
                type="button"
                disabled={pending || !pessoa || dias === 0 || Boolean(erro)}
                onClick={salvar}
                className="inline-flex items-center gap-1 rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
              >
                {pending && <Loader2 className="h-4 w-4 animate-spin" />}
                {linha ? "Salvar" : "Lançar férias"}
              </button>
            )}
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
