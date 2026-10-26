"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AlertTriangle, ArrowDown, ArrowUp, ArrowUpDown, Copy, Download, Percent, Plus, Search, Trash2, Upload, Wand2, X } from "lucide-react";

import { FilterTable, type FilterColumn } from "@/components/data-table/filter-table";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useToast } from "@/components/ui/toaster";
import {
  apagarTabela,
  aplicarReajuste,
  copiarTabelaDeEmpresa,
  criarLinha,
  excluirLinha,
  importarTabela,
  listarOrigensDeCopia,
  moverLinha,
  ordenarTabela,
  salvarLinha,
  vincularCargosSolides,
  type DpCargoResult,
  type DpImportacaoResultado,
  type DpOrigemCopia,
  type DpPreviaCopia,
} from "@/lib/dp/actions-cargos";
import { chaveNome, nomeCargo, rotuloLinha, ROTULO_ENQUADRAMENTO, SENIORIDADES, STEPS, type DpEnquadramentoStatus } from "@/lib/dp/cargos";
import { definirCentroDaLinha } from "@/lib/dp/actions-cadastro";
import type { DpCargoSolidesUso, DpCargosPagina, DpCentroCusto, DpEnquadramentoRow, DpReajusteRow, DpTabelaLinha } from "@/lib/dp/cargos-queries";
import { formatDateTimeBR } from "@/lib/ctrl/datetime";
import { lerPercentual, lerSalario, previaReajuste } from "@/lib/dp/tabela-salarial";
import { formatBRL } from "@/lib/orcamento/format";

const inputCls = "w-full rounded-md border border-input bg-background px-2 py-1 text-sm disabled:opacity-60";
const botaoCls =
  "inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-sm font-medium text-ink-primary hover:bg-surface-2 disabled:opacity-60";

const fmtSalario = (v: number) => v.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function useAcao() {
  const [pending, start] = useTransition();
  const router = useRouter();
  const { showToast } = useToast();
  const rodar = <T,>(fn: () => Promise<DpCargoResult<T>>, ok?: (d: T) => string | null) =>
    start(async () => {
      const res = await fn();
      if (!res.ok) showToast({ title: "Não salvo", description: res.error, variant: "destructive" });
      else {
        const msg = ok?.(res.data);
        if (msg) showToast({ title: msg, variant: "success" });
      }
      router.refresh();
    });
  return { pending, rodar, showToast, router, start };
}

export function DpCargosClient({ companyId, companyName, pagina }: { companyId: string; companyName: string; pagina: DpCargosPagina }) {
  return (
    <div className="space-y-6">
      <TabelaSalarial companyId={companyId} companyName={companyName} tabela={pagina.tabela} centros={pagina.centros} reajustes={pagina.reajustes} />
      <DeParaSolides companyId={companyId} tabela={pagina.tabela} cargos={pagina.cargosSolides} />
      <Enquadramento rows={pagina.enquadramento} semCargo={pagina.semCargo} />
    </div>
  );
}

// ── 1. Tabela salarial ──────────────────────────────────────────────────────

function TabelaSalarial({
  companyId,
  companyName,
  tabela,
  centros,
  reajustes,
}: {
  companyId: string;
  companyName: string;
  tabela: DpTabelaLinha[];
  centros: DpCentroCusto[];
  reajustes: DpReajusteRow[];
}) {
  const { pending, rodar, showToast, router, start } = useAcao();
  const [busca, setBusca] = useState("");
  const [percentual, setPercentual] = useState("");
  const [importacao, setImportacao] = useState<DpImportacaoResultado | null>(null);
  /** Onde a linha nova está sendo digitada: depois de qual id (null = fim). undefined = nenhuma. */
  const [rascunhoDepoisDe, setRascunhoDepoisDe] = useState<string | null | undefined>(undefined);
  const fileRef = useRef<HTMLInputElement>(null);

  const filtrando = busca.trim().length > 0;
  const visiveis = useMemo(() => {
    const q = chaveNome(busca);
    if (!q) return tabela;
    return tabela.filter((l) => chaveNome(`${l.setor} ${nomeCargo(l)}`).includes(q));
  }, [tabela, busca]);

  const aplicar = () => {
    const lido = lerPercentual(percentual);
    if ("erro" in lido) {
      showToast({ title: "Reajuste não aplicado", description: lido.erro, variant: "destructive" });
      return;
    }
    const p = previaReajuste(
      tabela.map((l) => l.salario),
      lido.ok,
    );
    const ok = window.confirm(
      `Reajustar em ${lido.ok.toLocaleString("pt-BR")}% os ${p.linhas} salários da tabela de ${companyName}?\n\n` +
        `Soma da tabela: ${formatBRL(p.antes)} → ${formatBRL(p.depois)}.\n\nO reajuste fica registrado e não tem desfazer automático.`,
    );
    if (!ok) return;
    rodar(
      () => aplicarReajuste({ companyId, percentual }),
      (d) => {
        setPercentual("");
        return `Reajuste de ${d.percentual.toLocaleString("pt-BR")}% aplicado em ${d.linhas} salários`;
      },
    );
  };

  const importar = (file: File) => {
    const form = new FormData();
    form.set("companyId", companyId);
    form.set("file", file);
    start(async () => {
      const res = await importarTabela(form);
      if (!res.ok) showToast({ title: "Planilha não importada", description: res.error, variant: "destructive" });
      else {
        setImportacao(res.data);
        showToast({ title: "Planilha importada", variant: "success" });
      }
      if (fileRef.current) fileRef.current.value = "";
      router.refresh();
    });
  };

  const ultimo = reajustes[0];

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">Tabela salarial — {companyName}</CardTitle>
        <p className="text-sm text-ink-muted">
          Setor, cargo, senioridade, step e salário — ex.: “Analista de Relacionamento” · Júnior · I. Senioridade e step ficam vazios
          quando o cargo não tem. Todas as células são editáveis e salvam ao sair do campo.
        </p>
      </CardHeader>
      <CardContent className="space-y-3">
        {/* Barra de ações */}
        <div className="flex flex-wrap items-center gap-2">
          <a href={`/api/dp/tabela-salarial/modelo?companyId=${companyId}`} className={botaoCls}>
            <Download className="h-4 w-4" /> Baixar modelo
          </a>
          <button type="button" className={botaoCls} disabled={pending} onClick={() => fileRef.current?.click()}>
            <Upload className="h-4 w-4" /> Importar planilha
          </button>
          <input
            ref={fileRef}
            type="file"
            accept=".xlsx,.xls,.csv"
            className="hidden"
            onChange={(e) => e.target.files?.[0] && importar(e.target.files[0])}
          />
          <CopiarDeEmpresa companyId={companyId} companyName={companyName} />
          <div className="mx-1 h-6 w-px bg-border" />
          <div className="flex items-center gap-1.5">
            <div className="relative">
              <input
                value={percentual}
                onChange={(e) => setPercentual(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && aplicar()}
                inputMode="decimal"
                placeholder="Reajuste"
                className="w-28 rounded-md border border-input bg-background py-1.5 pl-2 pr-7 text-right text-sm"
                aria-label="Percentual de reajuste"
                disabled={pending || tabela.length === 0}
              />
              <Percent className="pointer-events-none absolute right-2 top-2 h-3.5 w-3.5 text-ink-muted" />
            </div>
            <button type="button" className={botaoCls} disabled={pending || tabela.length === 0 || !percentual.trim()} onClick={aplicar}>
              Aplicar a todos
            </button>
          </div>
          <div className="mx-1 h-6 w-px bg-border" />
          <button
            type="button"
            className={botaoCls}
            disabled={pending || tabela.length < 2}
            onClick={() => rodar(() => ordenarTabela({ companyId }), () => "Tabela ordenada por setor e cargo")}
          >
            <ArrowUpDown className="h-4 w-4" /> Ordenar A–Z
          </button>
          <ApagarTudo companyId={companyId} companyName={companyName} tabela={tabela} />
          <div className="relative ml-auto">
            <Search className="pointer-events-none absolute left-2 top-2 h-3.5 w-3.5 text-ink-muted" />
            <input
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
              placeholder="Buscar setor, cargo ou senioridade"
              className="w-60 rounded-md border border-input bg-background py-1.5 pl-7 pr-2 text-sm"
            />
          </div>
        </div>

        {ultimo && (
          <p className="text-xs text-ink-muted">
            Último reajuste: {ultimo.percentual.toLocaleString("pt-BR")}% em {formatDateTimeBR(ultimo.aplicadoEm)}
            {ultimo.aplicadoPor ? ` por ${ultimo.aplicadoPor}` : ""} — {ultimo.linhas} salários, soma {formatBRL(ultimo.totalAntes)} →{" "}
            {formatBRL(ultimo.totalDepois)}.
          </p>
        )}

        {importacao && (
          <div className="rounded-md border border-border bg-surface-2/50 p-3 text-sm">
            <div className="flex items-start justify-between gap-2">
              <p className="text-ink-primary">
                Importação: {importacao.inseridas} linha(s) nova(s), {importacao.atualizadas} salário(s) atualizado(s),{" "}
                {importacao.iguais} sem mudança.
                {importacao.foraDaPlanilha > 0 &&
                  ` ${importacao.foraDaPlanilha} linha(s) da tabela não estavam na planilha e foram mantidas — exclua à mão se não valem mais.`}
              </p>
              <button type="button" onClick={() => setImportacao(null)} className="text-ink-muted hover:text-ink-primary" aria-label="Fechar">
                <X className="h-4 w-4" />
              </button>
            </div>
            {importacao.problemas.length > 0 && (
              <ul className="mt-2 list-disc space-y-0.5 pl-5 text-amber-800 dark:text-amber-300">
                {importacao.problemas.map((p) => (
                  <li key={p}>{p}</li>
                ))}
              </ul>
            )}
          </div>
        )}

        <div className="overflow-x-auto">
          <table className="w-full min-w-[960px] text-sm">
            <thead className="text-left text-ink-muted">
              <tr className="border-b border-border">
                <th className="w-16 py-2 pr-2 font-medium" />
                <th className="py-2 pr-2 font-medium">Setor</th>
                <th className="py-2 pr-2 font-medium">Cargo</th>
                <th className="w-32 py-2 pr-2 font-medium">Senioridade</th>
                <th className="w-24 py-2 pr-2 font-medium">Step</th>
                <th className="w-36 py-2 pr-2 text-right font-medium">Salário</th>
                <th className="w-48 py-2 pr-2 font-medium" title="Centro de custo padrão de quem está nesta linha">
                  Centro de custo
                </th>
                <th className="w-20 py-2 pr-2 text-right font-medium" title="Ativos desta empresa vinculados a esta linha">
                  Pessoas
                </th>
                <th className="w-16 py-2" />
              </tr>
            </thead>
            <tbody>
              {visiveis.map((l, i) => (
                <FragmentoLinha
                  key={`${l.id}:${l.setor}:${l.cargo}:${l.senioridade}:${l.step}:${l.salario}:${l.centroCustoId ?? ""}`}
                  companyId={companyId}
                  centros={centros}
                  linha={l}
                  primeira={i === 0}
                  ultima={i === visiveis.length - 1}
                  podeMover={!filtrando}
                  rascunhoAqui={rascunhoDepoisDe === l.id}
                  abrirRascunho={() => setRascunhoDepoisDe(l.id)}
                  fecharRascunho={() => setRascunhoDepoisDe(undefined)}
                />
              ))}
              {rascunhoDepoisDe === null && (
                <LinhaNova companyId={companyId} depoisDeId={null} fechar={() => setRascunhoDepoisDe(undefined)} />
              )}
              {visiveis.length === 0 && rascunhoDepoisDe === undefined && (
                <tr>
                  <td colSpan={9} className="py-6 text-center text-ink-muted">
                    {tabela.length === 0 ? "Tabela vazia. Importe a planilha ou adicione a primeira linha." : "Nenhuma linha corresponde à busca."}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <div className="flex items-center justify-between">
          <button type="button" className={botaoCls} disabled={pending} onClick={() => setRascunhoDepoisDe(null)}>
            <Plus className="h-4 w-4" /> Adicionar linha
          </button>
          <span className="text-xs text-ink-muted">
            {filtrando ? `${visiveis.length} de ${tabela.length} linhas` : `${tabela.length} linha(s)`}
            {filtrando && " · para mover linhas, limpe a busca"}
          </span>
        </div>
      </CardContent>
    </Card>
  );
}

/**
 * "Copiar de outra empresa": escolhe a empresa de origem, vê a prévia e só
 * então grava. A cópia é aditiva (nada daqui é apagado) e o salário de uma
 * linha que já existe só muda se a caixa for marcada — é o número da outra
 * empresa, e trocá-lo mexe no enquadramento de quem já está na linha.
 */
function CopiarDeEmpresa({ companyId, companyName }: { companyId: string; companyName: string }) {
  const [aberto, setAberto] = useState(false);
  const [origens, setOrigens] = useState<DpOrigemCopia[] | null>(null);
  const [origemId, setOrigemId] = useState("");
  const [atualizar, setAtualizar] = useState(false);
  const [previa, setPrevia] = useState<DpPreviaCopia | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [carregando, startCarga] = useTransition();
  const { pending, showToast, router, start } = useAcao();

  const fechar = (v: boolean) => {
    setAberto(v);
    if (!v) {
      setOrigemId("");
      setAtualizar(false);
      setPrevia(null);
      setErro(null);
    }
  };

  // Lista de origens ao abrir (contagem de linhas por empresa, no servidor).
  useEffect(() => {
    if (!aberto || origens !== null) return;
    startCarga(async () => {
      const res = await listarOrigensDeCopia({ companyId });
      if (res.ok) setOrigens(res.data);
      else setErro(res.error);
    });
  }, [aberto, origens, companyId]);

  // Prévia a cada escolha (empresa ou a caixa de salários): nada é gravado aqui.
  useEffect(() => {
    if (!aberto || !origemId) return;
    startCarga(async () => {
      const res = await copiarTabelaDeEmpresa({ companyId, origemId, atualizarSalarios: atualizar, confirmar: false });
      if (res.ok) {
        setPrevia(res.data);
        setErro(null);
      } else setErro(res.error);
    });
  }, [aberto, origemId, atualizar, companyId]);

  const copiar = () =>
    start(async () => {
      const res = await copiarTabelaDeEmpresa({ companyId, origemId, atualizarSalarios: atualizar, confirmar: true });
      if (!res.ok) {
        showToast({ title: "Tabela não copiada", description: res.error, variant: "destructive" });
        return;
      }
      const d = res.data;
      showToast({
        title: `${d.novas} linha(s) copiada(s) de ${d.origemNome}${d.atualizadas ? ` · ${d.atualizadas} salário(s) atualizado(s)` : ""}`,
        variant: "success",
      });
      fechar(false);
      router.refresh();
    });

  const nada = previa !== null && previa.novas === 0 && previa.atualizadas === 0;

  return (
    <>
      <button type="button" className={botaoCls} disabled={pending} onClick={() => setAberto(true)}>
        <Copy className="h-4 w-4" /> Copiar de outra empresa
      </button>
      <Dialog open={aberto} onOpenChange={(v) => !pending && fechar(v)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Copiar a tabela salarial de outra empresa</DialogTitle>
            <DialogDescription>
              As linhas entram na tabela de <strong>{companyName}</strong>. Nada que já está aqui é apagado.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 text-sm">
            <label className="block space-y-1">
              <span className="text-ink-muted">Copiar de</span>
              <select
                className={inputCls}
                value={origemId}
                onChange={(e) => {
                  setPrevia(null);
                  setAtualizar(false);
                  setOrigemId(e.target.value);
                }}
                disabled={pending || origens === null || origens.length === 0}
                aria-label="Empresa de origem"
              >
                <option value="">{origens === null ? "Carregando empresas…" : "Escolha a empresa…"}</option>
                {(origens ?? []).map((o) => (
                  <option key={o.companyId} value={o.companyId}>
                    {o.nome} — {o.linhas} linha(s)
                  </option>
                ))}
              </select>
            </label>
            {origens !== null && origens.length === 0 && (
              <p className="text-ink-muted">Nenhuma outra empresa que você vê tem tabela salarial cadastrada.</p>
            )}
            {erro && <p className="text-red-700">{erro}</p>}
            {origemId && carregando && !previa && <p className="text-ink-muted">Calculando a prévia…</p>}
            {previa && (
              <div className="space-y-2 rounded-md border border-border px-3 py-2">
                <p>
                  <strong>{previa.novas}</strong> linha(s) nova(s) entram no fim da tabela, na ordem de {previa.origemNome}.
                </p>
                {previa.iguais > 0 && <p className="text-ink-muted">{previa.iguais} já existem aqui com o mesmo salário.</p>}
                {previa.diferentes > 0 && (
                  <div className="space-y-1">
                    <p>
                      {previa.diferentes} já existem aqui com salário <strong>diferente</strong>.
                    </p>
                    <label className="flex items-center gap-2">
                      <input type="checkbox" checked={atualizar} onChange={(e) => setAtualizar(e.target.checked)} disabled={pending} />
                      Trocar pelo salário de {previa.origemNome}
                    </label>
                    {atualizar && (
                      <p className="text-xs text-amber-800 dark:text-amber-300">
                        {previa.atualizadas} salário(s) desta tabela serão substituídos — muda o enquadramento de quem está nessas linhas.
                      </p>
                    )}
                  </div>
                )}
                {previa.soNoDestino > 0 && <p className="text-ink-muted">{previa.soNoDestino} linha(s) que só existem aqui ficam como estão.</p>}
                {previa.comCentro > 0 && <p className="text-ink-muted">{previa.comCentro} das novas levam o centro de custo de mesmo nome que esta empresa já tem.</p>}
                {previa.centrosSemPar.length > 0 && (
                  <p className="text-xs text-amber-800 dark:text-amber-300">
                    Centros de custo de {previa.origemNome} que esta empresa não tem: {previa.centrosSemPar.join(", ")}. As linhas que os
                    usavam entram sem centro — cadastre-o em Configurações › Centros de custo e defina na linha.
                  </p>
                )}
                <p className="text-xs text-ink-muted">
                  O de-para com os cargos da Sólides e o histórico de reajustes são de cada empresa e não vêm junto.
                </p>
              </div>
            )}
          </div>
          <DialogFooter>
            <button type="button" className={botaoCls} disabled={pending} onClick={() => fechar(false)}>
              Cancelar
            </button>
            <button
              type="button"
              disabled={pending || carregando || !previa || nada}
              onClick={copiar}
              className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
            >
              <Copy className="h-4 w-4" />
              {pending ? "Copiando…" : nada ? "Nada a copiar" : `Copiar ${previa?.novas ?? 0} linha(s)${previa?.atualizadas ? ` e atualizar ${previa.atualizadas}` : ""}`}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

const PALAVRA_CONFIRMACAO = "APAGAR";

/**
 * "Apagar todas": apaga a tabela inteira da empresa. É o único gesto do módulo
 * que remove tudo de uma vez e não tem desfazer, por isso o pop-up pede para
 * DIGITAR a palavra (um clique distraído em "Confirmar" não basta), mostra o
 * que se perde e oferece baixar a tabela antes. A action confere a palavra de
 * novo no servidor.
 */
function ApagarTudo({ companyId, companyName, tabela }: { companyId: string; companyName: string; tabela: DpTabelaLinha[] }) {
  const [aberto, setAberto] = useState(false);
  const [texto, setTexto] = useState("");
  const { pending, rodar } = useAcao();
  const pessoas = tabela.reduce((s, l) => s + l.pessoas, 0);
  const liberado = texto.trim().toUpperCase() === PALAVRA_CONFIRMACAO;

  const fechar = (v: boolean) => {
    setAberto(v);
    if (!v) setTexto("");
  };
  const apagar = () =>
    rodar(
      () => apagarTabela({ companyId, confirmacao: texto }),
      (d) => {
        fechar(false);
        return `${d.apagadas} linha(s) apagada(s)`;
      },
    );

  return (
    <>
      <button
        type="button"
        disabled={pending || tabela.length === 0}
        onClick={() => setAberto(true)}
        className="inline-flex items-center gap-1.5 rounded-md border border-red-300 px-3 py-1.5 text-sm font-medium text-red-700 hover:bg-red-50 disabled:opacity-50 dark:border-red-900 dark:text-red-400 dark:hover:bg-red-950/40"
      >
        <Trash2 className="h-4 w-4" /> Apagar todas
      </button>
      <Dialog open={aberto} onOpenChange={fechar}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-red-600" /> Apagar toda a tabela salarial?
            </DialogTitle>
            <DialogDescription>
              Isto apaga as <strong>{tabela.length} linhas</strong> da tabela de <strong>{companyName}</strong>, e não tem como
              desfazer.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 text-sm">
            {pessoas > 0 && (
              <p className="rounded-md border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-amber-900 dark:text-amber-200">
                {pessoas} pessoa(s) estão vinculadas a linhas desta tabela e voltarão a ficar sem linha — o de-para com a
                Sólides desta empresa também é apagado.
              </p>
            )}
            <p className="text-ink-muted">
              Se quiser guardar uma cópia antes,{" "}
              <a href={`/api/dp/tabela-salarial/modelo?companyId=${companyId}`} className="font-medium text-ink-primary underline">
                baixe a tabela atual
              </a>
              . O histórico de reajustes é mantido.
            </p>
            <label className="block">
              <span className="text-ink-muted">
                Para confirmar, digite <strong className="text-ink-primary">{PALAVRA_CONFIRMACAO}</strong>:
              </span>
              <input
                autoFocus
                value={texto}
                onChange={(e) => setTexto(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && liberado && apagar()}
                className="mt-1 w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm"
                disabled={pending}
                aria-label={`Digite ${PALAVRA_CONFIRMACAO} para confirmar`}
              />
            </label>
          </div>
          <DialogFooter>
            <button type="button" className={botaoCls} disabled={pending} onClick={() => fechar(false)}>
              Cancelar
            </button>
            <button
              type="button"
              disabled={pending || !liberado}
              onClick={apagar}
              className="inline-flex items-center gap-1.5 rounded-md bg-red-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50"
            >
              <Trash2 className="h-4 w-4" /> {pending ? "Apagando…" : `Apagar ${tabela.length} linhas`}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function FragmentoLinha(props: {
  companyId: string;
  centros: DpCentroCusto[];
  linha: DpTabelaLinha;
  primeira: boolean;
  ultima: boolean;
  podeMover: boolean;
  rascunhoAqui: boolean;
  abrirRascunho: () => void;
  fecharRascunho: () => void;
}) {
  return (
    <>
      <LinhaEditavel {...props} />
      {props.rascunhoAqui && <LinhaNova companyId={props.companyId} depoisDeId={props.linha.id} fechar={props.fecharRascunho} />}
    </>
  );
}

function LinhaEditavel({
  companyId,
  centros,
  linha,
  primeira,
  ultima,
  podeMover,
  abrirRascunho,
}: {
  companyId: string;
  centros: DpCentroCusto[];
  linha: DpTabelaLinha;
  primeira: boolean;
  ultima: boolean;
  podeMover: boolean;
  abrirRascunho: () => void;
}) {
  const [setor, setSetor] = useState(linha.setor);
  const [cargo, setCargo] = useState(linha.cargo);
  const [senioridade, setSenioridade] = useState(linha.senioridade);
  const [step, setStep] = useState(linha.step);
  const [salario, setSalario] = useState(fmtSalario(linha.salario));
  const { pending, rodar, showToast } = useAcao();

  /** As listas salvam na escolha: o valor novo vem por parâmetro, porque o estado ainda não mudou. */
  const salvar = (escolha?: { senioridade?: string; step?: string }) => {
    const sen = escolha?.senioridade ?? senioridade;
    const st = escolha?.step ?? step;
    const v = lerSalario(salario);
    if (v === null || v < 0) {
      showToast({ title: "Salário inválido", description: "Use um valor como 3.500,00.", variant: "destructive" });
      setSalario(fmtSalario(linha.salario));
      return;
    }
    if (!cargo.trim()) {
      showToast({ title: "Cargo obrigatório", variant: "destructive" });
      setCargo(linha.cargo);
      return;
    }
    const mudou =
      setor.trim() !== linha.setor ||
      cargo.trim() !== linha.cargo ||
      sen !== linha.senioridade ||
      st !== linha.step ||
      Math.abs(v - linha.salario) >= 0.005;
    if (mudou) rodar(() => salvarLinha({ companyId, id: linha.id, setor, cargo, senioridade: sen, step: st, salario: v }));
  };
  const onKey = (e: React.KeyboardEvent<HTMLInputElement>) => e.key === "Enter" && e.currentTarget.blur();

  return (
    <tr className="border-b border-border/60">
      <td className="py-1 pr-2">
        <div className="flex">
          <button
            type="button"
            disabled={pending || !podeMover || primeira}
            onClick={() => rodar(() => moverLinha({ companyId, id: linha.id, direcao: "cima" }))}
            className="rounded p-1 text-ink-muted hover:text-ink-primary disabled:opacity-30"
            aria-label="Subir linha"
          >
            <ArrowUp className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            disabled={pending || !podeMover || ultima}
            onClick={() => rodar(() => moverLinha({ companyId, id: linha.id, direcao: "baixo" }))}
            className="rounded p-1 text-ink-muted hover:text-ink-primary disabled:opacity-30"
            aria-label="Descer linha"
          >
            <ArrowDown className="h-3.5 w-3.5" />
          </button>
        </div>
      </td>
      <td className="py-1 pr-2">
        <input value={setor} onChange={(e) => setSetor(e.target.value)} onBlur={() => salvar()} onKeyDown={onKey} className={inputCls} disabled={pending} aria-label="Setor" />
      </td>
      <td className="py-1 pr-2">
        <input value={cargo} onChange={(e) => setCargo(e.target.value)} onBlur={() => salvar()} onKeyDown={onKey} className={inputCls} disabled={pending} aria-label="Cargo" />
      </td>
      <td className="py-1 pr-2">
        <SelectSenioridade
          value={senioridade}
          disabled={pending}
          onChange={(v) => {
            setSenioridade(v);
            salvar({ senioridade: v });
          }}
        />
      </td>
      <td className="py-1 pr-2">
        <SelectStep
          value={step}
          disabled={pending}
          onChange={(v) => {
            setStep(v);
            salvar({ step: v });
          }}
        />
      </td>
      <td className="py-1 pr-2">
        <input
          value={salario}
          onChange={(e) => setSalario(e.target.value)}
          onBlur={() => salvar()}
          onKeyDown={onKey}
          inputMode="decimal"
          className={`${inputCls} text-right tabular-nums`}
          disabled={pending}
          aria-label="Salário"
        />
      </td>
      <td className="py-1 pr-2">
        <select
          value={linha.centroCustoId ?? ""}
          disabled={pending || centros.length === 0}
          onChange={(e) => rodar(() => definirCentroDaLinha({ companyId, linhaId: linha.id, centroId: e.target.value || null }))}
          className={inputCls}
          aria-label="Centro de custo padrão"
          title={centros.length === 0 ? "Cadastre os centros de custo desta empresa primeiro" : undefined}
        >
          <option value="">—</option>
          {centros.map((c) => (
            <option key={c.id} value={c.id}>
              {c.codigo ? `${c.codigo} · ${c.nome}` : c.nome}
            </option>
          ))}
        </select>
      </td>
      <td className="py-1 pr-2 text-right tabular-nums text-ink-muted">{linha.pessoas || "—"}</td>
      <td className="py-1">
        <div className="flex justify-end">
          <button type="button" onClick={abrirRascunho} disabled={pending} className="rounded p-1 text-ink-muted hover:text-ink-primary" aria-label="Inserir linha abaixo" title="Inserir linha abaixo">
            <Plus className="h-4 w-4" />
          </button>
          <button
            type="button"
            disabled={pending}
            onClick={() => {
              const aviso = linha.pessoas > 0 ? `\n\n${linha.pessoas} pessoa(s) estão vinculadas a ela e ficarão sem linha na tabela.` : "";
              if (window.confirm(`Excluir a linha "${rotuloLinha(linha)}"?${aviso}`)) rodar(() => excluirLinha({ companyId, id: linha.id }));
            }}
            className="rounded p-1 text-ink-muted hover:text-red-600"
            aria-label="Excluir linha"
          >
            <Trash2 className="h-4 w-4" />
          </button>
        </div>
      </td>
    </tr>
  );
}

/** Senioridade da linha: vazia (o cargo não tem) ou uma das três. */
function SelectSenioridade({ value, onChange, disabled }: { value: string; onChange: (v: string) => void; disabled?: boolean }) {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)} disabled={disabled} className={inputCls} aria-label="Senioridade">
      <option value="">—</option>
      {SENIORIDADES.map((s) => (
        <option key={s} value={s}>
          {s}
        </option>
      ))}
    </select>
  );
}

/** Step da linha: vazio ou um romano. Mostra I a X; um step acima disso (aceito na planilha) aparece se já estiver gravado. */
function SelectStep({ value, onChange, disabled }: { value: string; onChange: (v: string) => void; disabled?: boolean }) {
  const opcoes: string[] = STEPS.slice(0, 10);
  if (value && !opcoes.includes(value)) opcoes.push(value);
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)} disabled={disabled} className={inputCls} aria-label="Step">
      <option value="">—</option>
      {opcoes.map((s) => (
        <option key={s} value={s}>
          {s}
        </option>
      ))}
    </select>
  );
}

function LinhaNova({ companyId, depoisDeId, fechar }: { companyId: string; depoisDeId: string | null; fechar: () => void }) {
  const [setor, setSetor] = useState("");
  const [cargo, setCargo] = useState("");
  const [senioridade, setSenioridade] = useState("");
  const [step, setStep] = useState("");
  const [salario, setSalario] = useState("");
  const { pending, rodar, showToast } = useAcao();
  const salvar = () => {
    const v = lerSalario(salario);
    if (!cargo.trim() || v === null || v < 0) {
      showToast({ title: "Preencha o cargo e o salário", variant: "destructive" });
      return;
    }
    rodar(() => criarLinha({ companyId, setor, cargo, senioridade, step, salario: v, depoisDeId }), () => {
      fechar();
      return null;
    });
  };
  const onKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") salvar();
    if (e.key === "Escape") fechar();
  };
  return (
    <tr className="border-b border-border/60 bg-sky-500/5">
      <td className="py-1 pr-2 text-xs text-ink-muted">nova</td>
      <td className="py-1 pr-2">
        <input autoFocus value={setor} onChange={(e) => setSetor(e.target.value)} onKeyDown={onKey} placeholder="Setor" className={inputCls} disabled={pending} />
      </td>
      <td className="py-1 pr-2">
        <input value={cargo} onChange={(e) => setCargo(e.target.value)} onKeyDown={onKey} placeholder="Cargo (ex.: Analista de Relacionamento)" className={inputCls} disabled={pending} />
      </td>
      <td className="py-1 pr-2">
        <SelectSenioridade value={senioridade} onChange={setSenioridade} disabled={pending} />
      </td>
      <td className="py-1 pr-2">
        <SelectStep value={step} onChange={setStep} disabled={pending} />
      </td>
      <td className="py-1 pr-2">
        <input value={salario} onChange={(e) => setSalario(e.target.value)} onKeyDown={onKey} placeholder="0,00" inputMode="decimal" className={`${inputCls} text-right`} disabled={pending} />
      </td>
      <td />
      <td />
      <td className="py-1">
        <div className="flex justify-end gap-1">
          <button type="button" onClick={salvar} disabled={pending} className="rounded px-2 py-1 text-xs font-medium text-ink-primary hover:bg-surface-2">
            Salvar
          </button>
          <button type="button" onClick={fechar} disabled={pending} className="rounded p-1 text-ink-muted hover:text-ink-primary" aria-label="Cancelar">
            <X className="h-4 w-4" />
          </button>
        </div>
      </td>
    </tr>
  );
}

// ── 2. De-para Sólides → linha da tabela ────────────────────────────────────

function DeParaSolides({ companyId, tabela, cargos }: { companyId: string; tabela: DpTabelaLinha[]; cargos: DpCargoSolidesUso[] }) {
  const { pending, rodar } = useAcao();
  const rotulo = useMemo(
    () => new Map(tabela.map((l) => [l.id, `${rotuloLinha(l)} (${formatBRL(l.salario)})`])),
    [tabela],
  );
  // Opções agrupadas por setor, na ordem da tabela.
  const grupos = useMemo(() => {
    const m = new Map<string, DpTabelaLinha[]>();
    for (const l of tabela) m.set(l.setor || "Sem setor", [...(m.get(l.setor || "Sem setor") ?? []), l]);
    return Array.from(m);
  }, [tabela]);
  const pendentes = cargos.filter((c) => !c.linhaId).length;
  const sugestoes = cargos.filter((c) => !c.linhaId && c.sugestaoLinhaId);

  const gravar = (itens: Array<{ solidesCargoId: number; solidesCargoNome: string; linhaId: string | null }>, ok?: string) =>
    rodar(() => vincularCargosSolides({ companyId, itens }), () => ok ?? null);

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <CardTitle className="text-base">
              Cargos da Sólides nesta empresa
              {pendentes > 0 && <span className="ml-2 text-sm font-normal text-amber-700 dark:text-amber-400">{pendentes} sem linha</span>}
            </CardTitle>
            <p className="text-sm text-ink-muted">
              A qual linha da tabela cada cargo da Sólides corresponde. Vale para todos desta empresa com aquele cargo.
            </p>
          </div>
          {sugestoes.length > 0 && (
            <button
              type="button"
              disabled={pending}
              onClick={() =>
                gravar(
                  sugestoes.map((s) => ({ solidesCargoId: s.solidesCargoId, solidesCargoNome: s.nome, linhaId: s.sugestaoLinhaId })),
                  `${sugestoes.length} sugestão(ões) aplicada(s)`,
                )
              }
              className={botaoCls}
            >
              <Wand2 className="h-4 w-4" /> Aplicar {sugestoes.length} sugestão(ões)
            </button>
          )}
        </div>
      </CardHeader>
      <CardContent>
        {cargos.length === 0 ? (
          <p className="text-sm text-ink-muted">Nenhum colaborador ativo desta empresa tem cargo na Sólides.</p>
        ) : tabela.length === 0 ? (
          <p className="text-sm text-ink-muted">Monte a tabela acima para poder vincular os {cargos.length} cargos da Sólides.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-sm">
              <thead className="text-left text-ink-muted">
                <tr className="border-b border-border">
                  <th className="py-2 pr-3 font-medium">Cargo na Sólides</th>
                  <th className="py-2 pr-3 text-right font-medium">Pessoas</th>
                  <th className="py-2 font-medium">Linha da tabela</th>
                </tr>
              </thead>
              <tbody>
                {cargos.map((c) => (
                  <tr key={c.solidesCargoId} className={`border-b border-border last:border-0 ${c.linhaId ? "" : "bg-amber-500/5"}`}>
                    <td className="py-1.5 pr-3 text-ink-primary">{c.nome}</td>
                    <td className="py-1.5 pr-3 text-right tabular-nums">{c.colaboradores}</td>
                    <td className="py-1.5">
                      <select
                        value={c.linhaId ?? ""}
                        disabled={pending}
                        onChange={(e) => gravar([{ solidesCargoId: c.solidesCargoId, solidesCargoNome: c.nome, linhaId: e.target.value || null }])}
                        className="w-full max-w-lg rounded-md border border-input bg-background px-2 py-1 text-sm"
                        aria-label={`Linha da tabela para ${c.nome}`}
                      >
                        <option value="">— sem linha —</option>
                        {grupos.map(([setor, ls]) => (
                          <optgroup key={setor} label={setor}>
                            {ls.map((l) => (
                              <option key={l.id} value={l.id}>
                                {nomeCargo(l)} ({formatBRL(l.salario)})
                              </option>
                            ))}
                          </optgroup>
                        ))}
                      </select>
                      {!c.linhaId && c.sugestaoLinhaId && (
                        <p className="mt-0.5 text-xs text-ink-muted">Sugestão pelo nome: {rotulo.get(c.sugestaoLinhaId)}</p>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ── 3. Enquadramento ───────────────────────────────────────────────────────

const STATUS_ORDEM: DpEnquadramentoStatus[] = ["abaixo", "acima", "no_nivel", "sem_salario", "sem_vinculo", "sem_empresa"];

function textoDiferenca(r: DpEnquadramentoRow): string {
  const d = r.enquadramento.diferenca;
  if (d === null) return "—";
  const p = r.enquadramento.percentual;
  return `${formatBRL(d)}${p === null ? "" : ` (${p > 0 ? "+" : ""}${p.toLocaleString("pt-BR")}%)`}`;
}

function Enquadramento({ rows, semCargo }: { rows: DpEnquadramentoRow[]; semCargo: number }) {
  const columns = useMemo<FilterColumn<DpEnquadramentoRow>[]>(
    () => [
      {
        key: "nome",
        label: "Nome",
        plain: (r) => r.nome,
        sortVal: (r) => r.nome.toLowerCase(),
        cell: (r) => (
          <Link href={`/dp/colaboradores/${r.colaboradorId}`} className="font-medium text-ink-primary hover:underline">
            {r.nome}
          </Link>
        ),
      },
      { key: "cargo", label: "Cargo na Sólides", plain: (r) => r.cargoSolides ?? "—", sortVal: (r) => (r.cargoSolides ?? "").toLowerCase() },
      {
        key: "linha",
        label: "Linha da tabela",
        plain: (r) => (r.linhaRotulo ? `${r.linhaRotulo}${r.origemLinha === "excecao" ? " (exceção)" : ""}` : "—"),
        sortVal: (r) => (r.linhaRotulo ?? "").toLowerCase(),
        cell: (r) =>
          r.linhaRotulo ? (
            <span>
              {r.linhaRotulo}
              {r.origemLinha === "excecao" && (
                <span className="ml-1.5 rounded bg-amber-500/10 px-1 py-0.5 text-xs text-amber-800 dark:text-amber-300">exceção</span>
              )}
            </span>
          ) : (
            "—"
          ),
      },
      {
        key: "centro",
        label: "Centro de custo",
        plain: (r) => r.centroCusto ?? "—",
        sortVal: (r) => (r.centroCusto ?? "").toLowerCase(),
        cell: (r) =>
          r.centroCusto ? (
            <span>
              {r.centroCusto}
              {r.origemCentro === "excecao" && (
                <span className="ml-1.5 rounded bg-amber-500/10 px-1 py-0.5 text-xs text-amber-800 dark:text-amber-300">exceção</span>
              )}
            </span>
          ) : (
            "—"
          ),
      },
      {
        key: "salario",
        label: "Salário",
        kind: "number",
        align: "right",
        plain: (r) => (r.salario === null ? "—" : formatBRL(r.salario)),
        sortVal: (r) => r.salario ?? -1,
        numeric: (r) => r.salario,
      },
      {
        key: "salarioTabela",
        label: "Salário da tabela",
        kind: "number",
        align: "right",
        plain: (r) => (r.salarioTabela === null ? "—" : formatBRL(r.salarioTabela)),
        sortVal: (r) => r.salarioTabela ?? -1,
        numeric: (r) => r.salarioTabela,
      },
      {
        key: "diferenca",
        label: "Diferença",
        kind: "number",
        align: "right",
        plain: textoDiferenca,
        sortVal: (r) => r.enquadramento.percentual ?? -9999,
        numeric: (r) => r.enquadramento.diferenca,
        cell: (r) => {
          const cor = r.alertaTabela ? "font-medium text-red-700 dark:text-red-400" : "";
          return <span className={`tabular-nums ${cor}`}>{textoDiferenca(r)}</span>;
        },
      },
      {
        key: "situacao",
        label: "Situação",
        plain: (r) => ROTULO_ENQUADRAMENTO[r.enquadramento.status],
        sortVal: (r) => STATUS_ORDEM.indexOf(r.enquadramento.status),
      },
    ],
    [],
  );

  const conta = new Map<DpEnquadramentoStatus, number>();
  for (const r of rows) conta.set(r.enquadramento.status, (conta.get(r.enquadramento.status) ?? 0) + 1);

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">Enquadramento</CardTitle>
        <p className="text-sm text-ink-muted">
          {STATUS_ORDEM.filter((s) => conta.get(s))
            .map((s) => `${conta.get(s)} ${ROTULO_ENQUADRAMENTO[s].toLowerCase()}`)
            .join(" · ") || "Nenhum colaborador ativo nesta empresa."}
          {semCargo > 0 && ` · ${semCargo} sem cargo na Sólides`}
        </p>
      </CardHeader>
      <CardContent>
        <FilterTable
          rows={rows}
          columns={columns}
          rowKey={(r) => r.colaboradorId}
          rowClassName={(r) => (r.alertaTabela ? "bg-red-500/10" : undefined)}
          emptyMessage="Nenhum colaborador ativo nesta empresa."
        />
        <p className="mt-2 text-xs text-ink-muted">
          Salário é o cadastrado na Sólides; o da tabela é o da linha vinculada. Diferença de menos de R$ 1 conta como “no salário da
          tabela”. Acima ou abaixo da tabela fica em vermelho — aqui, na lista de colaboradores e na folha. A Sólides manda: o sistema
          não muda o salário, e o vermelho some quando a sincronização trouxer o valor da tabela (ou quando a linha da pessoa for
          corrigida, se o erro era o vínculo).
        </p>
      </CardContent>
    </Card>
  );
}
