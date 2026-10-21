"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Calculator, FileText, Plus, Trash2 } from "lucide-react";

import { useToast } from "@/components/ui/toaster";
import { formatDayBR } from "@/lib/ctrl/datetime";
import { excluirRescisao, salvarRescisao } from "@/lib/dp/actions-folha";
import type { DpRescisaoSugerida } from "@/lib/dp/folha/conferencia";
import type { DpFolhaParametros } from "@/lib/dp/folha/parametros";
import type { DpFolhaPessoa, DpFolhaRescisao } from "@/lib/dp/folha/queries";

import { inputCls, NumCampo } from "./campos";
import { brl } from "./formato";
import { DpRescisaoCalculadora, DpRescisaoCalculoDialog } from "./rescisao-calculadora";

const VAZIA = { dataPagamento: "", tipo: "", setor: "", valor: 0, solidesId: null as number | null, nome: "", observacao: "" };

/** A aba RESCISÕES: o que foi pago de rescisão no mês (entra em "Indenizações" nos totais). */
export function DpFolhaRescisoes({
  companyId,
  competencia,
  rescisoes,
  pessoas,
  sugeridas,
  editavel,
  parametros,
  dadosRescisao,
}: {
  companyId: string;
  competencia: string;
  rescisoes: DpFolhaRescisao[];
  pessoas: DpFolhaPessoa[];
  /** Desligados no mês (Sólides) sem rescisão lançada. */
  sugeridas: DpRescisaoSugerida[];
  editavel: boolean;
  parametros: DpFolhaParametros;
  /** 1ª parcela do 13º já paga e meses afastados no ano, por pessoa (para a calculadora). */
  dadosRescisao: { primeira13: Record<number, number>; afastados: Record<number, string[]> };
}) {
  const [nova, setNova] = useState(VAZIA);
  const [calcular, setCalcular] = useState<number | null>(null);
  const [verCalculo, setVerCalculo] = useState<DpFolhaRescisao | null>(null);
  const pessoaCalc = calcular !== null ? pessoas.find((p) => p.solidesId === calcular) ?? null : null;
  const [pending, start] = useTransition();
  const router = useRouter();
  const { showToast } = useToast();
  const total = rescisoes.reduce((s, r) => s + r.valor, 0);

  const rodar = (fn: () => Promise<{ ok: boolean; error?: string }>, ok?: () => void) =>
    start(async () => {
      const res = await fn();
      if (!res.ok) showToast({ title: "Não salvo", description: res.error, variant: "destructive" });
      else ok?.();
      router.refresh();
    });

  return (
    <div className="space-y-3">
      {sugeridas.length > 0 && (
        <div className="space-y-1 rounded-md border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-sm">
          <p className="font-medium text-amber-900 dark:text-amber-200">Desligados neste mês sem rescisão lançada</p>
          {sugeridas.map((s) => (
            <div key={s.solidesId} className="flex flex-wrap items-center justify-between gap-2">
              <span>
                {s.nome} — desligamento em {formatDayBR(s.data)}
              </span>
              {editavel && (
                <span className="flex gap-3">
                  {pessoas.some((p) => p.solidesId === s.solidesId) && (
                    <button type="button" className="inline-flex items-center gap-1 text-xs font-medium hover:underline" onClick={() => setCalcular(s.solidesId)}>
                      <Calculator className="h-3.5 w-3.5" /> calcular
                    </button>
                  )}
                  <button
                    type="button"
                    className="text-xs text-ink-muted hover:underline"
                    onClick={() => setNova({ ...VAZIA, dataPagamento: s.data, solidesId: s.solidesId, nome: s.nome, setor: s.setor ?? "" })}
                  >
                    digitar o valor
                  </button>
                </span>
              )}
            </div>
          ))}
        </div>
      )}
      <table className="w-full text-sm">
        <thead className="text-left text-ink-muted">
          <tr className="border-b border-border">
            <th className="py-2 pr-2 font-medium">Pagamento</th>
            <th className="py-2 pr-2 font-medium">Colaborador</th>
            <th className="py-2 pr-2 font-medium">Tipo</th>
            <th className="py-2 pr-2 font-medium">Setor</th>
            <th className="py-2 pr-2 text-right font-medium">Valor</th>
            <th className="py-2 pr-2 font-medium">Observações</th>
            <th className="w-8" />
          </tr>
        </thead>
        <tbody>
          {rescisoes.length === 0 && (
            <tr>
              <td colSpan={7} className="py-3 text-ink-muted">
                Nenhuma rescisão neste mês.
              </td>
            </tr>
          )}
          {rescisoes.map((r) => (
            <tr key={r.id} className="border-b border-border">
              <td className="py-1.5 pr-2 tabular-nums">{r.dataPagamento ? formatDayBR(r.dataPagamento) : "—"}</td>
              <td className="py-1.5 pr-2 text-ink-primary">{r.nome}</td>
              <td className="py-1.5 pr-2">{r.tipo || "—"}</td>
              <td className="py-1.5 pr-2">{r.setor || "—"}</td>
              <td className="py-1.5 pr-2 text-right tabular-nums">{brl(r.valor)}</td>
              <td className="py-1.5 pr-2 text-ink-muted">{r.observacao ?? ""}</td>
              <td className="whitespace-nowrap py-1.5 text-right">
                {r.calculo && (
                  <button
                    type="button"
                    className="rounded p-1 text-ink-muted hover:text-ink-primary"
                    onClick={() => setVerCalculo(r)}
                    aria-label={`Ver o cálculo da rescisão de ${r.nome}`}
                    title="Ver o cálculo"
                  >
                    <FileText className="h-4 w-4" />
                  </button>
                )}
                {editavel && (
                  <button
                    type="button"
                    className="rounded p-1 text-ink-muted hover:text-red-700"
                    disabled={pending}
                    onClick={() => rodar(() => excluirRescisao({ companyId, competencia, id: r.id }))}
                    aria-label={`Excluir rescisão de ${r.nome}`}
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                )}
              </td>
            </tr>
          ))}
          {rescisoes.length > 0 && (
            <tr className="font-medium">
              <td colSpan={4} className="py-1.5">
                Total
              </td>
              <td className="py-1.5 pr-2 text-right tabular-nums">{brl(total)}</td>
              <td colSpan={2} />
            </tr>
          )}
        </tbody>
      </table>

      {editavel && (
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <Calculator className="h-4 w-4 text-ink-muted" />
          <span className="text-ink-muted">Calcular a rescisão de</span>
          <select className={`${inputCls} w-72`} value="" onChange={(e) => e.target.value && setCalcular(Number(e.target.value))} aria-label="Calcular a rescisão de">
            <option value="">escolha a pessoa…</option>
            {pessoas.map((p) => (
              <option key={p.solidesId} value={p.solidesId}>
                {p.nome}
                {p.ativo ? "" : " (desligado)"}
              </option>
            ))}
          </select>
        </div>
      )}

      {editavel && (
        <div className="grid gap-2 rounded-md border border-dashed border-border p-3 sm:grid-cols-2 lg:grid-cols-[9rem_1fr_1fr_8rem_8rem_8rem_1fr_auto]">
          <input type="date" className={inputCls} value={nova.dataPagamento} onChange={(e) => setNova({ ...nova, dataPagamento: e.target.value })} aria-label="Data do pagamento" />
          <select
            className={inputCls}
            value={nova.solidesId ?? ""}
            onChange={(e) => {
              const p = pessoas.find((x) => String(x.solidesId) === e.target.value);
              setNova({ ...nova, solidesId: p?.solidesId ?? null, nome: p?.nome ?? nova.nome, setor: p?.setor ?? nova.setor });
            }}
            aria-label="Colaborador"
          >
            <option value="">Colaborador…</option>
            {pessoas.map((p) => (
              <option key={p.solidesId} value={p.solidesId}>
                {p.nome}
                {p.ativo ? "" : " (desligado)"}
              </option>
            ))}
          </select>
          <input
            className={inputCls}
            placeholder="Nome (desligado fora da lista: digite)"
            value={nova.nome}
            onChange={(e) => setNova({ ...nova, nome: e.target.value, solidesId: null })}
            aria-label="Nome do colaborador"
          />
          <input className={inputCls} placeholder="Tipo" value={nova.tipo} onChange={(e) => setNova({ ...nova, tipo: e.target.value })} />
          <input className={inputCls} placeholder="Setor" value={nova.setor} onChange={(e) => setNova({ ...nova, setor: e.target.value })} />
          <NumCampo valor={nova.valor} onChange={(v) => setNova({ ...nova, valor: v })} ariaLabel="Valor" />
          <input className={inputCls} placeholder="Observações" value={nova.observacao} onChange={(e) => setNova({ ...nova, observacao: e.target.value })} />
          <button
            type="button"
            disabled={pending || !nova.nome || nova.valor <= 0}
            onClick={() =>
              rodar(
                () => salvarRescisao({ companyId, competencia, ...nova, dataPagamento: nova.dataPagamento || null, observacao: nova.observacao || null }),
                () => setNova(VAZIA),
              )
            }
            className="inline-flex items-center justify-center gap-1 rounded-md bg-primary px-3 py-1 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
          >
            <Plus className="h-4 w-4" /> Lançar
          </button>
        </div>
      )}
      <p className="text-xs text-ink-muted">
        Quem foi desligado na Sólides some do quadro ativo; a rescisão dele é lançada aqui. Quem já tem lançamento no mês continua na folha. A
        calculadora é gerencial — confira com o TRCT da contabilidade; o valor lançado é o líquido.
      </p>

      {pessoaCalc && (
        <DpRescisaoCalculadora
          key={pessoaCalc.solidesId}
          pessoa={pessoaCalc}
          companyId={companyId}
          competencia={competencia}
          parametros={parametros}
          primeira13={dadosRescisao.primeira13[pessoaCalc.solidesId] ?? 0}
          afastados={dadosRescisao.afastados[pessoaCalc.solidesId] ?? []}
          onClose={() => setCalcular(null)}
        />
      )}
      {verCalculo?.calculo && <DpRescisaoCalculoDialog nome={verCalculo.nome} calculo={verCalculo.calculo} onClose={() => setVerCalculo(null)} />}
    </div>
  );
}
