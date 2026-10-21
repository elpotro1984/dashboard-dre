"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AlertTriangle, ChevronLeft, ChevronRight, Download, Lock, LockOpen, Pencil, Search } from "lucide-react";

import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useToast } from "@/components/ui/toaster";
import { formatDateTimeBR, formatDayBR } from "@/lib/ctrl/datetime";
import { fechar13, reabrir13, salvar13Pessoa } from "@/lib/dp/actions-folha-13";
import { ROTULO_13, somar13, type Dp13Ajustavel, type Dp13Ajustes, type Dp13Resultado } from "@/lib/dp/folha/decimo-terceiro";
import type { Dp13Edicao, Dp13Empresa } from "@/lib/dp/folha/decimo-terceiro-queries";
import { rotuloCompetencia } from "@/lib/dp/folha/parametros";

import { inputCls, NumCampo } from "./campos";
import { brl, brl0 } from "./formato";

const DIAS = ["domingo", "segunda", "terça", "quarta", "quinta", "sexta", "sábado"];
const diaSemana = (ymd: string) => DIAS[new Date(`${ymd}T12:00:00Z`).getUTCDay()];
const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

/**
 * 13º salário de uma empresa × ano: 1ª e 2ª parcela por pessoa, com memória de
 * cálculo, ajustes com motivo e o fechamento de cada parcela (retrato). A
 * empresa vem do seletor do topo; o ano, da URL (?ano=).
 */
export function Dp13Client({ dados, companyName, gestor }: { dados: Dp13Empresa; companyName: string; gestor: boolean }) {
  const { companyId, ano, fechamentos, limites } = dados;
  const [busca, setBusca] = useState("");
  const [soAvisos, setSoAvisos] = useState(false);
  const [aberta, setAberta] = useState<number | null>(null);
  const [confirmar, setConfirmar] = useState<{ acao: "fechar" | "reabrir"; parcela: 1 | 2 } | null>(null);
  const [verFora, setVerFora] = useState(false);
  const [pending, start] = useTransition();
  const router = useRouter();
  const { showToast } = useToast();

  const comTreze = useMemo(() => dados.linhas.filter((l) => !l.fora), [dados.linhas]);
  const fora = useMemo(() => dados.linhas.filter((l) => l.fora), [dados.linhas]);
  const visiveis = useMemo(() => {
    const q = norm(busca.trim());
    return comTreze.filter((l) => (!q || norm(`${l.nome} ${l.setor ?? ""}`).includes(q)) && (!soAvisos || l.avisos.length > 0));
  }, [comTreze, busca, soAvisos]);
  const total = useMemo(() => somar13(visiveis), [visiveis]);
  const geral = useMemo(() => somar13(comTreze), [comTreze]);
  const comAviso = comTreze.filter((l) => l.avisos.length > 0).length;
  const fechada2 = fechamentos[2] !== null;
  const editavel = !fechada2;
  const proxima: 1 | 2 | null = fechamentos[1] === null ? 1 : fechamentos[2] === null ? 2 : null;
  const linhaAberta = aberta !== null ? dados.linhas.find((l) => l.solidesId === aberta) ?? null : null;

  const executar = () =>
    start(async () => {
      if (!confirmar) return;
      const fn = confirmar.acao === "fechar" ? fechar13 : reabrir13;
      const res = await fn({ companyId, ano, parcela: confirmar.parcela });
      if (!res.ok) showToast({ title: "Não concluído", description: res.error, variant: "destructive" });
      else showToast({ title: confirmar.acao === "fechar" ? `${confirmar.parcela}ª parcela fechada` : `${confirmar.parcela}ª parcela reaberta`, variant: "success" });
      setConfirmar(null);
      router.refresh();
    });

  const prazo = (ymd: string, legal: string) => `até ${formatDayBR(ymd)} (${diaSemana(ymd)})${ymd.slice(5) !== legal ? ` — ${legal.slice(3)}/${legal.slice(0, 2)} não é dia útil` : ""}`;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <Link href={`?ano=${ano - 1}`} className="rounded-md border border-input p-1.5 hover:bg-muted" aria-label="Ano anterior">
            <ChevronLeft className="h-4 w-4" />
          </Link>
          <span className="min-w-16 text-center text-lg font-semibold text-ink-primary">{ano}</span>
          <Link href={`?ano=${ano + 1}`} className="rounded-md border border-input p-1.5 hover:bg-muted" aria-label="Próximo ano">
            <ChevronRight className="h-4 w-4" />
          </Link>
          {([1, 2] as const).map((p) => (
            <span
              key={p}
              className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${
                fechamentos[p] ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400" : "bg-amber-500/10 text-amber-800 dark:text-amber-300"
              }`}
            >
              {fechamentos[p] ? <Lock className="h-3 w-3" /> : <LockOpen className="h-3 w-3" />}
              {p}ª parcela{" "}
              {fechamentos[p]
                ? `fechada em ${formatDateTimeBR(fechamentos[p]!.fechadoEm)}${fechamentos[p]!.fechadoPor ? ` por ${fechamentos[p]!.fechadoPor}` : ""}`
                : "aberta"}
            </span>
          ))}
        </div>
        <div className="flex flex-wrap gap-2">
          <a
            href={`/api/dp/decimo-terceiro/exportar?companyId=${companyId}&ano=${ano}`}
            className="inline-flex items-center gap-1.5 rounded-md border border-input px-3 py-1.5 text-sm font-medium hover:bg-muted"
          >
            <Download className="h-4 w-4" /> Excel
          </a>
          {proxima && (
            <button
              type="button"
              onClick={() => setConfirmar({ acao: "fechar", parcela: proxima })}
              disabled={comTreze.length === 0}
              className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
            >
              <Lock className="h-4 w-4" /> Fechar {proxima}ª parcela
            </button>
          )}
          {gestor && (fechamentos[2] || fechamentos[1]) && (
            <button
              type="button"
              onClick={() => setConfirmar({ acao: "reabrir", parcela: fechamentos[2] ? 2 : 1 })}
              className="inline-flex items-center gap-1.5 rounded-md border border-input px-3 py-1.5 text-sm font-medium hover:bg-muted"
            >
              <LockOpen className="h-4 w-4" /> Reabrir {fechamentos[2] ? 2 : 1}ª
            </button>
          )}
        </div>
      </div>

      <p className="text-xs text-ink-muted">
        13º gerencial, de conferência — o oficial continua na contabilidade. Parâmetros:{" "}
        {dados.vigencia ? `vigência de ${rotuloCompetencia(dados.vigencia)}` : "padrão do sistema"}. Avos da 1ª parcela contados{" "}
        {dados.parametros.decimoTerceiro.avosPrimeiraAte === 12 ? "no ano todo (quem está desde antes de janeiro recebe metade do salário)" : `até ${dados.parametros.decimoTerceiro.avosPrimeiraAte === 10 ? "outubro" : "novembro"}`}{" "}
        — muda em Configurações › Parâmetros da folha. Média de variáveis (hora extra, adicional) não entra sozinha: ajuste a base de quem tiver.
      </p>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Resumo titulo="1ª parcela" valor={geral.primeira} detalhe={prazo(limites.primeira, "11-30")} />
        <Resumo titulo="2ª parcela (líquida)" valor={geral.segunda} detalhe={prazo(limites.segunda, "12-20")} />
        <Resumo titulo="INSS + IRRF do 13º" valor={geral.inss + geral.irrf} detalhe={`INSS ${brl(geral.inss)} · IRRF ${brl(geral.irrf)}`} />
        <Resumo titulo="Custo (13º + FGTS)" valor={geral.custo} detalhe={`${geral.pessoas} pessoa(s) · FGTS ${brl(geral.fgts)}`} />
      </div>

      {dados.saidasDepoisDaPrimeira.length > 0 && (
        <div className="rounded-md border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-sm">
          <p className="font-medium text-amber-900 dark:text-amber-200">Receberam a 1ª parcela e não estão mais na empresa — descontar na rescisão</p>
          {dados.saidasDepoisDaPrimeira.map((s) => (
            <p key={s.solidesId}>
              {s.nome}: {brl(s.primeira)}
            </p>
          ))}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <div className="relative w-full max-w-xs">
          <Search className="pointer-events-none absolute left-2 top-2 h-4 w-4 text-ink-muted" />
          <input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar nome ou setor" className="w-full rounded-md border border-input bg-background py-1.5 pl-8 pr-2 text-sm" />
        </div>
        {comAviso > 0 && (
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={soAvisos} onChange={(e) => setSoAvisos(e.target.checked)} />
            Só quem tem aviso ({comAviso})
          </label>
        )}
      </div>

      <Card>
        <CardContent className="overflow-x-auto py-3">
          {comTreze.length === 0 ? (
            <p className="text-sm text-ink-muted">Ninguém com 13º nesta empresa em {ano}.</p>
          ) : (
            <table className="w-full min-w-[1000px] text-sm">
              <thead className="text-left text-ink-muted">
                <tr className="border-b border-border">
                  <th className="py-2 pr-3 font-medium">Colaborador</th>
                  <th className="py-2 pr-3 font-medium">Setor</th>
                  <th className="py-2 pr-3 text-right font-medium">Avos</th>
                  <th className="py-2 pr-3 text-right font-medium">Base</th>
                  <th className="py-2 pr-3 text-right font-medium">13º integral</th>
                  <th className="py-2 pr-3 text-right font-medium">1ª parcela</th>
                  <th className="py-2 pr-3 text-right font-medium">INSS</th>
                  <th className="py-2 pr-3 text-right font-medium">IRRF</th>
                  <th className="py-2 pr-3 text-right font-medium">2ª parcela</th>
                  <th className="py-2 pr-3 text-right font-medium">FGTS</th>
                  <th className="w-8" />
                </tr>
              </thead>
              <tbody>
                {visiveis.map((l) => (
                  <tr key={l.solidesId} className="border-b border-border hover:bg-muted/40">
                    <td className="py-1.5 pr-3 text-ink-primary">
                      <span className="inline-flex items-center gap-1">
                        {l.nome}
                        {l.avisos.length > 0 && <AlertTriangle className="h-3.5 w-3.5 text-amber-600" aria-label="Há aviso" />}
                        {Object.keys(l.ajustados).length > 0 && <span className="rounded bg-sky-500/10 px-1 text-[11px] text-sky-800 dark:text-sky-300">ajuste</span>}
                      </span>
                    </td>
                    <td className="py-1.5 pr-3 text-ink-muted">{l.setor ?? "—"}</td>
                    <td className="py-1.5 pr-3 text-right tabular-nums">
                      {l.avosAno}/12{l.avosPrimeira !== l.avosAno ? <span className="text-ink-muted"> (1ª: {l.avosPrimeira})</span> : null}
                    </td>
                    <td className="py-1.5 pr-3 text-right tabular-nums">{brl(l.base)}</td>
                    <td className="py-1.5 pr-3 text-right tabular-nums">{brl(l.integral)}</td>
                    <td className="py-1.5 pr-3 text-right tabular-nums">{l.primeira === 0 && l.primeiraConsiderada > 0 ? <span className="text-ink-muted">nas férias</span> : brl0(l.primeira)}</td>
                    <td className="py-1.5 pr-3 text-right tabular-nums">{brl0(l.inss)}</td>
                    <td className="py-1.5 pr-3 text-right tabular-nums">{brl0(l.irrf)}</td>
                    <td className={`py-1.5 pr-3 text-right tabular-nums ${l.segunda < 0 ? "text-red-700" : ""}`}>{brl(l.segunda)}</td>
                    <td className="py-1.5 pr-3 text-right tabular-nums">{brl0(l.fgts)}</td>
                    <td className="py-1.5 text-right">
                      <button type="button" onClick={() => setAberta(l.solidesId)} className="rounded p-1 text-ink-muted hover:text-ink-primary" aria-label={`Abrir o 13º de ${l.nome}`}>
                        <Pencil className="h-4 w-4" />
                      </button>
                    </td>
                  </tr>
                ))}
                <tr className="font-medium">
                  <td className="py-1.5 pr-3" colSpan={4}>
                    Total ({total.pessoas})
                  </td>
                  <td className="py-1.5 pr-3 text-right tabular-nums">{brl(total.integral)}</td>
                  <td className="py-1.5 pr-3 text-right tabular-nums">{brl(total.primeira)}</td>
                  <td className="py-1.5 pr-3 text-right tabular-nums">{brl(total.inss)}</td>
                  <td className="py-1.5 pr-3 text-right tabular-nums">{brl(total.irrf)}</td>
                  <td className="py-1.5 pr-3 text-right tabular-nums">{brl(total.segunda)}</td>
                  <td className="py-1.5 pr-3 text-right tabular-nums">{brl(total.fgts)}</td>
                  <td />
                </tr>
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>

      {fora.length > 0 && (
        <div className="text-sm">
          <button type="button" className="text-ink-muted hover:text-ink-primary hover:underline" onClick={() => setVerFora(!verFora)}>
            {verFora ? "Esconder" : "Ver"} quem está na folha e não tem 13º nesta tela ({fora.length})
          </button>
          {verFora && (
            <ul className="mt-2 space-y-0.5 text-ink-muted">
              {fora.map((l) => (
                <li key={l.solidesId}>
                  <span className="text-ink-primary">{l.nome}</span> — {l.fora}
                  {l.avisos.length > 0 && <span className="text-amber-700 dark:text-amber-400"> {l.avisos.join(" ")}</span>}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {linhaAberta && !linhaAberta.fora && (
        <Dp13PessoaDialog
          key={linhaAberta.solidesId}
          linha={linhaAberta}
          edicao={dados.edicoes[linhaAberta.solidesId] ?? null}
          companyId={companyId}
          ano={ano}
          editavel={editavel}
          primeiraFechada={fechamentos[1] !== null}
          onClose={() => setAberta(null)}
        />
      )}

      <Dialog open={confirmar !== null} onOpenChange={(o) => !o && !pending && setConfirmar(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {confirmar?.acao === "fechar" ? `Fechar a ${confirmar.parcela}ª parcela do 13º de ${ano}?` : `Reabrir a ${confirmar?.parcela}ª parcela?`}
            </DialogTitle>
            <DialogDescription>
              {confirmar?.acao === "fechar"
                ? confirmar.parcela === 1
                  ? `A 1ª parcela de ${comTreze.length} pessoa(s) de ${companyName} (${brl(geral.primeira)}) fica gravada como está. A 2ª parcela passa a descontar exatamente esse valor, mesmo que o salário mude depois. Só o gestor reabre.`
                  : `O 13º de ${companyName} fica gravado como está agora (2ª parcela ${brl(geral.segunda)}). Mudar Sólides, cadastro ou parâmetros não altera mais. Só o gestor reabre.`
                : "O retrato desta parcela é descartado e ela volta a ser calculada com os dados de hoje."}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <button type="button" className="rounded-md border border-input px-3 py-1.5 text-sm hover:bg-muted" disabled={pending} onClick={() => setConfirmar(null)}>
              Cancelar
            </button>
            <button
              type="button"
              disabled={pending}
              onClick={executar}
              className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
            >
              {pending ? "Aguarde…" : confirmar?.acao === "fechar" ? "Fechar" : "Reabrir"}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Resumo({ titulo, valor, detalhe }: { titulo: string; valor: number; detalhe: string }) {
  return (
    <Card>
      <CardContent className="space-y-0.5 py-3">
        <p className="text-xs text-ink-muted">{titulo}</p>
        <p className="text-lg font-semibold tabular-nums text-ink-primary">{brl(valor)}</p>
        <p className="text-xs text-ink-muted">{detalhe}</p>
      </CardContent>
    </Card>
  );
}

const AJUSTAVEIS: Array<{ k: Dp13Ajustavel; dica: string }> = [
  { k: "avos", dica: "faltas injustificadas, afastamento parcial" },
  { k: "base", dica: "salário + média de hora extra / adicional" },
  { k: "inss", dica: "valor da contabilidade" },
  { k: "irrf", dica: "valor da contabilidade" },
];

function Dp13PessoaDialog({
  linha,
  edicao,
  companyId,
  ano,
  editavel,
  primeiraFechada,
  onClose,
}: {
  linha: Dp13Resultado;
  edicao: Dp13Edicao | null;
  companyId: string;
  ano: number;
  editavel: boolean;
  primeiraFechada: boolean;
  onClose: () => void;
}) {
  const [ajustes, setAjustes] = useState<Dp13Ajustes>(edicao?.ajustes ?? {});
  const [nasFerias, setNasFerias] = useState(edicao?.primeiraFerias !== null && edicao?.primeiraFerias !== undefined);
  const [valorFerias, setValorFerias] = useState(edicao?.primeiraFerias ?? 0);
  const [obs, setObs] = useState(edicao?.observacao ?? "");
  const [pending, start] = useTransition();
  const router = useRouter();
  const { showToast } = useToast();

  const calculado = (k: Dp13Ajustavel) => (linha.ajustados[k] !== undefined ? linha.ajustados[k]! : k === "avos" ? linha.avosAno : linha[k]);

  const salvar = () =>
    start(async () => {
      const res = await salvar13Pessoa({
        companyId,
        ano,
        solidesId: linha.solidesId,
        ajustes,
        primeiraFerias: nasFerias ? valorFerias : null,
        observacao: obs || null,
      });
      if (!res.ok) {
        showToast({ title: "Não salvo", description: res.error, variant: "destructive" });
        return;
      }
      showToast({ title: "13º salvo", variant: "success" });
      router.refresh();
      onClose();
    });

  const memorias: Array<keyof typeof ROTULO_13> = ["avos", "base", "integral", "primeira", "inss", "irrf", "segunda", "fgts"];

  return (
    <Dialog open onOpenChange={(o) => !o && !pending && onClose()}>
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            13º de {ano} — {linha.nome}
          </DialogTitle>
          <DialogDescription>
            {linha.avosAno}/12 avos · integral {brl(linha.integral)} · 1ª {brl(linha.primeiraConsiderada)} · 2ª líquida {brl(linha.segunda)}
          </DialogDescription>
        </DialogHeader>

        {linha.avisos.length > 0 && (
          <ul className="space-y-1 rounded-md border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-sm text-amber-900 dark:text-amber-200">
            {linha.avisos.map((a) => (
              <li key={a}>{a}</li>
            ))}
          </ul>
        )}

        <dl className="space-y-1.5 text-sm">
          {memorias.map((k) =>
            linha.memoria[k] ? (
              <div key={k} className="grid grid-cols-[9rem_1fr] gap-2">
                <dt className="text-ink-muted">{ROTULO_13[k]}</dt>
                <dd>{linha.memoria[k]}</dd>
              </div>
            ) : null,
          )}
        </dl>

        {editavel && (
          <div className="space-y-3 border-t border-border pt-3">
            <p className="text-sm font-medium text-ink-primary">Ajustes (com motivo)</p>
            {AJUSTAVEIS.map(({ k, dica }) => {
              const a = ajustes[k];
              return (
                <div key={k} className="grid items-center gap-2 sm:grid-cols-[9rem_8rem_1fr]">
                  <label className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={Boolean(a)}
                      onChange={(e) => {
                        const n = { ...ajustes };
                        if (e.target.checked) n[k] = { valor: calculado(k), motivo: "" };
                        else delete n[k];
                        setAjustes(n);
                      }}
                    />
                    {ROTULO_13[k]}
                  </label>
                  {a ? (
                    <>
                      <NumCampo valor={a.valor} casas={k === "avos" ? 0 : 2} onChange={(v) => setAjustes({ ...ajustes, [k]: { ...a, valor: v } })} ariaLabel={`Ajuste de ${ROTULO_13[k]}`} />
                      <input className={inputCls} placeholder={`Motivo (${dica})`} value={a.motivo} onChange={(e) => setAjustes({ ...ajustes, [k]: { ...a, motivo: e.target.value } })} />
                    </>
                  ) : (
                    <span className="text-xs text-ink-muted sm:col-span-2">calculado: {k === "avos" ? calculado(k) : brl(calculado(k))}</span>
                  )}
                </div>
              );
            })}
            <div className="grid items-center gap-2 sm:grid-cols-[9rem_8rem_1fr]">
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={nasFerias} onChange={(e) => setNasFerias(e.target.checked)} />
                1ª paga nas férias
              </label>
              {nasFerias ? (
                <>
                  <NumCampo valor={valorFerias} onChange={setValorFerias} ariaLabel="Valor da 1ª parcela paga nas férias" />
                  <span className="text-xs text-ink-muted">A pessoa pediu em janeiro e recebeu junto com as férias: nada a pagar em novembro.</span>
                </>
              ) : (
                <span className="text-xs text-ink-muted sm:col-span-2">
                  {primeiraFechada ? "A 1ª parcela está fechada: a 2ª desconta o valor do retrato." : "Marque se a 1ª parcela já foi paga nas férias."}
                </span>
              )}
            </div>
            <input className={inputCls} placeholder="Observação" value={obs} onChange={(e) => setObs(e.target.value)} />
          </div>
        )}

        <DialogFooter>
          <button type="button" className="rounded-md border border-input px-3 py-1.5 text-sm hover:bg-muted" disabled={pending} onClick={onClose}>
            {editavel ? "Cancelar" : "Fechar"}
          </button>
          {editavel && (
            <button
              type="button"
              disabled={pending || Object.values(ajustes).some((a) => !a?.motivo.trim())}
              onClick={salvar}
              className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
            >
              {pending ? "Salvando…" : "Salvar"}
            </button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
