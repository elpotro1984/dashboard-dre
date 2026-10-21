"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useToast } from "@/components/ui/toaster";
import { formatDayBR } from "@/lib/ctrl/datetime";
import { lancarRescisaoCalculada } from "@/lib/dp/actions-folha";
import { grupoContratoFolha } from "@/lib/dp/folha/motor";
import type { DpFolhaParametros } from "@/lib/dp/folha/parametros";
import type { DpFolhaPessoa, DpRescisaoCalculo } from "@/lib/dp/folha/queries";
import {
  avisosPossiveis,
  calcularRescisao,
  ROTULO_AVISO,
  ROTULO_TIPO_RESCISAO,
  TIPOS_RESCISAO,
  type DpRescisaoEntrada,
  type DpRescisaoResultado,
  type DpTipoRescisao,
} from "@/lib/dp/folha/rescisao";
import { periodosExperiencia } from "@/lib/dp/vinculo";

import { inputCls, NumCampo, NumCampoOpcional } from "./campos";
import { brl } from "./formato";

const ANTECIPADAS: DpTipoRescisao[] = ["antecipada_empregador", "antecipada_empregado"];

/** Termo do contrato a prazo: o período de experiência que contém o desligamento (ou o último). */
function fimDaExperiencia(p: DpFolhaPessoa, desligamento: string): string | null {
  const per = periodosExperiencia({ tipoContrato: p.tipoContrato, admissao: p.admissao, experienciaFim: p.experienciaFim, duracao: p.experienciaDuracao });
  return per.find((x) => x.fim >= desligamento)?.fim ?? per[per.length - 1]?.fim ?? null;
}

/**
 * Calculadora de rescisão: o DP escolhe a modalidade e confere o que o sistema
 * não sabe (férias vencidas, saldo do FGTS); o resto vem da Sólides e da
 * folha. O número é recalculado no servidor ao lançar — a tela só mostra.
 */
export function DpRescisaoCalculadora({
  pessoa,
  companyId,
  competencia,
  parametros,
  primeira13,
  afastados,
  onClose,
}: {
  pessoa: DpFolhaPessoa;
  companyId: string;
  competencia: string;
  parametros: DpFolhaParametros;
  /** 1ª parcela do 13º já paga no ano (retrato da 1ª fechada ou paga nas férias). */
  primeira13: number;
  afastados: string[];
  onClose: () => void;
}) {
  const desligamentoInicial = pessoa.desligamento ?? `${competencia}-01`;
  const contrato = grupoContratoFolha(pessoa.tipoContrato);
  // Dentro da experiência: no último dia dela é término; antes, encerramento antecipado (o DP troca se foi a pedido).
  const fimExp = fimDaExperiencia(pessoa, desligamentoInicial);
  const tipoInicial: DpTipoRescisao =
    fimExp && desligamentoInicial === fimExp ? "termino_contrato" : fimExp && desligamentoInicial < fimExp ? "antecipada_empregador" : "sem_justa_causa";
  const [e, setE] = useState<DpRescisaoEntrada>({
    tipo: tipoInicial,
    aviso: avisosPossiveis(tipoInicial)[0],
    contrato,
    salario: pessoa.salario ?? 0,
    admissao: pessoa.admissao,
    desligamento: desligamentoInicial,
    fimContrato: fimExp,
    dependentesIr: pessoa.cadastro.dependentesIr,
    semInss: pessoa.cadastro.semInss,
    // A folha do mês do desligamento já paga os dias trabalhados dele.
    saldoNaFolha: desligamentoInicial.slice(0, 7) === competencia,
    diasSaldo: null,
    diasFeriasVencidas: 0,
    primeira13Paga: desligamentoInicial.slice(0, 4) === competencia.slice(0, 4) ? primeira13 : 0,
    saldoFgts: null,
    afastados,
    outrosProventos: 0,
    outrosDescontos: 0,
    descontarArt480: false,
  });
  const [obs, setObs] = useState("");
  const [pagamento, setPagamento] = useState<string>("");
  const [pending, start] = useTransition();
  const router = useRouter();
  const { showToast } = useToast();
  const up = (patch: Partial<DpRescisaoEntrada>) => setE((x) => ({ ...x, ...patch }));

  const calc = useMemo((): { r: DpRescisaoResultado | null; erro: string | null } => {
    try {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(e.desligamento)) return { r: null, erro: "Informe a data do desligamento." };
      return { r: calcularRescisao(e, parametros), erro: null };
    } catch (err) {
      return { r: null, erro: (err as Error).message };
    }
  }, [e, parametros]);
  const r = calc.r;

  const lancar = () =>
    start(async () => {
      const res = await lancarRescisaoCalculada({
        companyId,
        competencia,
        solidesId: pessoa.solidesId,
        nome: pessoa.nome,
        setor: pessoa.cadastro.setorFolha ?? pessoa.setor ?? "",
        entrada: e,
        dataPagamento: pagamento || null,
        observacao: obs || null,
      });
      if (!res.ok) {
        showToast({ title: "Não lançado", description: res.error, variant: "destructive" });
        return;
      }
      showToast({ title: `Rescisão lançada: ${brl(Math.max(0, res.data.liquido))}`, variant: "success" });
      router.refresh();
      onClose();
    });

  return (
    <Dialog open onOpenChange={(o) => !o && !pending && onClose()}>
      <DialogContent className="max-h-[92vh] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Calcular rescisão — {pessoa.nome}</DialogTitle>
          <DialogDescription>
            Cálculo gerencial para conferir o TRCT da contabilidade. Admissão {pessoa.admissao ? formatDayBR(pessoa.admissao) : "não informada"}
            {r ? ` · ${r.anosCompletos} ano(s) completo(s) de casa` : ""}.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-3 sm:grid-cols-2">
          <Campo rotulo="Modalidade">
            <select
              className={inputCls}
              value={e.tipo}
              onChange={(ev) => {
                const tipo = ev.target.value as DpTipoRescisao;
                up({ tipo, aviso: avisosPossiveis(tipo)[0] });
              }}
            >
              {TIPOS_RESCISAO.map((t) => (
                <option key={t} value={t}>
                  {ROTULO_TIPO_RESCISAO[t]}
                </option>
              ))}
            </select>
          </Campo>
          <Campo rotulo="Aviso prévio">
            <select className={inputCls} value={e.aviso} onChange={(ev) => up({ aviso: ev.target.value as DpRescisaoEntrada["aviso"] })} disabled={avisosPossiveis(e.tipo).length === 1}>
              {avisosPossiveis(e.tipo).map((a) => (
                <option key={a} value={a}>
                  {ROTULO_AVISO[a]}
                </option>
              ))}
            </select>
          </Campo>
          <Campo rotulo="Último dia do contrato" dica={e.aviso === "trabalhado" ? "No aviso trabalhado, o fim do aviso." : pessoa.desligamentoEstimado ? "A Sólides não deu a data: é o dia em que a saída foi percebida — confira." : undefined}>
            <input type="date" className={inputCls} value={e.desligamento} onChange={(ev) => up({ desligamento: ev.target.value, fimContrato: e.fimContrato ?? fimDaExperiencia(pessoa, ev.target.value) })} />
          </Campo>
          <Campo rotulo="Remuneração da rescisão" dica="Salário da Sólides; some as médias de variáveis, se houver.">
            <NumCampo valor={e.salario} onChange={(v) => up({ salario: v })} />
          </Campo>
          {ANTECIPADAS.includes(e.tipo) && (
            <Campo rotulo="Fim previsto do contrato" dica="Da experiência na Sólides, quando há.">
              <input type="date" className={inputCls} value={e.fimContrato ?? ""} onChange={(ev) => up({ fimContrato: ev.target.value || null })} />
            </Campo>
          )}
          <Campo rotulo="Dias de férias vencidas não gozadas" dica="A Sólides não tem o histórico de férias: só o DP sabe.">
            <NumCampo valor={e.diasFeriasVencidas} onChange={(v) => up({ diasFeriasVencidas: v })} casas={0} />
          </Campo>
          <Campo rotulo="1ª parcela do 13º já paga" dica={primeira13 > 0 ? "Do retrato da 1ª parcela (tela do 13º)." : "Nada registrado na tela do 13º neste ano."}>
            <NumCampo valor={e.primeira13Paga} onChange={(v) => up({ primeira13Paga: v })} />
          </Campo>
          <Campo rotulo="Saldo do FGTS para fins rescisórios" dica="Do extrato. Vazio = estimado (e dito).">
            <NumCampoOpcional valor={e.saldoFgts} auto={0} onChange={(v) => up({ saldoFgts: v })} />
          </Campo>
          <Campo rotulo="Dias de saldo de salário" dica="Vazio = do início do mês ao desligamento.">
            <NumCampoOpcional valor={e.diasSaldo} auto={r?.diasSaldo ?? 0} onChange={(v) => up({ diasSaldo: v })} casas={0} />
          </Campo>
          <Campo rotulo="Outros proventos">
            <NumCampo valor={e.outrosProventos} onChange={(v) => up({ outrosProventos: v })} />
          </Campo>
          <Campo rotulo="Outros descontos" dica="Consignado, pensão…">
            <NumCampo valor={e.outrosDescontos} onChange={(v) => up({ outrosDescontos: v })} />
          </Campo>
        </div>
        <div className="flex flex-wrap gap-4 text-sm">
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={e.saldoNaFolha} onChange={(ev) => up({ saldoNaFolha: ev.target.checked })} />
            Saldo de salário pago na folha do mês
          </label>
          {e.tipo === "antecipada_empregado" && (
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={e.descontarArt480} onChange={(ev) => up({ descontarArt480: ev.target.checked })} />
              Descontar a indenização do art. 480 (houve prejuízo)
            </label>
          )}
        </div>

        {calc.erro && <p className="text-sm text-red-700">{calc.erro}</p>}
        {r && <DpRescisaoVerbas r={r} />}

        <div className="grid gap-3 sm:grid-cols-2">
          <Campo rotulo="Data do pagamento" dica={r ? `Prazo legal: até ${formatDayBR(r.prazoPagamento)} (CLT art. 477 §6º).` : undefined}>
            <input type="date" className={inputCls} value={pagamento || r?.prazoPagamento || ""} onChange={(ev) => setPagamento(ev.target.value)} />
          </Campo>
          <Campo rotulo="Observação">
            <input className={inputCls} value={obs} onChange={(ev) => setObs(ev.target.value)} />
          </Campo>
        </div>

        <DialogFooter>
          <button type="button" className="rounded-md border border-input px-3 py-1.5 text-sm hover:bg-muted" disabled={pending} onClick={onClose}>
            Cancelar
          </button>
          <button
            type="button"
            disabled={pending || !r}
            onClick={lancar}
            className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
          >
            {pending ? "Lançando…" : `Lançar ${r ? brl(Math.max(0, r.liquido)) : ""} na aba Rescisões`}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Campo({ rotulo, dica, children }: { rotulo: string; dica?: string; children: React.ReactNode }) {
  return (
    <label className="block space-y-1 text-sm">
      <span className="text-ink-muted">{rotulo}</span>
      {children}
      {dica && <span className="block text-xs text-ink-muted">{dica}</span>}
    </label>
  );
}

/** As verbas como num TRCT, com a memória de cada uma — usada na calculadora e na abertura de uma rescisão lançada. */
export function DpRescisaoVerbas({ r }: { r: DpRescisaoResultado }) {
  const linhas = r.verbas.filter((v) => v.natureza !== "informativo");
  const info = r.verbas.filter((v) => v.natureza === "informativo");
  return (
    <div className="space-y-2">
      {r.avisos.length > 0 && (
        <ul className="space-y-1 rounded-md border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-sm text-amber-900 dark:text-amber-200">
          {r.avisos.map((a) => (
            <li key={a}>{a}</li>
          ))}
        </ul>
      )}
      <table className="w-full text-sm">
        <thead className="text-left text-ink-muted">
          <tr className="border-b border-border">
            <th className="py-1.5 pr-2 font-medium">Verba</th>
            <th className="py-1.5 pr-2 font-medium">Ref.</th>
            <th className="py-1.5 pr-2 text-right font-medium">Provento</th>
            <th className="py-1.5 text-right font-medium">Desconto</th>
          </tr>
        </thead>
        <tbody>
          {linhas.map((v) => (
            <tr key={v.chave} className="border-b border-border align-top">
              <td className="py-1.5 pr-2">
                <details>
                  <summary className="cursor-pointer text-ink-primary">{v.rubrica}</summary>
                  <p className="mt-1 text-xs text-ink-muted">{v.memoria}</p>
                </details>
              </td>
              <td className="py-1.5 pr-2 tabular-nums text-ink-muted">{v.referencia}</td>
              <td className="py-1.5 pr-2 text-right tabular-nums">{v.natureza === "provento" ? brl(v.valor) : ""}</td>
              <td className="py-1.5 text-right tabular-nums">{v.natureza === "desconto" ? brl(v.valor) : ""}</td>
            </tr>
          ))}
          <tr className="font-medium">
            <td className="py-1.5 pr-2" colSpan={2}>
              Totais
            </td>
            <td className="py-1.5 pr-2 text-right tabular-nums">{brl(r.proventos)}</td>
            <td className="py-1.5 text-right tabular-nums">{brl(r.descontos)}</td>
          </tr>
          <tr className="font-semibold">
            <td className="py-1.5 pr-2" colSpan={3}>
              Líquido a pagar
            </td>
            <td className={`py-1.5 text-right tabular-nums ${r.liquido < 0 ? "text-red-700" : ""}`}>{brl(r.liquido)}</td>
          </tr>
        </tbody>
      </table>
      {info.length > 0 && (
        <div className="space-y-1 text-sm">
          <p className="text-xs font-medium text-ink-muted">Fora do líquido</p>
          {info.map((v) => (
            <details key={v.chave} className="text-ink-muted">
              <summary className="cursor-pointer">
                {v.rubrica}: <span className="tabular-nums text-ink-primary">{brl(v.valor)}</span>
              </summary>
              <p className="mt-1 text-xs">{v.memoria}</p>
            </details>
          ))}
          <p className="text-xs text-ink-muted">
            Custo da rescisão para a empresa: <span className="tabular-nums text-ink-primary">{brl(r.custo)}</span> (verbas + FGTS do mês + multa; sem encargo patronal, como a folha).
          </p>
        </div>
      )}
    </div>
  );
}

/** Abertura de uma rescisão já lançada pela calculadora (somente leitura). */
export function DpRescisaoCalculoDialog({ nome, calculo, onClose }: { nome: string; calculo: DpRescisaoCalculo; onClose: () => void }) {
  const e = calculo.entrada;
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Rescisão — {nome}</DialogTitle>
          <DialogDescription>
            {ROTULO_TIPO_RESCISAO[e.tipo]} · aviso {ROTULO_AVISO[e.aviso].toLowerCase()} · último dia {formatDayBR(e.desligamento)} · remuneração {brl(e.salario)}
          </DialogDescription>
        </DialogHeader>
        <DpRescisaoVerbas r={calculo.resultado} />
        <DialogFooter>
          <button type="button" className="rounded-md border border-input px-3 py-1.5 text-sm hover:bg-muted" onClick={onClose}>
            Fechar
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
