"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Check, ChevronLeft, ChevronRight, Loader2, Lock, Plus, Trash2 } from "lucide-react";

import { FilterTable, type FilterColumn } from "@/components/data-table/filter-table";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useToast } from "@/components/ui/toaster";
import { formatDayBR } from "@/lib/ctrl/datetime";
import { excluirFerias, salvarFerias } from "@/lib/dp/actions-ferias";
import { diasDeFerias, erroDasFerias, reciboDeFerias, type DpReciboFerias } from "@/lib/dp/ferias";
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
    const dinheiro = (key: string, label: string, valor: (l: DpFeriasLinha) => number): FilterColumn<DpFeriasLinha> => ({
      key,
      label,
      kind: "number",
      align: "right",
      plain: (l) => brl(valor(l)),
      sortVal: valor,
      numeric: valor,
      cell: (l) => brl(valor(l)),
      className: "whitespace-nowrap",
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
      dinheiro("bruto", "Férias + 1/3", (l) => l.recibo.bruto),
      dinheiro("inss", "INSS", (l) => l.recibo.inss),
      dinheiro("irrf", "IRRF", (l) => l.recibo.irrf),
      {
        key: "valor",
        label: "Valor líquido",
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
                <span className="rounded bg-sky-500/10 px-1 text-sky-800 dark:text-sky-300">manual</span> calculado {brl(l.recibo.liquido)}
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
        Cada férias aparece no mês do início, com o valor inteiro (é quando o recibo é pago, até 2 dias antes). O valor é o líquido do
        recibo, com as regras do salário: salário ÷ 30 × dias + 1/3 (estágio: sem o terço), menos INSS e IRRF pelas tabelas dos
        Parâmetros da folha ({dados.vigencia ? `vigência de ${rotuloCompetencia(dados.vigencia)}` : "padrão do sistema"}), calculados à
        parte do salário do mês, como no recibo. Pode ser trocado à mão. A Folha do mês tira daqui os dias de férias de cada mês,
        inclusive quando as férias atravessam a virada.
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
              {[(l: DpFeriasLinha) => l.recibo.bruto, (l: DpFeriasLinha) => l.recibo.inss, (l: DpFeriasLinha) => l.recibo.irrf, (l: DpFeriasLinha) => l.valor].map((v, i) => (
                <td key={i} className="whitespace-nowrap px-3 py-2 text-right font-medium tabular-nums text-ink-primary">
                  {brl(vis.reduce((s, l) => s + v(l), 0))}
                </td>
              ))}
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
  const recibo = pessoa
    ? reciboDeFerias({ salario: pessoa.salario, contrato: pessoa.contrato, dias, semInss: pessoa.semInss, dependentesIr: pessoa.dependentesIr }, dados.parametros)
    : null;
  // Só depois das duas datas: antes disso o botão já fica desligado, e a frase em
  // vermelho parecia dizer que a escolha do colaborador tinha falhado.
  const erro = pessoa && inicio && fim ? erroDasFerias({ inicio, fim }, pessoa.periodos.filter((p) => p.id !== linha?.id)) : null;
  const opcoes = useMemo(() => {
    const q = norm(busca.trim());
    return dados.pessoas.filter((p) => !q || norm(p.nome).includes(q));
  }, [dados.pessoas, busca]);

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
          <div className="space-y-1 text-xs">
            <span className="text-ink-muted">Colaborador</span>
            {linha ? (
              <p className="text-sm font-medium text-ink-primary">{linha.nome}</p>
            ) : pessoa ? (
              // Escolhido: a lista fecha e o nome fica à vista — sem dúvida de que pegou.
              <div className="flex items-center justify-between gap-2 rounded-md border border-primary/40 bg-primary/5 px-3 py-2">
                <span className="flex items-center gap-1.5 text-sm font-medium text-ink-primary">
                  <Check className="h-4 w-4 text-emerald-600" /> {pessoa.nome}
                </span>
                <button type="button" onClick={() => setSolidesId(null)} className="text-xs text-ink-muted underline hover:text-ink-primary">
                  Trocar
                </button>
              </div>
            ) : (
              <div className="space-y-1">
                <input autoFocus value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar pelo nome" className={inputCls} aria-label="Buscar colaborador" />
                <div className="max-h-48 overflow-y-auto rounded-md border border-input">
                  {opcoes.length === 0 ? (
                    <p className="px-3 py-2 text-sm text-ink-muted">Nenhum colaborador com esse nome.</p>
                  ) : (
                    opcoes.map((p) => (
                      <button
                        key={p.solidesId}
                        type="button"
                        onClick={() => {
                          setSolidesId(p.solidesId);
                          setBusca("");
                        }}
                        className="block w-full px-3 py-1.5 text-left text-sm hover:bg-muted"
                      >
                        {p.nome}
                      </button>
                    ))
                  )}
                </div>
                <p className="text-[11px] text-ink-muted">Clique no nome para escolher.</p>
              </div>
            )}
          </div>

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

          <div className="space-y-1.5 text-xs">
            <span className="text-ink-muted">Valor</span>
            {recibo && dias > 0 ? (
              <ReciboTabela recibo={recibo} dias={dias} semSalario={pessoa?.salario === null} />
            ) : (
              <p className="text-ink-muted">
                {pessoa ? "Informe o início e o término para ver o valor calculado." : "Escolha o colaborador para ver o valor calculado."}
              </p>
            )}
            <label className="block max-w-[14rem] space-y-1">
              <span className="text-ink-muted">Valor líquido manual</span>
              <NumCampoOpcional valor={valorManual} auto={recibo?.liquido ?? 0} onChange={setValorManual} ariaLabel="Valor líquido manual" />
            </label>
            <p className="text-[11px] text-ink-muted">Em branco = vale o líquido calculado. Digite para usar outro valor (ex.: o da contabilidade).</p>
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

/** A conta do recibo: férias, 1/3, bruto, INSS, IRRF e o líquido — com a memória do INSS e do IRRF. */
function ReciboTabela({ recibo, dias, semSalario }: { recibo: DpReciboFerias; dias: number; semSalario: boolean }) {
  const linha = (rotulo: string, valor: number, opts: { sinal?: string; forte?: boolean; titulo?: string } = {}) => (
    <tr className={opts.forte ? "border-t border-border font-semibold text-ink-primary" : ""} title={opts.titulo}>
      <td className="w-4 py-0.5 pr-1 text-ink-muted">{opts.sinal ?? ""}</td>
      <td className="py-0.5 pr-3">{rotulo}</td>
      <td className="py-0.5 text-right tabular-nums">{brl(valor)}</td>
    </tr>
  );
  return (
    <div className="space-y-1">
      <table className="w-full max-w-sm text-sm text-ink-secondary">
        <tbody>
          {linha(`Férias (salário ÷ 30 × ${dias} dia${dias === 1 ? "" : "s"})`, recibo.ferias)}
          {recibo.terco > 0 && linha("1/3 de férias", recibo.terco, { sinal: "+" })}
          {linha("Bruto", recibo.bruto, { sinal: "=", forte: true })}
          {linha("INSS", recibo.inss, { sinal: "−", titulo: recibo.memoria.inss })}
          {linha("IRRF", recibo.irrf, { sinal: "−", titulo: recibo.memoria.irrf })}
          {linha("Líquido a pagar", recibo.liquido, { sinal: "=", forte: true })}
        </tbody>
      </table>
      <p className="text-[11px] text-ink-muted">
        INSS: {recibo.memoria.inss} IRRF: {recibo.memoria.irrf}
        {semSalario && <span className="text-amber-700 dark:text-amber-400"> Sem salário na Sólides — considerado zero.</span>}
      </p>
    </div>
  );
}
