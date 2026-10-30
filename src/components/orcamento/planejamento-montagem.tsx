"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { AlertTriangle, ArrowLeft, Loader2, Tags } from "lucide-react";

import {
  getPlanejamentoMontagem,
  getPreviaSetor,
  type PlanejamentoMontagemDetalhe,
  type PreviaSetorResumo,
} from "@/lib/orcamento/actions/planejamento-categoria";
import {
  getPlanejamentoPendentes,
  type PlanejamentoPendente,
} from "@/lib/orcamento/actions/planejamento";
import { formatBRL } from "@/lib/orcamento/format";
import { BotaoFinalizar } from "@/components/orcamento/botao-finalizar";
import { getFinalizacoes } from "@/lib/orcamento/actions/finalizacao";
import { finalizacaoDe, indexarFinalizacoes, type Finalizacao } from "@/lib/orcamento/finalizacao";
import { planejamentoCategoriaHref, workspaceTabHref } from "@/lib/orcamento/workspace-tabs";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { PlanejamentoBaseEditor } from "@/components/orcamento/planejamento-base-editor";
import { PlanejamentoDespesas } from "@/components/orcamento/planejamento-despesas";
import { PlanejamentoEntrevista } from "@/components/orcamento/planejamento-entrevista";
import { PlanejamentoPreviaSetor } from "@/components/orcamento/planejamento-previa-setor";
import { cn } from "@/lib/utils";

/**
 * Tela de MONTAGEM de uma categoria do Planejamento dos gestores.
 *
 * Três blocos, nesta ordem de leitura: a BASE (o que saiu no ano anterior, e
 * que o administrador cura), a ENTREVISTA com a IA e as DESPESAS que saem dela
 * — com a PRÉVIA DO SETOR embaixo, se preenchendo a cada despesa confirmada.
 *
 * O setor vem da query (`?setor=`), não da rota: a categoria é a mesma, o que
 * muda é de qual setor é este orçamento. Quando o usuário alcança um setor só,
 * ele é escolhido sozinho e o seletor nem aparece.
 */
export function PlanejamentoMontagem({
  companyId,
  year,
  categoryCode,
}: {
  companyId: string;
  year: number;
  categoryCode: string;
}) {
  const router = useRouter();
  const params = useSearchParams();
  const setorDaUrl = params.get("setor");

  const [detalhe, setDetalhe] = useState<PlanejamentoMontagemDetalhe | null>(null);
  const [finalizacoes, setFinalizacoes] = useState<Finalizacao[]>([]);
  const [previa, setPrevia] = useState<PreviaSetorResumo | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [carregandoPrevia, setCarregandoPrevia] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [needsMigration, setNeedsMigration] = useState(false);
  // O que ainda falta finalizar, depois de um Finalizar que deu certo. `null` =
  // caixa fechada.
  const [faltam, setFaltam] = useState<{
    pendentes: PlanejamentoPendente[];
    proxima: PlanejamentoPendente | null;
  } | null>(null);

  const recarregar = useCallback(async () => {
    const res = await getPlanejamentoMontagem(companyId, year, categoryCode, setorDaUrl);
    if (res.needsMigration) {
      setNeedsMigration(true);
      setCarregando(false);
      return null;
    }
    if (res.error || !res.data) {
      setErro(res.error ?? "Não consegui carregar esta categoria.");
      setCarregando(false);
      return null;
    }
    setErro(null);
    setDetalhe(res.data);
    setCarregando(false);
    // A fatia fechada trava a montagem inteira desta categoria neste setor.
    void getFinalizacoes(companyId, year).then((f) => setFinalizacoes(f.items));
    return res.data;
  }, [companyId, year, categoryCode, setorDaUrl]);

  const recarregarPrevia = useCallback(
    async (setorId: string | null, categoriaNome: string) => {
      setCarregandoPrevia(true);
      const res = await getPreviaSetor(companyId, year, setorId, categoriaNome);
      setCarregandoPrevia(false);
      if (res.data) setPrevia(res.data);
    },
    [companyId, year],
  );

  useEffect(() => {
    setCarregando(true);
    void recarregar().then((d) => {
      if (d && d.orcaPorSetor && (d.setorId !== null || d.setores.length > 0)) {
        void recarregarPrevia(d.setorId, d.categoryName);
      }
    });
  }, [recarregar, recarregarPrevia]);

  /** Depois de mexer no orçamento: recarrega o detalhe E a prévia. */
  const aposMudanca = useCallback(() => {
    void recarregar().then((d) => {
      if (d?.orcaPorSetor) void recarregarPrevia(d.setorId, d.categoryName);
    });
  }, [recarregar, recarregarPrevia]);

  /**
   * Depois de FINALIZAR: se ainda há categoria em aberto no Planejamento, a
   * caixa diz quais e oferece seguir para a próxima. Tudo fechado = sem caixa
   * (o aviso do botão já diz o que foi publicado). Falha na leitura também não
   * abre nada: a finalização deu certo, e a caixa é só o atalho para a próxima.
   */
  const aposFinalizar = useCallback(async () => {
    if (!detalhe) return;
    const res = await getPlanejamentoPendentes(companyId, year, {
      categoryCode,
      categoryName: detalhe.categoryName,
      setorId: detalhe.setorId,
      setorNome: detalhe.setorNome,
    });
    if (res.error || !res.pendentes || res.pendentes.length === 0) return;
    setFaltam({ pendentes: res.pendentes, proxima: res.proxima ?? null });
  }, [companyId, year, categoryCode, detalhe]);

  function seguirParaProxima() {
    const proxima = faltam?.proxima;
    setFaltam(null);
    if (!proxima) return;
    const base = planejamentoCategoriaHref(companyId, year, proxima.categoryCode);
    // Com setor, abre direto no setor que falta — sem ele a montagem pediria
    // para escolher, e poderia abrir num setor já finalizado.
    router.push(proxima.setorId ? `${base}?setor=${encodeURIComponent(proxima.setorId)}` : base);
  }

  if (needsMigration) {
    return (
      <div className="rounded-lg border border-amber-500/40 bg-amber-500/5 p-4 text-sm">
        <p className="font-medium">Migration pendente</p>
        <p className="mt-1 text-muted-foreground">
          As tabelas do Planejamento dos gestores ainda não foram aplicadas no banco.
        </p>
      </div>
    );
  }

  if (carregando && !detalhe) {
    return (
      <div className="flex items-center justify-center gap-2 rounded-lg border p-12 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> Carregando categoria…
      </div>
    );
  }

  if (erro || !detalhe) {
    return (
      <div className="space-y-3">
        <Voltar companyId={companyId} year={year} />
        <p className="text-sm text-destructive">{erro ?? "Categoria indisponível."}</p>
      </div>
    );
  }

  const precisaEscolherSetor = detalhe.setorId === null && detalhe.setores.length > 1;
  const semSetor = detalhe.setores.length === 0;

  return (
    <div className="space-y-4">
      <Voltar companyId={companyId} year={year} />

      {/* ── Cabeçalho ──────────────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-xl font-bold tracking-tight">{detalhe.categoryName}</h2>
          <p className="text-sm text-muted-foreground">
            {detalhe.dreLineCode} · {detalhe.dreLineName}
            {detalhe.setorNome ? ` · ${detalhe.setorNome}` : ""}
          </p>
        </div>
        <div className="flex items-start gap-4">
          {detalhe.realizadoAnterior && (
            <div className="text-right">
              <div className="text-xs text-muted-foreground">Gasto em {year - 1}</div>
              <div className="font-semibold tabular-nums">
                {formatBRL(detalhe.realizadoAnterior.total)}
              </div>
            </div>
          )}
          {/* FINALIZAR esta categoria neste setor: trava a edição e manda o
              aprovado para o Budget do Financeiro. Sem setor resolvido não há
              fatia a fechar. */}
          {!precisaEscolherSetor && (
            <BotaoFinalizar
              companyId={companyId}
              year={year}
              metodo="planejamento_socios"
              categoryCode={categoryCode}
              setorId={detalhe.setorFinalizacao}
              rotulo={detalhe.categoryName}
              finalizacao={finalizacaoDe(indexarFinalizacoes(finalizacoes), {
                metodo: "planejamento_socios",
                categoryCode,
                setorId: detalhe.setorFinalizacao,
              })}
              isAdmin={detalhe.isAdmin}
              onMudou={() => void recarregar()}
              onFinalizou={() => void aposFinalizar()}
            />
          )}
        </div>
      </div>

      <Dialog open={faltam !== null} onOpenChange={(aberto) => !aberto && setFaltam(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Ainda há categorias em aberto</DialogTitle>
            <DialogDescription>
              {faltam?.pendentes.length === 1 ? (
                <>
                  Ainda falta finalizar a categoria{" "}
                  <strong className="text-foreground">&quot;{faltam.pendentes[0].rotulo}&quot;</strong>.
                </>
              ) : (
                <>Ainda faltam {faltam?.pendentes.length} categorias para finalizar:</>
              )}
            </DialogDescription>
          </DialogHeader>
          {faltam && faltam.pendentes.length > 1 && (
            <ul className="max-h-48 space-y-1 overflow-y-auto rounded-md border bg-muted/20 px-3 py-2 text-sm">
              {faltam.pendentes.map((p) => (
                <li
                  key={`${p.categoryCode}|${p.setorId ?? ""}`}
                  className={cn(
                    p.categoryCode === faltam.proxima?.categoryCode &&
                      p.setorId === faltam.proxima?.setorId &&
                      "font-semibold",
                  )}
                >
                  {p.rotulo}
                </li>
              ))}
            </ul>
          )}
          <DialogFooter className="gap-2 sm:gap-0">
            <button
              type="button"
              onClick={() => setFaltam(null)}
              className="rounded-md border px-3 py-1.5 text-sm hover:bg-muted"
            >
              Continuar depois
            </button>
            {faltam?.proxima && (
              <button
                type="button"
                onClick={seguirParaProxima}
                className="rounded-md bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-700"
              >
                Seguir para a próxima: {faltam.proxima.rotulo}
              </button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Grupos disponíveis ─────────────────────────────────────────────── */}
      {/* Empresa com a chave dos grupos DESLIGADA não mostra nem a faixa nem o
          aviso: ali o aviso mandaria cadastrar grupos que o admin acabou de
          desativar, e o gestor pediria a ele um cadastro que não deve existir.
          Ligar/desligar é em Configuração da empresa › Grupos de despesa. */}
      {detalhe.usaGrupos &&
        (detalhe.grupos.length > 0 ? (
        <div className="flex flex-wrap items-center gap-1.5 rounded-lg border bg-muted/20 px-3 py-2">
          <span className="inline-flex items-center gap-1 text-xs font-medium text-muted-foreground">
            <Tags className="h-3.5 w-3.5" /> Grupos disponíveis:
          </span>
          {detalhe.grupos.map((g) => (
            <span
              key={g.id}
              className="rounded-full border bg-background px-2 py-0.5 text-[11px]"
            >
              {g.name}
            </span>
          ))}
          {/* O cadastro fica em Configuração › Grupos de despesas, e ninguém o
              acha estando aqui — é aqui que a falta dele aparece. */}
          {detalhe.isAdmin && (
            <Link
              href="/orcamento/configuracoes-gerais"
              className="ml-1 text-[11px] font-medium text-emerald-700 underline-offset-2 hover:underline"
            >
              cadastrar grupos
            </Link>
          )}
        </div>
      ) : (
        <div className="flex items-start gap-2 rounded-lg border border-amber-500/40 bg-amber-500/5 px-3 py-2 text-xs">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-600" />
          <span>
            Esta empresa ainda não tem <strong>grupos de despesas</strong> cadastrados — as despesas
            vão cair em &quot;Sem grupo&quot; na prévia, e a IA não vai ter o que perguntar.{" "}
            {detalhe.isAdmin ? (
              <Link
                href="/orcamento/configuracoes-gerais"
                className="font-medium text-amber-900 underline underline-offset-2"
              >
                Cadastrar em Configurações gerais › Grupos de despesas
              </Link>
            ) : (
              <>
                O administrador cadastra em{" "}
                <strong>Configurações gerais › Grupos de despesas</strong>.
              </>
            )}
          </span>
        </div>
        ))}

      {/* ── Seletor de setor ───────────────────────────────────────────────── */}
      {detalhe.setores.length > 1 && (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-xs font-medium text-muted-foreground">Setor:</span>
          {detalhe.setores.map((s) => (
            <button
              key={s.id ?? "nulo"}
              onClick={() =>
                router.replace(
                  `?setor=${encodeURIComponent(s.id ?? "")}`,
                  { scroll: false },
                )
              }
              className={cn(
                "rounded-full border px-3 py-1 text-xs transition-colors",
                detalhe.setorId === s.id
                  ? "border-emerald-600 bg-emerald-600 text-white"
                  : "bg-background hover:bg-muted",
              )}
            >
              {s.name}
              {!s.podeEscrever && " (leitura)"}
            </button>
          ))}
        </div>
      )}

      {semSetor ? (
        <div className="rounded-lg border border-dashed p-10 text-center text-sm text-muted-foreground">
          Esta categoria não está atribuída a nenhum setor que você alcança. O administrador define
          isso em <strong>Configuração › Método por categoria</strong>.
        </div>
      ) : precisaEscolherSetor ? (
        <div className="rounded-lg border border-dashed p-10 text-center text-sm text-muted-foreground">
          Escolha o setor acima para montar o orçamento desta categoria. Cada setor tem a própria
          base, a própria conversa e as próprias despesas.
        </div>
      ) : (
        <>
          <PlanejamentoBaseEditor
            companyId={companyId}
            year={year}
            categoryCode={categoryCode}
            categoryName={detalhe.categoryName}
            setorId={detalhe.setorId}
            base={detalhe.base}
            baseSalva={detalhe.baseSalva}
            contextoAdmin={detalhe.contextoAdmin}
            grupos={detalhe.grupos}
            usaGrupos={detalhe.usaGrupos}
            isAdmin={detalhe.isAdmin}
            onMudou={aposMudanca}
          />

          <div className="grid gap-4 lg:grid-cols-2">
            <PlanejamentoEntrevista
              companyId={companyId}
              year={year}
              categoryCode={categoryCode}
              categoryName={detalhe.categoryName}
              setorId={detalhe.setorId}
              conversa={detalhe.conversa}
              justificativa={detalhe.justificativa}
              grupos={detalhe.grupos}
              baseSalva={detalhe.baseSalva}
              podeEscrever={detalhe.podeEscrever}
              realizadoMeses={detalhe.realizadoAnterior?.meses ?? null}
              onDespesaAdicionada={aposMudanca}
              onConversaMudou={aposMudanca}
            />

            {/* Lado a lado, quem dá a altura da linha é a ENTREVISTA: o painel
                de despesas é posto em absoluto dentro da célula e rola por
                dentro, em vez de crescer a cada despesa e esticar a conversa
                junto. O min-h segura o painel quando a entrevista está curta. */}
            <div className="relative lg:min-h-[20rem]">
              <div className="lg:absolute lg:inset-0">
                <PlanejamentoDespesas
                  companyId={companyId}
                  year={year}
                  despesas={detalhe.despesas}
                  grupos={detalhe.grupos}
                  usaGrupos={detalhe.usaGrupos}
                  podeEscrever={detalhe.podeEscrever}
                  onMudou={aposMudanca}
                />
              </div>
            </div>
          </div>

          {/* Empresa sem "Orçar por setor" não tem setor para prever: a
              faixa somaria a empresa inteira sob o título "Prévia do setor". */}
          {detalhe.orcaPorSetor && (
            <PlanejamentoPreviaSetor
              resumo={previa}
              carregando={carregandoPrevia}
              setorNome={detalhe.setorNome}
              year={year}
              companyId={companyId}
              onDecidiu={aposMudanca}
            />
          )}
        </>
      )}
    </div>
  );
}

function Voltar({ companyId, year }: { companyId: string; year: number }) {
  return (
    <Link
      href={workspaceTabHref(companyId, year, "planejamento_socios")}
      className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
    >
      <ArrowLeft className="h-4 w-4" /> Voltar às categorias
    </Link>
  );
}
