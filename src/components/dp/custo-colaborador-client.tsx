"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { AlertTriangle, ChevronDown, ChevronLeft, ChevronRight, ChevronUp } from "lucide-react";

import { FilterTable, type FilterColumn } from "@/components/data-table/filter-table";
import { Card, CardContent } from "@/components/ui/card";
import { DP_ENCARGOS_PATH, DP_PARAMETROS_FOLHA_PATH } from "@/lib/auth/dp";
import {
  colunasComValor,
  participacao,
  resumirCusto,
  ROTULO_COLUNA_CUSTO,
  ROTULO_CONTRATO_CUSTO,
  type DpColunaCusto,
  type DpCustoColaborador,
} from "@/lib/dp/folha/custo-colaborador";
import { rotuloCompetencia, somarMeses } from "@/lib/dp/folha/parametros";
import type { EncargoValues } from "@/lib/orcamento/encargos";

import { brl, brl0 } from "./folha/formato";

export interface DpCustoDados {
  competencia: string;
  /** Vigência dos Parâmetros da folha usada (planos, VT, FGTS); null = padrão do sistema. */
  vigencia: string | null;
  fgtsPercentual: number;
  encargos: EncargoValues;
  origemEncargos: { tipo: "cadastro"; ano: number } | { tipo: "padrao"; regime: string | null };
  linhas: DpCustoColaborador[];
}

const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
const pct = (v: number | null) => (v === null ? "—" : `${(v * 100).toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%`);
const pp = (v: number) => `${v.toLocaleString("pt-BR", { maximumFractionDigits: 2 })}%`;

const SEM_SETOR = "Sem setor";
const SEM_CENTRO = "Sem centro de custo";

/**
 * Custo mensal fixo de cada pessoa, despesa a despesa. Os cards somam as linhas
 * que passam pelos filtros da tabela e dizem quanto isso é do custo TOTAL da
 * empresa — o total do card é sempre o do que está na tela.
 */
export function DpCustoColaboradorClient({ dados }: { dados: DpCustoDados }) {
  const { linhas, competencia } = dados;
  const [visiveis, setVisiveis] = useState<DpCustoColaborador[]>(linhas);
  const [aberta, setAberta] = useState<number | null>(null);
  const empresa = useMemo(() => resumirCusto(linhas), [linhas]);
  const recorte = useMemo(() => resumirCusto(visiveis), [visiveis]);
  const filtrado = visiveis.length !== linhas.length;
  const colunasValor = useMemo(() => colunasComValor(linhas), [linhas]);
  const hrefMes = (n: number) => `?competencia=${somarMeses(competencia, n)}`;

  const colunas = useMemo<FilterColumn<DpCustoColaborador>[]>(() => {
    const lotacao = (key: string, label: string, valor: (l: DpCustoColaborador) => string | null, sem: string): FilterColumn<DpCustoColaborador> => ({
      key,
      label,
      plain: (l) => valor(l) ?? sem,
      // "Sem …" vai para o fim na ordem crescente.
      sortVal: (l) => (valor(l) ? norm(valor(l)!) : "￿"),
      cell: (l) => valor(l) ?? <span className="text-ink-muted">—</span>,
    });
    const dinheiro = (key: string, label: string, valor: (l: DpCustoColaborador) => number, forte = false): FilterColumn<DpCustoColaborador> => ({
      key,
      label,
      kind: "number",
      align: "right",
      plain: (l) => brl(valor(l)),
      sortVal: valor,
      numeric: valor,
      cell: (l) => (forte ? <span className="font-medium text-ink-primary">{brl(valor(l))}</span> : brl0(valor(l))),
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
          <button
            type="button"
            className="inline-flex items-center gap-1 text-left text-ink-primary hover:underline"
            onClick={() => setAberta(aberta === l.solidesId ? null : l.solidesId)}
            title="Ver a memória de cálculo"
          >
            {aberta === l.solidesId ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
            {l.nome}
            {l.avisos.length > 0 && <AlertTriangle className="h-3.5 w-3.5 text-amber-600" aria-label="Tem aviso" />}
          </button>
        ),
      },
      lotacao("setor", "Setor", (l) => l.setor, SEM_SETOR),
      lotacao("centro", "Centro de custo", (l) => l.centroCusto, SEM_CENTRO),
      {
        key: "contrato",
        label: "Contrato",
        plain: (l) => ROTULO_CONTRATO_CUSTO[l.contrato],
        sortVal: (l) => ROTULO_CONTRATO_CUSTO[l.contrato],
        className: "whitespace-nowrap",
      },
      ...colunasValor.map((k: DpColunaCusto) => dinheiro(k, ROTULO_COLUNA_CUSTO[k], (l) => l[k])),
      dinheiro("total", "Total", (l) => l.total, true),
    ];
  }, [aberta, colunasValor]);

  const origemEncargos =
    dados.origemEncargos.tipo === "cadastro"
      ? `cadastro de encargos da empresa (ano ${dados.origemEncargos.ano})`
      : `padrão do regime ${dados.origemEncargos.regime === "simples_nacional" ? "Simples Nacional" : "normal"} — a empresa não tem alíquotas cadastradas`;
  const e = dados.encargos;

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
        </span>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Cartao
          titulo="Salários"
          valor={recorte.salarios}
          daEmpresa={participacao(recorte.salarios, empresa.total)}
          doRecorte={filtrado ? participacao(recorte.salarios, recorte.total) : null}
          detalhe="salário, proventos fixos, 13º e férias"
        />
        <Cartao
          titulo="Encargos"
          valor={recorte.encargos}
          daEmpresa={participacao(recorte.encargos, empresa.total)}
          doRecorte={filtrado ? participacao(recorte.encargos, recorte.total) : null}
          detalhe="INSS patronal, RAT × FAP, terceiros e FGTS"
        />
        <Cartao
          titulo="Benefícios"
          valor={recorte.beneficios}
          daEmpresa={participacao(recorte.beneficios, empresa.total)}
          doRecorte={filtrado ? participacao(recorte.beneficios, recorte.total) : null}
          detalhe="a parte da empresa: plano de saúde, VT, gasolina, alimentação e home office"
        />
        <Cartao
          titulo="Total"
          valor={recorte.total}
          daEmpresa={participacao(recorte.total, empresa.total)}
          doRecorte={null}
          detalhe={`${brl(recorte.total * 12)} em 12 meses`}
          destaque
        />
      </div>

      <p className="text-xs text-ink-muted">
        Custo mensal na competência, com os valores fixos de cada pessoa (mês cheio, sem faltas, comissão, coparticipação nem ajustes da folha).
        13º = 1/12 e férias = 1/36 do salário bruto (o mês de férias já é um dos 12 salários; o que ele custa a mais é o terço) — a mesma
        regra do Orçamento e das Simulações. Encargos sobre salário bruto + 13º + férias: INSS patronal {pp(e.inss_patronal)}, RAT × FAP{" "}
        {pp(e.rat_fap)} e terceiros {pp(e.terceiros)} do {origemEncargos} (
        <Link href={DP_ENCARGOS_PATH} className="underline hover:text-ink-primary">
          Encargos da empresa
        </Link>
        ); FGTS {pp(dados.fgtsPercentual * 100)} e benefícios dos{" "}
        <Link href={DP_PARAMETROS_FOLHA_PATH} className="underline hover:text-ink-primary">
          Parâmetros da folha
        </Link>{" "}
        ({dados.vigencia ? `vigência de ${rotuloCompetencia(dados.vigencia)}` : "padrão do sistema"}). Estágio, PJ e sócio entram só com o valor e os
        benefícios. Fica de fora o que é do colaborador (odontológico e a parte do plano além do Ambulatorial do titular, 6% do VT) e o
        salário-família, que a empresa compensa na guia do INSS.
      </p>

      {linhas.length === 0 ? (
        <p className="text-sm text-ink-muted">Ninguém na folha desta empresa neste mês.</p>
      ) : (
        <FilterTable
          rows={linhas}
          columns={colunas}
          rowKey={(l) => String(l.solidesId)}
          onVisibleChange={setVisiveis}
          emptyMessage="Ninguém corresponde aos filtros."
          expandedRow={(l) => (aberta === l.solidesId ? <Memoria linha={l} colunas={colunasValor} /> : null)}
          footer={(vis) => (
            <>
              <td colSpan={4} className="px-3 py-2 font-medium text-ink-primary">
                Total ({vis.length})
              </td>
              {[...colunasValor, "total" as const].map((k) => (
                <td key={k} className="whitespace-nowrap px-3 py-2 text-right font-medium tabular-nums text-ink-primary">
                  {brl(vis.reduce((s, l) => s + l[k], 0))}
                </td>
              ))}
            </>
          )}
        />
      )}
    </div>
  );
}

function Cartao({
  titulo,
  valor,
  daEmpresa,
  doRecorte,
  detalhe,
  destaque = false,
}: {
  titulo: string;
  valor: number;
  daEmpresa: number | null;
  doRecorte: number | null;
  detalhe: string;
  destaque?: boolean;
}) {
  return (
    <Card className="h-full">
      <CardContent className="space-y-0.5 py-3">
        <p className="text-xs text-ink-muted">{titulo}</p>
        <p className={`font-semibold tabular-nums text-ink-primary ${destaque ? "text-xl" : "text-lg"}`}>{brl(valor)}</p>
        <p className="text-xs text-ink-secondary">
          <span className="font-medium tabular-nums">{pct(daEmpresa)}</span> do custo total da empresa
          {doRecorte !== null && <span className="text-ink-muted"> · {pct(doRecorte)} do filtrado</span>}
        </p>
        <p className="text-xs text-ink-muted">{detalhe}</p>
      </CardContent>
    </Card>
  );
}

function Memoria({ linha, colunas }: { linha: DpCustoColaborador; colunas: DpColunaCusto[] }) {
  const itens = colunas.filter((k) => linha[k] !== 0 && linha.memoria[k]);
  return (
    <div className="space-y-2 text-xs text-ink-muted">
      <p>
        <span className="font-medium text-ink-primary">Como entra na conta: </span>
        {linha.regime}
      </p>
      {itens.length > 0 && (
        <ul className="grid gap-x-6 gap-y-1 lg:grid-cols-2">
          {itens.map((k) => (
            <li key={k}>
              <span className="font-medium text-ink-primary">
                {ROTULO_COLUNA_CUSTO[k]} {brl(linha[k])}:
              </span>{" "}
              {linha.memoria[k]}
            </li>
          ))}
        </ul>
      )}
      {linha.avisos.length > 0 && (
        <ul className="space-y-0.5 text-amber-800 dark:text-amber-300">
          {linha.avisos.map((a) => (
            <li key={a} className="flex gap-1">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              {a}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
