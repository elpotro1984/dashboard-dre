"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { AlertTriangle, ChevronLeft, ChevronRight, ExternalLink } from "lucide-react";

import { FilterTable, type FilterColumn } from "@/components/data-table/filter-table";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DP_BENEFICIOS_PATH, DP_COLABORADORES_PATH, DP_FERIAS_PATH } from "@/lib/auth/dp";
import { rotuloCompetencia, somarMeses } from "@/lib/dp/folha/parametros";
import {
  colunasComValorGestao,
  COLUNAS_GESTAO,
  fracao,
  REGRA_TEXTO,
  resumirGestao,
  ROTULO_COLUNA_GESTAO,
  type DpColunaGestao,
  type DpGestaoDados,
  type DpLinhaGestao,
} from "@/lib/dp/gestao-beneficios";

import { brl, brl0 } from "./folha/formato";

const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
const pct = (v: number | null) => (v === null ? "—" : `${(v * 100).toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%`);
const SEM_SETOR = "Sem setor";

type Alvo = DpColunaGestao | "dias" | "total";
const temAviso = (l: DpLinhaGestao) => l.avisos.length > 0 || COLUNAS_GESTAO.some((c) => l.celulas[c].avisos.length > 0);

/**
 * Gestão de benefícios da empresa ativa no mês: o card "Benefícios" de cada
 * pessoa com o valor do cadastro da empresa e os DIAS do mês aplicados
 * (@/lib/dp/gestao-beneficios). Os cards somam as linhas que passam pelos
 * filtros da tabela; todo valor é clicável e mostra de onde veio.
 */
export function DpGestaoBeneficiosClient({ dados }: { dados: DpGestaoDados }) {
  const { linhas, competencia } = dados;
  const [visiveis, setVisiveis] = useState<DpLinhaGestao[]>(linhas);
  const [detalhe, setDetalhe] = useState<{ linha: DpLinhaGestao; alvo: Alvo } | null>(null);
  const empresa = useMemo(() => resumirGestao(linhas), [linhas]);
  const recorte = useMemo(() => resumirGestao(visiveis), [visiveis]);
  const filtrado = visiveis.length !== linhas.length;
  const colunasValor = useMemo(() => colunasComValorGestao(linhas, dados.colunasCadastradas), [linhas, dados.colunasCadastradas]);
  const hrefMes = (n: number) => `?competencia=${somarMeses(competencia, n)}`;

  const fatos = useMemo(() => {
    const conta = (f: (l: DpLinhaGestao) => boolean) => linhas.filter(f).length;
    return {
      ferias: conta((l) => l.dias.temFerias),
      fk: conta((l) => l.dias.temFeriasFk),
      admissoes: conta((l) => l.dias.admissaoNoMes !== null),
      desligamentos: conta((l) => l.dias.desligamentoNoMes !== null),
      semCard: conta((l) => l.semCadastro),
    };
  }, [linhas]);

  const colunas = useMemo<FilterColumn<DpLinhaGestao>[]>(() => {
    const abrir = (linha: DpLinhaGestao, alvo: Alvo) => setDetalhe({ linha, alvo });
    const dinheiro = (c: DpColunaGestao): FilterColumn<DpLinhaGestao> => ({
      key: c,
      label: ROTULO_COLUNA_GESTAO[c],
      kind: "number",
      align: "right",
      plain: (l) => brl(l.celulas[c].valor),
      sortVal: (l) => l.celulas[c].valor,
      numeric: (l) => l.celulas[c].valor,
      className: "whitespace-nowrap",
      cell: (l) => {
        const cel = l.celulas[c];
        if (cel.valor === 0 && cel.avisos.length === 0) return <span className="text-ink-muted">—</span>;
        return (
          <button
            type="button"
            onClick={() => abrir(l, c)}
            className="inline-flex items-center gap-1 tabular-nums underline decoration-dotted underline-offset-2 hover:text-ink-primary"
            title="Ver do que se trata"
          >
            {cel.avisos.length > 0 && <AlertTriangle className="h-3.5 w-3.5 text-amber-600" aria-label="Tem aviso" />}
            {brl0(cel.valor)}
          </button>
        );
      },
    });
    return [
      {
        key: "nome",
        label: "Colaborador",
        plain: (l) => l.nome,
        sortVal: (l) => norm(l.nome),
        className: "whitespace-nowrap",
        cell: (l) => (
          <span className="inline-flex items-center gap-1.5">
            <Link href={`${DP_COLABORADORES_PATH}/${l.colaboradorId}`} className="text-ink-primary hover:underline" title="Abrir a ficha (card Benefícios)">
              {l.nome}
            </Link>
            {l.semCadastro && <span className="rounded bg-muted px-1 text-[11px] text-ink-muted">sem card</span>}
            {temAviso(l) && <AlertTriangle className="h-3.5 w-3.5 text-amber-600" aria-label="Tem aviso" />}
          </span>
        ),
      },
      {
        key: "setor",
        label: "Setor",
        plain: (l) => l.setor ?? SEM_SETOR,
        // "Sem setor" vai para o fim na ordem crescente.
        sortVal: (l) => (l.setor ? norm(l.setor) : "￿"),
        cell: (l) => l.setor ?? <span className="text-ink-muted">—</span>,
      },
      {
        key: "dias",
        label: "Dias trabalhados",
        kind: "number",
        align: "right",
        plain: (l) => String(l.dias.trabalhados),
        sortVal: (l) => l.dias.trabalhados,
        numeric: (l) => l.dias.trabalhados,
        className: "whitespace-nowrap",
        cell: (l) => {
          const marcas = [l.dias.admissaoNoMes && "admissão", l.dias.desligamentoNoMes && "desligamento", l.dias.temFerias && "férias", l.dias.temFeriasFk && "FK"].filter(
            Boolean,
          ) as string[];
          return (
            <button type="button" onClick={() => abrir(l, "dias")} className="text-right hover:text-ink-primary" title="Ver a conta dos dias">
              <span className="tabular-nums underline decoration-dotted underline-offset-2">{l.dias.trabalhados}</span>
              <span className="text-ink-muted"> de {l.dias.uteisMes}</span>
              {marcas.length > 0 && <span className="block text-[11px] text-amber-700 dark:text-amber-400">{marcas.join(" · ")}</span>}
            </button>
          );
        },
      },
      ...colunasValor.map(dinheiro),
      {
        key: "total",
        label: "Total",
        kind: "number",
        align: "right",
        plain: (l) => brl(l.total),
        sortVal: (l) => l.total,
        numeric: (l) => l.total,
        className: "whitespace-nowrap",
        cell: (l) =>
          l.total === 0 ? (
            <span className="text-ink-muted">—</span>
          ) : (
            <button
              type="button"
              onClick={() => abrir(l, "total")}
              className="font-medium tabular-nums text-ink-primary underline decoration-dotted underline-offset-2"
              title="Ver a composição"
            >
              {brl(l.total)}
            </button>
          ),
      },
    ];
  }, [colunasValor]);

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
        <span className="ml-2 text-xs text-ink-muted">
          {filtrado ? `${recorte.pessoas} de ${empresa.pessoas} colaboradores na tela` : `${empresa.pessoas} colaboradores`}
          {fatos.ferias > 0 && ` · ${fatos.ferias} com férias no mês`}
          {fatos.fk > 0 && ` · ${fatos.fk} com férias FK`}
          {fatos.admissoes > 0 && ` · ${fatos.admissoes} ${fatos.admissoes === 1 ? "admissão" : "admissões"}`}
          {fatos.desligamentos > 0 && ` · ${fatos.desligamentos} ${fatos.desligamentos === 1 ? "desligamento" : "desligamentos"}`}
        </span>
      </div>

      {(dados.faltando.card || dados.faltando.ferias) && (
        <p className="flex gap-1 rounded-md border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-sm text-amber-900 dark:text-amber-200">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>
            {dados.faltando.card && "Os benefícios por colaborador ainda não estão instalados no banco (migration 20261028130000) — a tela sai zerada. "}
            {dados.faltando.ferias && "O controle de férias ainda não está instalado no banco (migration 20261027180000) — as férias não tiram dias."}
          </span>
        </p>
      )}
      {!dados.empresaTemCadastro && (
        <p className="rounded-md border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-sm text-amber-900 dark:text-amber-200">
          A empresa ainda não tem benefícios cadastrados — os valores vêm de{" "}
          <Link href={DP_BENEFICIOS_PATH} className="underline">
            Configurações › Benefícios
          </Link>
          .
        </p>
      )}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Cartao
          titulo="Total dos benefícios"
          valor={recorte.total}
          linha={
            filtrado
              ? `${pct(fracao(recorte.total, empresa.total))} do total da empresa`
              : `${empresa.comBeneficio} de ${empresa.pessoas} colaboradores com benefício no mês`
          }
          detalhe={recorte.comBeneficio > 0 ? `média de ${brl(recorte.total / recorte.comBeneficio)} por colaborador com benefício` : "ninguém com benefício"}
          destaque
        />
        <Cartao
          titulo="Vale-alimentação"
          valor={recorte.alimentacao}
          linha={
            filtrado
              ? `${pct(fracao(recorte.alimentacao, empresa.alimentacao))} do vale-alimentação da empresa`
              : `${pct(fracao(recorte.alimentacao, recorte.total))} dos benefícios`
          }
          detalhe={dados.regraAlimentacao === "diario" ? "valor por dia × dias trabalhados" : "valor fixo no mês"}
        />
        <Cartao
          titulo="Mobilidade"
          valor={recorte.mobilidade}
          linha={
            filtrado
              ? `${pct(fracao(recorte.mobilidade, empresa.mobilidade))} da mobilidade da empresa`
              : `${pct(fracao(recorte.mobilidade, recorte.total))} dos benefícios`
          }
          detalhe="vale-transporte, gasolina e carona — pelos dias trabalhados"
        />
        <Cartao
          titulo="Demais benefícios"
          valor={recorte.demais}
          linha={
            filtrado ? `${pct(fracao(recorte.demais, empresa.demais))} dos demais da empresa` : `${pct(fracao(recorte.demais, recorte.total))} dos benefícios`
          }
          detalhe="home office, SESI, assiduidade, salário-família e outros"
        />
      </div>

      <p className="text-xs text-ink-muted">
        Valores do card <span className="font-medium">Benefícios</span> de cada ficha, com o valor de{" "}
        <Link href={DP_BENEFICIOS_PATH} className="underline hover:text-ink-primary">
          Configurações › Benefícios
        </Link>
        . Dias pelo calendário de trabalho (escala da folha, sem os feriados). Férias do{" "}
        <Link href={`${DP_FERIAS_PATH}?competencia=${competencia}`} className="underline hover:text-ink-primary">
          Pagamento de férias
        </Link>{" "}
        tiram dias só do VT, da gasolina, da carona e do vale-alimentação por dia — e não contam quando marcadas FK. Admissão e desligamento
        no mês tornam proporcional todo benefício. Clique em qualquer valor para ver do que se trata.
        {fatos.semCard > 0 && ` ${fatos.semCard} ${fatos.semCard === 1 ? "pessoa ainda não tem" : "pessoas ainda não têm"} o card preenchido ("sem card").`}
      </p>

      {linhas.length === 0 ? (
        <p className="text-sm text-ink-muted">Ninguém da Sólides nesta empresa neste mês.</p>
      ) : (
        <FilterTable
          rows={linhas}
          columns={colunas}
          rowKey={(l) => String(l.solidesId)}
          onVisibleChange={setVisiveis}
          emptyMessage="Ninguém corresponde aos filtros."
          footer={(vis) => (
            <>
              <td colSpan={3} className="px-3 py-2 font-medium text-ink-primary">
                Total ({vis.length})
              </td>
              {colunasValor.map((c) => (
                <td key={c} className="whitespace-nowrap px-3 py-2 text-right font-medium tabular-nums text-ink-primary">
                  {brl(vis.reduce((s, l) => s + l.celulas[c].valor, 0))}
                </td>
              ))}
              <td className="whitespace-nowrap px-3 py-2 text-right font-medium tabular-nums text-ink-primary">{brl(vis.reduce((s, l) => s + l.total, 0))}</td>
            </>
          )}
        />
      )}

      {detalhe && <Detalhe linha={detalhe.linha} alvo={detalhe.alvo} colunas={colunasValor} onClose={() => setDetalhe(null)} />}
    </div>
  );
}

function Cartao({ titulo, valor, linha, detalhe, destaque = false }: { titulo: string; valor: number; linha: string; detalhe: string; destaque?: boolean }) {
  return (
    <Card className="h-full">
      <CardContent className="space-y-0.5 py-3">
        <p className="text-xs text-ink-muted">{titulo}</p>
        <p className={`font-semibold tabular-nums text-ink-primary ${destaque ? "text-xl" : "text-lg"}`}>{brl(valor)}</p>
        <p className="text-xs font-medium text-ink-secondary">{linha}</p>
        <p className="text-xs text-ink-muted">{detalhe}</p>
      </CardContent>
    </Card>
  );
}

/** O que está por trás de um valor: os itens e a conta, a regra dos dias, notas e avisos. */
function Detalhe({ linha, alvo, colunas, onClose }: { linha: DpLinhaGestao; alvo: Alvo; colunas: DpColunaGestao[]; onClose: () => void }) {
  const d = linha.dias;
  const titulo = alvo === "dias" ? "Dias trabalhados" : alvo === "total" ? "Total dos benefícios" : ROTULO_COLUNA_GESTAO[alvo];
  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>
            {titulo} — {linha.nome}
          </DialogTitle>
          <DialogDescription>
            {alvo === "dias"
              ? `${d.trabalhados} de ${d.uteisMes} dias úteis no mês.`
              : alvo === "total"
                ? "A soma dos benefícios do mês."
                : REGRA_TEXTO[linha.celulas[alvo].regra]}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 text-sm">
          {alvo === "dias" ? (
            <ul className="list-disc space-y-0.5 pl-5 text-ink-secondary">
              {d.memoria.map((m) => (
                <li key={m}>{m}</li>
              ))}
            </ul>
          ) : alvo === "total" ? (
            <table className="w-full">
              <tbody>
                {colunas
                  .filter((c) => linha.celulas[c].valor !== 0)
                  .map((c) => (
                    <tr key={c} className="border-b border-border/60">
                      <td className="py-1 pr-3 text-ink-primary">{ROTULO_COLUNA_GESTAO[c]}</td>
                      <td className="py-1 text-right tabular-nums">{brl(linha.celulas[c].valor)}</td>
                    </tr>
                  ))}
              </tbody>
              <tfoot>
                <tr>
                  <td className="pt-1.5 pr-3 font-medium text-ink-primary">Total</td>
                  <td className="pt-1.5 text-right font-medium tabular-nums">{brl(linha.total)}</td>
                </tr>
              </tfoot>
            </table>
          ) : (
            <Celula linha={linha} coluna={alvo} />
          )}

          {linha.avisos.length > 0 && (
            <ul className="space-y-0.5 text-xs text-amber-800 dark:text-amber-300">
              {linha.avisos.map((a) => (
                <li key={a} className="flex gap-1">
                  <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  {a}
                </li>
              ))}
            </ul>
          )}

          <Link
            href={`${DP_COLABORADORES_PATH}/${linha.colaboradorId}`}
            className="inline-flex items-center gap-1 text-xs text-ink-muted underline hover:text-ink-primary"
          >
            <ExternalLink className="h-3.5 w-3.5" /> {alvo === "dias" ? "Abrir a ficha" : "Ver ou mudar no card Benefícios da ficha"}
          </Link>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function Celula({ linha, coluna }: { linha: DpLinhaGestao; coluna: DpColunaGestao }) {
  const cel = linha.celulas[coluna];
  return (
    <div className="space-y-2">
      {cel.itens.length === 0 ? (
        <p className="text-ink-muted">Nada a receber neste benefício.</p>
      ) : (
        <table className="w-full">
          <thead className="text-left text-xs text-ink-muted">
            <tr className="border-b border-border">
              <th className="py-1 pr-3 font-medium">Do que se trata</th>
              <th className="py-1 pr-3 font-medium">Conta</th>
              <th className="py-1 text-right font-medium">Valor</th>
            </tr>
          </thead>
          <tbody>
            {cel.itens.map((i, k) => (
              <tr key={`${i.rotulo}-${k}`} className="border-b border-border/60 align-top">
                <td className="py-1 pr-3">
                  <span className="text-ink-primary">{i.rotulo}</span>
                  <span className="block text-xs text-ink-muted">{i.origem}</span>
                </td>
                <td className="py-1 pr-3 text-xs tabular-nums text-ink-secondary">{i.conta}</td>
                <td className="py-1 text-right tabular-nums">{brl(i.valor)}</td>
              </tr>
            ))}
          </tbody>
          {cel.itens.length > 1 && (
            <tfoot>
              <tr>
                <td colSpan={2} className="pt-1.5 pr-3 font-medium text-ink-primary">
                  Total
                </td>
                <td className="pt-1.5 text-right font-medium tabular-nums">{brl(cel.valor)}</td>
              </tr>
            </tfoot>
          )}
        </table>
      )}
      {cel.regra !== "vinculo" || linha.dias.uteisVinculo < linha.dias.uteisMes ? (
        <p className="text-xs text-ink-muted">
          {cel.regra === "vinculo"
            ? `${linha.dias.uteisVinculo} de ${linha.dias.uteisMes} dias úteis de vínculo no mês.`
            : `${linha.dias.trabalhados} dias trabalhados de ${linha.dias.uteisMes} dias úteis no mês.`}
        </p>
      ) : null}
      {cel.notas.map((n) => (
        <p key={n} className="text-xs text-ink-muted">
          {n}
        </p>
      ))}
      {cel.avisos.map((a) => (
        <p key={a} className="flex gap-1 text-xs text-amber-800 dark:text-amber-300">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          {a}
        </p>
      ))}
    </div>
  );
}
