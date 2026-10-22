"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AlertTriangle, ChevronLeft, ChevronRight, Download, Lock, LockOpen, Pencil, Search } from "lucide-react";

import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useToast } from "@/components/ui/toaster";
import { formatDateTimeBR } from "@/lib/ctrl/datetime";
import { fecharFolha, reabrirFolha } from "@/lib/dp/actions-folha";
import { ROTULO_SITUACAO, somarFolha, type DpFolhaResultado } from "@/lib/dp/folha/motor";
import { ROTULO_PLANO, rotuloCompetencia, somarMeses, type DpFolhaParametros } from "@/lib/dp/folha/parametros";
import type { DpFolhaEmpresa, DpFolhaLinhaCargo, DpFolhaPessoa } from "@/lib/dp/folha/queries";
import { totalizar } from "@/lib/dp/folha/totais";

import { brl, brl0 } from "./formato";
import { DpIncluirAvulso } from "./avulso-form";
import { DpImportarFolhaDialog } from "./importar-dialog";
import { DpLancamentosGrade } from "./lancamentos-grade";
import { DpConferenciaContabilidade, DpValoresPlanilha } from "./planilhas-externas";
import { DpFolhaPessoaDialog } from "./pessoa-dialog";
import { DpCargoCelula, DpPromocaoSelo, SeloTabela } from "./promocao";
import { DpFolhaRescisoes } from "./rescisoes";
import { DpTotaisTabela } from "./totais-tabela";

type Aba = "lancar" | "folha" | "cadastro" | "beneficios" | "rescisoes" | "totais" | "conferencia";
const ABAS: Array<{ id: Aba; rotulo: string }> = [
  { id: "lancar", rotulo: "Lançar o mês" },
  { id: "folha", rotulo: "Folha" },
  { id: "cadastro", rotulo: "Cadastro" },
  { id: "beneficios", rotulo: "Benefícios (VA / VT)" },
  { id: "rescisoes", rotulo: "Rescisões" },
  { id: "totais", rotulo: "Totais" },
  { id: "conferencia", rotulo: "Conferência e planilhas" },
];

const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

function transporteRotulo(p: DpFolhaPessoa): string {
  if (p.cadastro.transporteTipo === "bilhete") return p.cadastro.transporteOpcao ?? "Bilhete";
  if (p.cadastro.transporteTipo === "gasolina") return `Gasolina ${brl(p.cadastro.transporteValor)}`;
  return "—";
}

/**
 * Folha gerencial de uma empresa × mês — as abas da planilha do DP (CONTROLE e
 * SALÁRIO juntas em "Folha" + "Cadastro", ALIM_TRASP, RESCISÕES e TOTAIS), com
 * a mesma conta para tudo. A competência anda pela URL (?competencia=), a
 * empresa pelo seletor do topo.
 */
export function DpFolhaClient({
  folha,
  companyName,
  gestor,
  dadosRescisao,
}: {
  folha: DpFolhaEmpresa;
  companyName: string;
  gestor: boolean;
  dadosRescisao: { primeira13: Record<number, number>; afastados: Record<number, string[]> };
}) {
  const [aba, setAba] = useState<Aba>(folha.fechamento ? "folha" : "lancar");
  const [busca, setBusca] = useState("");
  const [soAvisos, setSoAvisos] = useState(false);
  const [aberta, setAberta] = useState<number | null>(null);
  const [confirmar, setConfirmar] = useState<"fechar" | "reabrir" | null>(null);
  const [agrupar, setAgrupar] = useState<"setor" | "centro">("setor");
  const [pending, start] = useTransition();
  const router = useRouter();
  const { showToast } = useToast();

  const { competencia, companyId } = folha;
  const fechada = folha.fechamento !== null;
  const editavel = !fechada;
  const linhaPor = useMemo(() => new Map(folha.linhas.map((l) => [l.solidesId, l])), [folha.linhas]);
  const pessoaPor = useMemo(() => new Map(folha.pessoas.map((p) => [p.solidesId, p])), [folha.pessoas]);

  const visiveis = useMemo(() => {
    const q = norm(busca.trim());
    return folha.linhas.filter(
      (l) => (!q || norm(`${l.nome} ${l.setor ?? ""} ${l.centroCusto ?? ""}`).includes(q)) && (!soAvisos || l.avisos.length > 0),
    );
  }, [folha.linhas, busca, soAvisos]);
  const total = useMemo(() => somarFolha(visiveis), [visiveis]);
  const idsVisiveis = useMemo(() => new Set(visiveis.map((l) => l.solidesId)), [visiveis]);
  const semCadastro = folha.pessoas.filter((p) => !p.temCadastro).length;
  const comAviso = folha.linhas.filter((l) => l.avisos.length > 0).length;
  const comAjuste = folha.linhas.filter((l) => Object.keys(l.ajustados ?? {}).length > 0).length;
  const foraSolides = folha.pessoas.filter((p) => p.avulso).length;
  const paraUnificar = folha.pessoas.filter((p) => p.unificarCom).length;
  // Folha fechada é retrato: o vermelho de hoje não pinta um mês que já foi.
  const foraTabela = editavel ? folha.pessoas.filter((p) => p.alertaTabela).length : 0;

  const totais = useMemo(
    () =>
      agrupar === "setor"
        ? totalizar(folha.linhas, (l) => l.setor, folha.rescisoes.map((r) => ({ grupo: r.setor || null, valor: r.valor })))
        : totalizar(folha.linhas, (l) => l.centroCusto, folha.rescisoes.map((r) => ({ grupo: (r.solidesId && linhaPor.get(r.solidesId)?.centroCusto) || null, valor: r.valor }))),
    [agrupar, folha.linhas, folha.rescisoes, linhaPor],
  );

  const acao = () =>
    start(async () => {
      const res = confirmar === "fechar" ? await fecharFolha({ companyId, competencia }) : await reabrirFolha({ companyId, competencia });
      if (!res.ok) showToast({ title: "Não concluído", description: res.error, variant: "destructive" });
      else showToast({ title: confirmar === "fechar" ? "Folha fechada" : "Folha reaberta", variant: "success" });
      setConfirmar(null);
      router.refresh();
    });

  const pessoaAberta = aberta !== null ? pessoaPor.get(aberta) ?? null : null;
  const hrefMes = (n: number) => `?competencia=${somarMeses(competencia, n)}`;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Link href={hrefMes(-1)} className="rounded-md border border-input p-1.5 hover:bg-muted" aria-label="Mês anterior">
            <ChevronLeft className="h-4 w-4" />
          </Link>
          <span className="min-w-24 text-center text-lg font-semibold text-ink-primary">{rotuloCompetencia(competencia)}</span>
          <Link href={hrefMes(1)} className="rounded-md border border-input p-1.5 hover:bg-muted" aria-label="Próximo mês">
            <ChevronRight className="h-4 w-4" />
          </Link>
          <span
            className={`ml-2 inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${
              fechada ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400" : "bg-amber-500/10 text-amber-800 dark:text-amber-300"
            }`}
          >
            {fechada ? <Lock className="h-3 w-3" /> : <LockOpen className="h-3 w-3" />}
            {fechada
              ? `Fechada em ${formatDateTimeBR(folha.fechamento!.fechadoEm)}${folha.fechamento!.fechadoPor ? ` por ${folha.fechamento!.fechadoPor}` : ""}`
              : "Aberta"}
          </span>
        </div>
        <div className="flex flex-wrap gap-2">
          {editavel && <DpIncluirAvulso companyId={companyId} companyName={companyName} />}
          {editavel && <DpImportarFolhaDialog companyId={companyId} competencia={competencia} />}
          <a
            href={`/api/dp/folha/exportar?companyId=${companyId}&competencia=${competencia}`}
            className="inline-flex items-center gap-1.5 rounded-md border border-input px-3 py-1.5 text-sm font-medium hover:bg-muted"
          >
            <Download className="h-4 w-4" /> Excel
          </a>
          {editavel ? (
            <button
              type="button"
              onClick={() => setConfirmar("fechar")}
              disabled={folha.linhas.length === 0}
              className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
            >
              <Lock className="h-4 w-4" /> Fechar folha
            </button>
          ) : (
            gestor && (
              <button
                type="button"
                onClick={() => setConfirmar("reabrir")}
                className="inline-flex items-center gap-1.5 rounded-md border border-input px-3 py-1.5 text-sm font-medium hover:bg-muted"
              >
                <LockOpen className="h-4 w-4" /> Reabrir
              </button>
            )
          )}
        </div>
      </div>

      <p className="text-xs text-ink-muted">
        Folha gerencial, de conferência — a oficial (eSocial, guias) continua na contabilidade. Parâmetros:{" "}
        {folha.vigencia ? `vigência de ${rotuloCompetencia(folha.vigencia)}` : "padrão do sistema (nenhuma vigência cadastrada em Configurações › Parâmetros da folha)"}.
        {semCadastro > 0 && <span className="text-amber-700 dark:text-amber-400"> {semCadastro} pessoa(s) sem cadastro da folha (plano, VA, VT…).</span>}
        {comAviso > 0 && <span className="text-amber-700 dark:text-amber-400"> {comAviso} com aviso para conferir.</span>}
        {comAjuste > 0 && <span> {comAjuste} com ajuste manual.</span>}
        {foraSolides > 0 && <span> {foraSolides} fora da Sólides{paraUnificar > 0 ? ` (${paraUnificar} já aparece lá — unificar)` : ""}.</span>}
        {foraTabela > 0 && (
          <span className="text-red-700 dark:text-red-400">
            {" "}
            {foraTabela} com salário da Sólides diferente da tabela salarial (em vermelho) — a folha usa o da Sólides; corrija lá.
          </span>
        )}
      </p>

      <div className="flex flex-wrap gap-1 border-b border-border">
        {ABAS.map((a) => (
          <button
            key={a.id}
            type="button"
            onClick={() => setAba(a.id)}
            className={`-mb-px border-b-2 px-3 py-1.5 text-sm ${aba === a.id ? "border-primary font-medium text-ink-primary" : "border-transparent text-ink-muted hover:text-ink-primary"}`}
          >
            {a.rotulo}
            {a.id === "rescisoes" && folha.rescisoes.length > 0 ? ` (${folha.rescisoes.length})` : ""}
            {a.id === "rescisoes" && (folha.rescisoesSugeridas?.length ?? 0) > 0 && (
              <span className="ml-1 rounded bg-amber-500/15 px-1 text-xs text-amber-800 dark:text-amber-300">{folha.rescisoesSugeridas.length} a lançar</span>
            )}
          </button>
        ))}
      </div>

      {(aba === "lancar" || aba === "folha" || aba === "cadastro" || aba === "beneficios") && (
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative w-full max-w-xs">
            <Search className="pointer-events-none absolute left-2 top-2 h-4 w-4 text-ink-muted" />
            <input
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
              placeholder="Buscar nome, setor ou centro de custo"
              className="w-full rounded-md border border-input bg-background py-1.5 pl-8 pr-2 text-sm"
            />
          </div>
          {comAviso > 0 && (
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={soAvisos} onChange={(e) => setSoAvisos(e.target.checked)} />
              Só quem tem aviso ({comAviso})
            </label>
          )}
        </div>
      )}

      <Card>
        <CardContent className="overflow-x-auto py-3">
          {/* A grade fica montada (só escondida) para não perder o que foi digitado ao trocar de aba. */}
          <div className={aba === "lancar" ? "" : "hidden"}>
            {folha.linhas.length > 0 && (
              <DpLancamentosGrade
                pessoas={folha.pessoas}
                visiveis={idsVisiveis}
                parametros={folha.parametros}
                competencia={competencia}
                companyId={companyId}
                editavel={editavel}
                onAbrir={setAberta}
              />
            )}
          </div>
          {folha.linhas.length === 0 && aba !== "rescisoes" ? (
            <p className="text-sm text-ink-muted">Ninguém ativo nesta empresa na Sólides.</p>
          ) : aba === "lancar" ? null : aba === "conferencia" ? (
            <div className="space-y-4">
              <DpConferenciaContabilidade companyId={companyId} competencia={competencia} />
              <DpValoresPlanilha companyId={companyId} competencia={competencia} editavel={editavel} />
            </div>
          ) : aba === "folha" ? (
            <TabelaFolha linhas={visiveis} total={total} onAbrir={setAberta} pessoaPor={pessoaPor} alertaTabela={editavel} />
          ) : aba === "cadastro" ? (
            <TabelaCadastro
              pessoas={folha.pessoas.filter((p) => idsVisiveis.has(p.solidesId))}
              parametros={folha.parametros}
              onAbrir={setAberta}
              tabela={folha.tabela ?? []}
              competencia={competencia}
              companyId={companyId}
              editavel={editavel}
            />
          ) : aba === "beneficios" ? (
            <TabelaBeneficios linhas={visiveis} pessoaPor={pessoaPor} />
          ) : aba === "rescisoes" ? (
            <DpFolhaRescisoes
              companyId={companyId}
              competencia={competencia}
              rescisoes={folha.rescisoes}
              pessoas={folha.pessoas}
              sugeridas={folha.rescisoesSugeridas ?? []}
              editavel={editavel}
              parametros={folha.parametros}
              dadosRescisao={dadosRescisao}
            />
          ) : (
            <div className="space-y-2">
              <div className="flex gap-2 text-sm">
                {(["setor", "centro"] as const).map((g) => (
                  <button
                    key={g}
                    type="button"
                    onClick={() => setAgrupar(g)}
                    className={`rounded-md border px-2 py-1 ${agrupar === g ? "border-primary bg-primary/5 font-medium" : "border-input hover:bg-muted"}`}
                  >
                    {g === "setor" ? "Por setor" : "Por centro de custo"}
                  </button>
                ))}
              </div>
              <DpTotaisTabela t={totais} rotuloGrupo={agrupar === "setor" ? "Setor" : "Centro de custo"} />
              <p className="text-xs text-ink-muted">
                {companyName}. Os totais por empresa, para o grupo inteiro, ficam em DP · Visão do grupo › Folha do grupo.
              </p>
            </div>
          )}
        </CardContent>
      </Card>

      {pessoaAberta && (
        <DpFolhaPessoaDialog
          key={pessoaAberta.solidesId}
          pessoa={pessoaAberta}
          linhaFechada={fechada ? linhaPor.get(pessoaAberta.solidesId) ?? null : null}
          parametros={folha.parametros}
          competencia={competencia}
          companyId={companyId}
          centros={folha.centros}
          tabela={folha.tabela ?? []}
          editavel={editavel}
          onClose={() => setAberta(null)}
        />
      )}

      <Dialog open={confirmar !== null} onOpenChange={(o) => !o && !pending && setConfirmar(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{confirmar === "fechar" ? `Fechar a folha de ${rotuloCompetencia(competencia)}?` : "Reabrir a folha?"}</DialogTitle>
            <DialogDescription>
              {confirmar === "fechar"
                ? `Os números de ${folha.linhas.length} pessoa(s) de ${companyName} ficam gravados como estão agora. Depois disso, mudar parâmetros, cadastro ou a Sólides não altera este mês. Só o gestor reabre.`
                : "A folha volta a ser calculada com os dados de hoje (Sólides, cadastro e parâmetros) e pode ser alterada. O retrato gravado no fechamento é descartado."}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <button type="button" className="rounded-md border border-input px-3 py-1.5 text-sm hover:bg-muted" disabled={pending} onClick={() => setConfirmar(null)}>
              Cancelar
            </button>
            <button
              type="button"
              disabled={pending}
              onClick={acao}
              className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
            >
              {pending ? "Aguarde…" : confirmar === "fechar" ? "Fechar folha" : "Reabrir"}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function TabelaFolha({
  linhas,
  total,
  onAbrir,
  pessoaPor,
  alertaTabela,
}: {
  linhas: DpFolhaResultado[];
  total: ReturnType<typeof somarFolha>;
  onAbrir: (id: number) => void;
  pessoaPor: Map<number, DpFolhaPessoa>;
  /** Pintar quem tem salário fora da tabela (só na folha aberta). */
  alertaTabela: boolean;
}) {
  const th = "py-2 pr-3 text-right font-medium";
  const td = "py-1.5 pr-3 text-right tabular-nums";
  return (
    <table className="w-full min-w-[1100px] text-sm">
      <thead className="text-left text-ink-muted">
        <tr className="border-b border-border">
          <th className="py-2 pr-3 font-medium">Colaborador</th>
          <th className={th}>Salário do mês</th>
          <th className={th}>Entradas</th>
          <th className={th}>Descontos</th>
          <th className={th}>Saldo</th>
          <th className={th}>Adiant.</th>
          <th className={th}>5º dia útil</th>
          <th className={th}>Benefícios + VT</th>
          <th className={th}>FGTS</th>
          <th className="py-2 text-right font-medium">Total geral</th>
        </tr>
      </thead>
      <tbody>
        {linhas.map((l) => {
          const aj = Object.keys(l.ajustados ?? {}).length;
          const fora = alertaTabela ? pessoaPor.get(l.solidesId)?.alertaTabela ?? null : null;
          return (
            <tr
              key={l.solidesId}
              className={`cursor-pointer border-b border-border ${fora ? "bg-red-500/10 hover:bg-red-500/15" : "hover:bg-muted/50"}`}
              title={fora ?? undefined}
              onClick={() => onAbrir(l.solidesId)}
            >
              <td className="py-1.5 pr-3">
                <span className="font-medium text-ink-primary">{l.nome}</span>
                {l.avisos.length > 0 && <AlertTriangle className="ml-1 inline h-3.5 w-3.5 text-amber-600" aria-label="Há avisos" />}
                {aj > 0 && <Pencil className="ml-1 inline h-3.5 w-3.5 text-amber-600" aria-label={`${aj} ajuste(s) manual(is)`} />}
                {pessoaPor.get(l.solidesId) && <DpPromocaoSelo pessoa={pessoaPor.get(l.solidesId)!} />}
                {fora && <SeloTabela />}
                {pessoaPor.get(l.solidesId)?.avulso && (
                  <span className="ml-2 rounded bg-amber-500/10 px-1.5 text-xs text-amber-800 dark:text-amber-300">
                    {pessoaPor.get(l.solidesId)?.unificarCom ? "na Sólides — unificar" : "fora da Sólides"}
                  </span>
                )}
                <div className="text-xs text-ink-muted">
                  {[pessoaPor.get(l.solidesId)?.cargo, l.setor, l.situacao !== "normal" ? ROTULO_SITUACAO[l.situacao] : null].filter(Boolean).join(" · ") || "—"}
                </div>
              </td>
              <td className={td}>{brl0(l.salarioMes)}</td>
              <td className={td}>{brl0(l.totalEntradas)}</td>
              <td className={td}>{brl0(l.totalDescontos)}</td>
              <td className={td}>{brl0(l.saldo)}</td>
              <td className={td}>{brl0(l.adiantamento)}</td>
              <td className={`${td} font-medium`}>{brl0(l.quintoDiaUtil)}</td>
              <td className={td}>{brl0(l.totalExtras)}</td>
              <td className={td}>{brl0(l.fgts)}</td>
              <td className="py-1.5 text-right font-medium tabular-nums">{brl0(l.totalGeral)}</td>
            </tr>
          );
        })}
        <tr className="font-semibold">
          <td className="py-2 pr-3">Total ({linhas.length})</td>
          <td className={td}>{brl(total.salarioMes)}</td>
          <td className={td}>{brl(total.totalEntradas)}</td>
          <td className={td}>{brl(total.totalDescontos)}</td>
          <td className={td}>{brl(total.saldo)}</td>
          <td className={td}>{brl(total.adiantamento)}</td>
          <td className={td}>{brl(total.quintoDiaUtil)}</td>
          <td className={td}>{brl(total.totalExtras)}</td>
          <td className={td}>{brl(total.fgts)}</td>
          <td className="py-2 text-right tabular-nums">{brl(total.totalGeral)}</td>
        </tr>
      </tbody>
    </table>
  );
}

function TabelaCadastro({
  pessoas,
  parametros,
  onAbrir,
  tabela,
  competencia,
  companyId,
  editavel,
}: {
  pessoas: DpFolhaPessoa[];
  parametros: DpFolhaParametros;
  onAbrir: (id: number) => void;
  tabela: DpFolhaLinhaCargo[];
  competencia: string;
  companyId: string;
  editavel: boolean;
}) {
  return (
    <table className="w-full min-w-[1200px] text-sm">
      <thead className="text-left text-ink-muted">
        <tr className="border-b border-border">
          <th className="py-2 pr-3 font-medium">Colaborador</th>
          <th className="py-2 pr-3 font-medium" title="Escolha outro cargo da tabela salarial para registrar uma promoção">
            Cargo
          </th>
          <th className="py-2 pr-3 font-medium">Plano de saúde</th>
          <th className="py-2 pr-3 text-right font-medium">Odonto</th>
          <th className="py-2 pr-3 text-right font-medium">Alimentação</th>
          <th className="py-2 pr-3 font-medium">Transporte</th>
          <th className="py-2 pr-3 font-medium">Escala</th>
          <th className="py-2 pr-3 text-right font-medium">Dep. IR</th>
          <th className="py-2 pr-3 text-right font-medium">Sal.-família</th>
          <th className="py-2 pr-3 text-right font-medium">Home office</th>
          <th className="py-2 pr-3 font-medium">Adiant.</th>
          <th className="py-2 font-medium">Férias programadas</th>
        </tr>
      </thead>
      <tbody>
        {pessoas.map((p) => {
          const c = p.cadastro;
          const fora = editavel ? p.alertaTabela : null;
          return (
            <tr
              key={p.solidesId}
              className={`cursor-pointer border-b border-border ${fora ? "bg-red-500/10 hover:bg-red-500/15" : "hover:bg-muted/50"}`}
              title={fora ?? undefined}
              onClick={() => onAbrir(p.solidesId)}
            >
              <td className="py-1.5 pr-3">
                <span className="font-medium text-ink-primary">{p.nome}</span>
                {!p.temCadastro && <span className="ml-2 rounded bg-amber-500/10 px-1.5 text-xs text-amber-800 dark:text-amber-300">sem cadastro</span>}
                {fora && <SeloTabela />}
              </td>
              <td className="py-1 pr-3">
                <DpCargoCelula pessoa={p} tabela={tabela} competencia={competencia} companyId={companyId} editavel={editavel} />
              </td>
              <td className="py-1.5 pr-3">
                {ROTULO_PLANO[c.planoSaude]}
                {c.planoDependentes.length > 0 && <span className="text-ink-muted"> + {c.planoDependentes.length} dep.</span>}
              </td>
              <td className="py-1.5 pr-3 text-right tabular-nums">{c.odontoVidas || "—"}</td>
              <td className="py-1.5 pr-3 text-right tabular-nums">{brl0(c.alimentacao)}</td>
              <td className="py-1.5 pr-3">{transporteRotulo(p)}</td>
              <td className="py-1.5 pr-3">
                {c.escala}
                {!parametros.escalas.some((e) => e.nome === c.escala) && <span className="text-amber-700"> (?)</span>}
              </td>
              <td className="py-1.5 pr-3 text-right tabular-nums">{c.dependentesIr || "—"}</td>
              <td className="py-1.5 pr-3 text-right tabular-nums">{c.salarioFamiliaCotas || "—"}</td>
              <td className="py-1.5 pr-3 text-right tabular-nums">{brl0(c.homeOffice)}</td>
              <td className="py-1.5 pr-3">{c.adiantamento ? "Sim" : "—"}</td>
              <td className="py-1.5 text-xs">
                {(c.ferias ?? []).length === 0
                  ? "—"
                  : (c.ferias ?? []).map((f) => `${f.inicio.slice(8, 10)}/${f.inicio.slice(5, 7)}–${f.fim.slice(8, 10)}/${f.fim.slice(5, 7)}`).join(", ")}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

function TabelaBeneficios({ linhas, pessoaPor }: { linhas: DpFolhaResultado[]; pessoaPor: Map<number, DpFolhaPessoa> }) {
  const t = linhas.reduce(
    (a, l) => ({ alim: a.alim + l.alimentacao, tr: a.tr + l.valeTransporte + l.valeGasolina }),
    { alim: 0, tr: 0 },
  );
  return (
    <table className="w-full min-w-[760px] text-sm">
      <thead className="text-left text-ink-muted">
        <tr className="border-b border-border">
          <th className="py-2 pr-3 font-medium">Colaborador</th>
          <th className="py-2 pr-3 font-medium">Centro de custo</th>
          <th className="py-2 pr-3 text-right font-medium">Alimentação</th>
          <th className="py-2 pr-3 font-medium">Transporte</th>
          <th className="py-2 pr-3 text-right font-medium">Valor transporte</th>
          <th className="py-2 text-right font-medium">Total</th>
        </tr>
      </thead>
      <tbody>
        {linhas.map((l) => {
          const p = pessoaPor.get(l.solidesId);
          const tr = l.valeTransporte + l.valeGasolina;
          return (
            <tr key={l.solidesId} className="border-b border-border">
              <td className="py-1.5 pr-3 text-ink-primary">{l.nome}</td>
              <td className="py-1.5 pr-3">{l.centroCusto ?? "—"}</td>
              <td className="py-1.5 pr-3 text-right tabular-nums">{brl0(l.alimentacao)}</td>
              <td className="py-1.5 pr-3">{p ? transporteRotulo(p) : "—"}</td>
              <td className="py-1.5 pr-3 text-right tabular-nums">{brl0(tr)}</td>
              <td className="py-1.5 text-right font-medium tabular-nums">{brl0(l.alimentacao + tr)}</td>
            </tr>
          );
        })}
        <tr className="font-semibold">
          <td className="py-2 pr-3" colSpan={2}>
            Total
          </td>
          <td className="py-2 pr-3 text-right tabular-nums">{brl(t.alim)}</td>
          <td />
          <td className="py-2 pr-3 text-right tabular-nums">{brl(t.tr)}</td>
          <td className="py-2 text-right tabular-nums">{brl(t.alim + t.tr)}</td>
        </tr>
      </tbody>
    </table>
  );
}
