"use client";

import { Fragment, useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ChevronDown, ChevronLeft, ChevronRight, ChevronUp, Lock, LockOpen, Pencil, Search } from "lucide-react";

import { Card, CardContent } from "@/components/ui/card";
import { useToast } from "@/components/ui/toaster";
import { formatDateTimeBR } from "@/lib/ctrl/datetime";
import { ajustarImpostoFolha } from "@/lib/dp/actions-folha";
import {
  linhasDoImposto,
  patronalPorPessoa,
  resumirImpostos,
  ROTULO_IMPOSTO,
  type DpAlvoImposto,
  type DpImposto,
  type DpLinhaImposto,
} from "@/lib/dp/folha/impostos";
import type { DpFolhaLancamento, DpFolhaResultado } from "@/lib/dp/folha/motor";
import { rotuloCompetencia, somarMeses, type DpFolhaParametros } from "@/lib/dp/folha/parametros";
import type { EncargoValues } from "@/lib/orcamento/encargos";

import { inputCls, NumCampo } from "./campos";
import { brl, brl0 } from "./formato";

type Aba = "resumo" | DpImposto;
const ABAS: Aba[] = ["resumo", "inss", "irrf", "fgts", "salarioFamilia", "patronal"];
const ROTULO_ABA: Record<Aba, string> = { resumo: "Resumo das guias", ...ROTULO_IMPOSTO };

const pct = (v: number) => `${(v * 100).toLocaleString("pt-BR", { maximumFractionDigits: 2 })}%`;
const pp = (v: number) => `${v.toLocaleString("pt-BR", { maximumFractionDigits: 2 })}%`;
const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

export interface DpImpostosDados {
  companyId: string;
  competencia: string;
  vigencia: string | null;
  parametros: DpFolhaParametros;
  fechamento: { fechadoEm: string; fechadoPor: string | null } | null;
  linhas: DpFolhaResultado[];
  /** O que está gravado no mês de cada pessoa: os ajustes (com motivo) e o INSS do recibo informado. */
  lancamentos: Record<number, { ajustes: DpFolhaLancamento["ajustes"]; inssFerias: number | null }>;
  encargos: EncargoValues;
  origemEncargos: { tipo: "cadastro"; ano: number } | { tipo: "padrao"; regime: string | null };
}

/**
 * Impostos da folha do mês, um por aba: a tabela usada, a base, o valor e a
 * memória de cálculo de cada pessoa, e o valor manual (com motivo) por cima do
 * calculado. Os números são os da Folha (o mesmo motor) — ajustar aqui é o
 * mesmo ajuste da janela da pessoa.
 */
export function DpImpostosClient({ dados, gestor }: { dados: DpImpostosDados; gestor: boolean }) {
  const [aba, setAba] = useState<Aba>("resumo");
  const [busca, setBusca] = useState("");
  const { competencia, linhas, encargos } = dados;
  const editavel = dados.fechamento === null;
  const resumo = useMemo(() => resumirImpostos(linhas, encargos), [linhas, encargos]);
  const hrefMes = (n: number) => `?competencia=${somarMeses(competencia, n)}`;

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
        <span
          className={`ml-2 inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${
            editavel ? "bg-amber-500/10 text-amber-800 dark:text-amber-300" : "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400"
          }`}
        >
          {editavel ? <LockOpen className="h-3 w-3" /> : <Lock className="h-3 w-3" />}
          {editavel
            ? "Folha aberta — valores podem ser ajustados"
            : `Folha fechada em ${formatDateTimeBR(dados.fechamento!.fechadoEm)} — reabra para ajustar`}
        </span>
      </div>
      <p className="text-xs text-ink-muted">
        Impostos da folha gerencial, de conferência — as guias oficiais saem da contabilidade. Tabelas:{" "}
        {dados.vigencia ? `vigência de ${rotuloCompetencia(dados.vigencia)}` : "padrão do sistema"}.
        {resumo.comAjuste > 0 && <span> {resumo.comAjuste} pessoa(s) com imposto ajustado à mão.</span>}
      </p>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Cartao titulo="INSS a recolher" valor={resumo.inssGuia} detalhe={`empregados ${brl(resumo.inssEmpregadosGuia)} + empresa ${brl(resumo.patronal.total)}`} onClick={() => setAba("inss")} />
        <Cartao titulo="FGTS a depositar" valor={resumo.fgts} detalhe={`base ${brl(resumo.fgtsBase)}`} onClick={() => setAba("fgts")} />
        <Cartao titulo="IRRF a recolher" valor={resumo.irrf} detalhe="só a folha do mês (sem férias e rescisões)" onClick={() => setAba("irrf")} />
        <Cartao titulo="Encargos da empresa" valor={resumo.patronal.total} detalhe={`base ${brl(resumo.patronal.base)}`} onClick={() => setAba("patronal")} />
      </div>

      <div className="flex flex-wrap gap-1 border-b border-border">
        {ABAS.map((a) => (
          <button
            key={a}
            type="button"
            onClick={() => setAba(a)}
            className={`-mb-px border-b-2 px-3 py-1.5 text-sm ${aba === a ? "border-primary font-medium text-ink-primary" : "border-transparent text-ink-muted hover:text-ink-primary"}`}
          >
            {ROTULO_ABA[a]}
          </button>
        ))}
      </div>

      {aba !== "resumo" && (
        <div className="relative w-full max-w-xs">
          <Search className="pointer-events-none absolute left-2 top-2 h-4 w-4 text-ink-muted" />
          <input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar nome ou setor" className="w-full rounded-md border border-input bg-background py-1.5 pl-8 pr-2 text-sm" />
        </div>
      )}

      <Card>
        <CardContent className="space-y-4 overflow-x-auto py-3">
          {aba === "resumo" ? (
            <Resumo resumo={resumo} encargos={encargos} />
          ) : aba === "patronal" ? (
            <Patronal dados={dados} busca={busca} />
          ) : (
            <TabelaImposto dados={dados} imposto={aba} busca={busca} editavel={editavel} gestor={gestor} />
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function Cartao({ titulo, valor, detalhe, onClick }: { titulo: string; valor: number; detalhe: string; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="text-left">
      <Card className="h-full transition-colors hover:bg-muted/40">
        <CardContent className="space-y-0.5 py-3">
          <p className="text-xs text-ink-muted">{titulo}</p>
          <p className="text-lg font-semibold tabular-nums text-ink-primary">{brl(valor)}</p>
          <p className="text-xs text-ink-muted">{detalhe}</p>
        </CardContent>
      </Card>
    </button>
  );
}

// ── Resumo das guias ────────────────────────────────────────────────────────

function Resumo({ resumo, encargos }: { resumo: ReturnType<typeof resumirImpostos>; encargos: EncargoValues }) {
  const linha = (rotulo: string, valor: number, opts: { sinal?: "+" | "−" | "="; forte?: boolean } = {}) => (
    <tr className={opts.forte ? "border-t border-border font-semibold" : ""}>
      <td className="py-1 pr-3 text-ink-muted">{opts.sinal ?? ""}</td>
      <td className="py-1 pr-3">{rotulo}</td>
      <td className="py-1 text-right tabular-nums">{brl(valor)}</td>
    </tr>
  );
  return (
    <div className="grid gap-6 lg:grid-cols-3">
      <div className="space-y-2">
        <p className="text-sm font-medium text-ink-primary">INSS (guia do mês)</p>
        <table className="w-full text-sm">
          <tbody>
            {linha("Descontado dos empregados (inclui o das férias)", resumo.inssDescontado)}
            {linha("Salário-família pago (a empresa compensa)", resumo.salarioFamilia, { sinal: "−" })}
            {resumo.licenca > 0 && linha("Salário de quem está em licença-maternidade", resumo.licenca, { sinal: "−" })}
            {linha("INSS dos empregados na guia", resumo.inssEmpregadosGuia, { sinal: "=", forte: true })}
            {linha(`INSS patronal (${pp(encargos.inss_patronal)})`, resumo.patronal.inss, { sinal: "+" })}
            {linha(`RAT × FAP (${pp(encargos.rat_fap)})`, resumo.patronal.rat, { sinal: "+" })}
            {linha(`Terceiros (${pp(encargos.terceiros)})`, resumo.patronal.terceiros, { sinal: "+" })}
            {linha("INSS da guia", resumo.inssGuia, { sinal: "=", forte: true })}
          </tbody>
        </table>
        <p className="text-xs text-ink-muted">
          A dedução do salário de quem está em licença é a regra da planilha do DP (a mesma da aba Totais).
        </p>
      </div>
      <div className="space-y-2">
        <p className="text-sm font-medium text-ink-primary">FGTS</p>
        <table className="w-full text-sm">
          <tbody>
            {linha("Base (salário do mês + férias)", resumo.fgtsBase)}
            {linha("FGTS a depositar (8%; aprendiz 2%)", resumo.fgts, { sinal: "=", forte: true })}
          </tbody>
        </table>
      </div>
      <div className="space-y-2">
        <p className="text-sm font-medium text-ink-primary">IRRF</p>
        <table className="w-full text-sm">
          <tbody>
            {linha("Rendimento tributável da folha", resumo.irrfBase)}
            {linha("IRRF a recolher", resumo.irrf, { sinal: "=", forte: true })}
          </tbody>
        </table>
        <p className="text-xs text-ink-muted">Não inclui o IRRF do recibo de férias nem o das rescisões, que saem em documento próprio.</p>
      </div>
    </div>
  );
}

// ── Tabela usada ────────────────────────────────────────────────────────────

function TabelaUsada({ imposto, p, gestor }: { imposto: Exclude<DpImposto, "patronal">; p: DpFolhaParametros; gestor: boolean }) {
  let corpo: React.ReactNode = null;
  if (imposto === "inss") {
    let de = 0;
    corpo = (
      <ul className="space-y-0.5">
        {p.inss.map((f) => {
          const txt = `${brl(de)} a ${brl(f.ate)}: ${pct(f.aliquota)}`;
          de = f.ate + 0.01;
          return <li key={f.ate}>{txt}</li>;
        })}
        <li className="text-ink-muted">Progressivo: cada faixa paga a sua alíquota. Acima de {brl(p.inss.at(-1)?.ate ?? 0)}, o teto.</li>
      </ul>
    );
  } else if (imposto === "irrf") {
    let de = 0;
    corpo = (
      <ul className="space-y-0.5">
        {p.irrf.faixas.map((f) => {
          const txt = f.ate === null ? `acima de ${brl(de)}: ${pct(f.aliquota)} − ${brl(f.deducao)}` : `${brl(de)} a ${brl(f.ate)}: ${f.aliquota ? `${pct(f.aliquota)} − ${brl(f.deducao)}` : "isento"}`;
          de = (f.ate ?? 0) + 0.01;
          return <li key={String(f.ate)}>{txt}</li>;
        })}
        <li className="text-ink-muted">
          Dedução por dependente {brl(p.irrf.deducaoDependente)}; ou o desconto simplificado de {brl(p.irrf.descontoSimplificado)}, quando maior.
          {p.irrf.redutor &&
            ` Redutor da Lei 15.270/2025: zera o imposto até ${brl(p.irrf.redutor.limiteIsencao)} de rendimento e reduz até ${brl(p.irrf.redutor.limiteReducao)}.`}
        </li>
      </ul>
    );
  } else if (imposto === "fgts") {
    corpo = (
      <p>
        {pct(p.fgtsPercentual)} sobre o salário do mês + férias; jovem aprendiz {pct(p.fgtsAprendizPercentual)}. Estágio, PJ e sócio não têm FGTS.
      </p>
    );
  } else {
    corpo = (
      <p>
        {brl(p.salarioFamilia.cota)} por cota, só CLT
        {p.salarioFamilia.limiteRemuneracao !== null ? `, para salário até ${brl(p.salarioFamilia.limiteRemuneracao)}` : ""}. Compensado na guia do INSS.
      </p>
    );
  }
  return (
    <div className="rounded-md border border-border bg-muted/30 px-3 py-2 text-sm">
      <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
        <span className="font-medium text-ink-primary">Tabela usada</span>
        {gestor && (
          <Link href="/dp/configuracoes/parametros" className="text-xs font-medium text-ink-primary underline">
            Alterar a tabela (Parâmetros da folha)
          </Link>
        )}
      </div>
      {corpo}
    </div>
  );
}

// ── Um imposto do empregado ─────────────────────────────────────────────────

function TabelaImposto({
  dados,
  imposto,
  busca,
  editavel,
  gestor,
}: {
  dados: DpImpostosDados;
  imposto: Exclude<DpImposto, "patronal">;
  busca: string;
  editavel: boolean;
  gestor: boolean;
}) {
  const [aberta, setAberta] = useState<number | null>(null);
  const linhas = useMemo(() => {
    const q = norm(busca.trim());
    return linhasDoImposto(dados.linhas, imposto).filter((l) => !q || norm(`${l.nome} ${l.setor ?? ""}`).includes(q));
  }, [dados.linhas, imposto, busca]);
  const total = linhas.reduce((s, l) => s + l.valor, 0);
  const totalBase = linhas.reduce((s, l) => s + l.base, 0);
  const comFerias = imposto === "inss" && linhas.some((l) => l.inssFerias > 0 || dados.lancamentos[l.solidesId]?.inssFerias != null);
  const colunas = 5 + (comFerias ? 1 : 0);

  return (
    <>
      <TabelaUsada imposto={imposto} p={dados.parametros} gestor={gestor} />
      {linhas.length === 0 ? (
        <p className="text-sm text-ink-muted">Ninguém com {ROTULO_IMPOSTO[imposto]} neste mês.</p>
      ) : (
        <table className="w-full min-w-[720px] text-sm">
          <thead className="text-left text-ink-muted">
            <tr className="border-b border-border">
              <th className="py-2 pr-3 font-medium">Colaborador</th>
              <th className="py-2 pr-3 font-medium">Setor</th>
              <th className="py-2 pr-3 text-right font-medium">{imposto === "salarioFamilia" ? "Salário" : "Base"}</th>
              <th className="py-2 pr-3 text-right font-medium">{ROTULO_IMPOSTO[imposto]}</th>
              {comFerias && <th className="py-2 pr-3 text-right font-medium">Já descontado nas férias</th>}
              <th className="w-24" />
            </tr>
          </thead>
          <tbody>
            {linhas.map((l) => (
              <Fragment key={l.solidesId}>
                <tr className="border-b border-border align-top hover:bg-muted/40">
                  <td className="py-1.5 pr-3 text-ink-primary">
                    <button type="button" className="inline-flex items-center gap-1 text-left hover:underline" onClick={() => setAberta(aberta === l.solidesId ? null : l.solidesId)}>
                      {aberta === l.solidesId ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
                      {l.nome}
                    </button>
                    {l.ajustado && <span className="ml-1 rounded bg-sky-500/10 px-1 text-[11px] text-sky-800 dark:text-sky-300">manual</span>}
                  </td>
                  <td className="py-1.5 pr-3 text-ink-muted">{l.setor ?? "—"}</td>
                  <td className="py-1.5 pr-3 text-right tabular-nums">{brl0(l.base)}</td>
                  <td className="py-1.5 pr-3 text-right tabular-nums">
                    {brl(l.valor)}
                    {l.ajustado && <span className="block text-[11px] text-ink-muted">calculado {brl(l.calculado)}</span>}
                  </td>
                  {comFerias && <td className="py-1.5 pr-3 text-right tabular-nums">{brl0(l.inssFerias)}</td>}
                  <td className="py-1.5 text-right">
                    {editavel && (
                      <button type="button" className="inline-flex items-center gap-1 rounded p-1 text-xs text-ink-muted hover:text-ink-primary" onClick={() => setAberta(l.solidesId)}>
                        <Pencil className="h-3.5 w-3.5" /> ajustar
                      </button>
                    )}
                  </td>
                </tr>
                {aberta === l.solidesId && (
                  <tr className="border-b border-border bg-muted/20">
                    <td colSpan={colunas} className="space-y-3 px-3 py-3">
                      <p className="text-xs text-ink-muted">
                        <span className="font-medium text-ink-primary">Memória de cálculo: </span>
                        {l.memoria || "Não incide para esta pessoa neste mês."}
                      </p>
                      {editavel && (
                        <EditorValor
                          key={`${imposto}-${l.solidesId}`}
                          dados={dados}
                          alvo={imposto}
                          linha={l}
                          motivoAtual={dados.lancamentos[l.solidesId]?.ajustes?.[imposto]?.motivo ?? ""}
                        />
                      )}
                      {editavel && imposto === "inss" && (l.inssFerias > 0 || dados.lancamentos[l.solidesId]?.inssFerias != null) && (
                        <EditorValor key={`ferias-${l.solidesId}`} dados={dados} alvo="inssFerias" linha={l} motivoAtual="" />
                      )}
                    </td>
                  </tr>
                )}
              </Fragment>
            ))}
            <tr className="font-medium">
              <td className="py-1.5 pr-3" colSpan={2}>
                Total ({linhas.length})
              </td>
              <td className="py-1.5 pr-3 text-right tabular-nums">{brl(totalBase)}</td>
              <td className="py-1.5 pr-3 text-right tabular-nums">{brl(total)}</td>
              {comFerias && <td className="py-1.5 pr-3 text-right tabular-nums">{brl(linhas.reduce((s, l) => s + l.inssFerias, 0))}</td>}
              <td />
            </tr>
          </tbody>
        </table>
      )}
    </>
  );
}

/**
 * Valor manual de um imposto (ou do INSS do recibo de férias). Imposto exige
 * motivo, como todo ajuste da folha; "Voltar ao calculado" apaga o ajuste. No
 * recibo de férias, vazio = automático (calculado como no recibo).
 */
function EditorValor({ dados, alvo, linha, motivoAtual }: { dados: DpImpostosDados; alvo: DpAlvoImposto; linha: DpLinhaImposto; motivoAtual: string }) {
  const ferias = alvo === "inssFerias";
  const informadoFerias = dados.lancamentos[linha.solidesId]?.inssFerias ?? null;
  const [valor, setValor] = useState<number>(ferias ? informadoFerias ?? linha.inssFerias : linha.valor);
  const [motivo, setMotivo] = useState(motivoAtual);
  const [pending, start] = useTransition();
  const router = useRouter();
  const { showToast } = useToast();
  const manual = ferias ? informadoFerias !== null : linha.ajustado;

  const gravar = (v: number | null) =>
    start(async () => {
      const res = await ajustarImpostoFolha({
        companyId: dados.companyId,
        competencia: dados.competencia,
        solidesId: linha.solidesId,
        alvo,
        valor: v,
        motivo: v === null ? null : motivo,
      });
      if (!res.ok) {
        showToast({ title: "Não salvo", description: res.error, variant: "destructive" });
        return;
      }
      showToast({ title: v === null ? "Voltou ao calculado" : "Valor manual salvo", variant: "success" });
      router.refresh();
    });

  return (
    <div className="flex flex-wrap items-end gap-2">
      <label className="block space-y-1 text-xs">
        <span className="text-ink-muted">{ferias ? "INSS já descontado no recibo de férias" : `${ROTULO_IMPOSTO[alvo as DpImposto]} manual`}</span>
        <NumCampo valor={valor} onChange={setValor} className="w-36" ariaLabel="Valor manual" />
      </label>
      {!ferias && (
        <label className="block min-w-64 flex-1 space-y-1 text-xs">
          <span className="text-ink-muted">Motivo (obrigatório)</span>
          <input className={inputCls} value={motivo} onChange={(e) => setMotivo(e.target.value)} placeholder="ex.: valor da contabilidade" />
        </label>
      )}
      <button
        type="button"
        disabled={pending || (!ferias && !motivo.trim())}
        onClick={() => gravar(valor)}
        className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
      >
        {pending ? "Salvando…" : "Salvar valor manual"}
      </button>
      {manual && (
        <button type="button" disabled={pending} onClick={() => gravar(null)} className="rounded-md border border-input px-3 py-1.5 text-sm hover:bg-muted disabled:opacity-50">
          {ferias ? "Voltar ao automático" : `Voltar ao calculado (${brl(linha.calculado)})`}
        </button>
      )}
    </div>
  );
}

// ── Encargos da empresa ─────────────────────────────────────────────────────

function Patronal({ dados, busca }: { dados: DpImpostosDados; busca: string }) {
  const [aberta, setAberta] = useState<number | null>(null);
  const e = dados.encargos;
  const linhas = useMemo(() => {
    const q = norm(busca.trim());
    return patronalPorPessoa(dados.linhas, e).filter((l) => !q || norm(`${l.nome} ${l.setor ?? ""}`).includes(q));
  }, [dados.linhas, e, busca]);
  const soma = (k: "base" | "inssPatronal" | "rat" | "terceiros" | "total") => linhas.reduce((s, l) => s + l[k], 0);
  const origem =
    dados.origemEncargos.tipo === "cadastro"
      ? `cadastro de encargos do Orçamento (ano ${dados.origemEncargos.ano})`
      : `padrão do regime ${dados.origemEncargos.regime === "simples_nacional" ? "Simples Nacional" : "normal"} — esta empresa não tem alíquotas cadastradas`;

  return (
    <>
      <div className="rounded-md border border-border bg-muted/30 px-3 py-2 text-sm">
        <p className="font-medium text-ink-primary">Alíquotas usadas</p>
        <p>
          INSS patronal {pp(e.inss_patronal)} · RAT × FAP {pp(e.rat_fap)} · Terceiros {pp(e.terceiros)} — {origem}.
        </p>
        <p className="text-xs text-ink-muted">
          Estimativa gerencial, sobre o salário do mês + férias de quem é CLT. Não incide em estágio, PJ, sócio nem sobre o salário-maternidade.
          As alíquotas são as do cadastro de encargos da empresa no Orçamento — as mesmas das Simulações.
        </p>
      </div>
      {linhas.length === 0 ? (
        <p className="text-sm text-ink-muted">Ninguém com encargo da empresa neste mês.</p>
      ) : (
        <table className="w-full min-w-[720px] text-sm">
          <thead className="text-left text-ink-muted">
            <tr className="border-b border-border">
              <th className="py-2 pr-3 font-medium">Colaborador</th>
              <th className="py-2 pr-3 text-right font-medium">Base</th>
              <th className="py-2 pr-3 text-right font-medium">INSS patronal</th>
              <th className="py-2 pr-3 text-right font-medium">RAT × FAP</th>
              <th className="py-2 pr-3 text-right font-medium">Terceiros</th>
              <th className="py-2 text-right font-medium">Total</th>
            </tr>
          </thead>
          <tbody>
            {linhas.map((l) => (
              <Fragment key={l.solidesId}>
                <tr className="border-b border-border hover:bg-muted/40">
                  <td className="py-1.5 pr-3 text-ink-primary">
                    <button type="button" className="inline-flex items-center gap-1 text-left hover:underline" onClick={() => setAberta(aberta === l.solidesId ? null : l.solidesId)}>
                      {aberta === l.solidesId ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
                      {l.nome}
                    </button>
                  </td>
                  <td className="py-1.5 pr-3 text-right tabular-nums">{brl(l.base)}</td>
                  <td className="py-1.5 pr-3 text-right tabular-nums">{brl0(l.inssPatronal)}</td>
                  <td className="py-1.5 pr-3 text-right tabular-nums">{brl0(l.rat)}</td>
                  <td className="py-1.5 pr-3 text-right tabular-nums">{brl0(l.terceiros)}</td>
                  <td className="py-1.5 text-right tabular-nums">{brl(l.total)}</td>
                </tr>
                {aberta === l.solidesId && (
                  <tr className="border-b border-border bg-muted/20">
                    <td colSpan={6} className="px-3 py-2 text-xs text-ink-muted">
                      <span className="font-medium text-ink-primary">Memória de cálculo: </span>
                      {l.memoria}
                    </td>
                  </tr>
                )}
              </Fragment>
            ))}
            <tr className="font-medium">
              <td className="py-1.5 pr-3">Total ({linhas.length})</td>
              <td className="py-1.5 pr-3 text-right tabular-nums">{brl(soma("base"))}</td>
              <td className="py-1.5 pr-3 text-right tabular-nums">{brl(soma("inssPatronal"))}</td>
              <td className="py-1.5 pr-3 text-right tabular-nums">{brl(soma("rat"))}</td>
              <td className="py-1.5 pr-3 text-right tabular-nums">{brl(soma("terceiros"))}</td>
              <td className="py-1.5 text-right tabular-nums">{brl(soma("total"))}</td>
            </tr>
          </tbody>
        </table>
      )}
    </>
  );
}
