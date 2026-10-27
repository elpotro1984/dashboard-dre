"use client";

import { useMemo, useState } from "react";
import Link from "next/link";

import { FilterTable, type FilterColumn } from "@/components/data-table/filter-table";
import type { FilterTableSnapshot } from "@/components/data-table/filter-logic";
import { formatDayBR } from "@/lib/ctrl/datetime";
import type { DpColaboradorRow } from "@/lib/dp/queries";

const situacao = (r: DpColaboradorRow) => (r.ativo ? "Ativo" : "Desligado");

/**
 * Abre em "Ativo": o desligado continua no espelho (é histórico), mas somá-lo
 * ao quadro daria um número de gente que não existe. O chip do filtro fica à
 * vista e sai em um clique.
 */
const INITIAL: FilterTableSnapshot = { values: { situacao: ["Ativo"] }, ranges: {}, sortKey: "nome", sortDir: "asc" };

/**
 * A lista já chega recortada pelo servidor (uma empresa, ou o balde "sem
 * empresa" do gestor) — por isso não há coluna Empresa. No balde sem empresa
 * entra a Unidade da Sólides, que é o que o de-para precisa.
 */
export function DpColaboradoresClient({
  rows,
  semEmpresa = false,
  foraDaTabela = [],
}: {
  rows: DpColaboradorRow[];
  semEmpresa?: boolean;
  /**
   * Ids de quem tem o salário da Sólides diferente da tabela salarial. Só o
   * SINAL vem ao navegador — o salário não: esta lista não carrega salário.
   */
  foraDaTabela?: string[];
}) {
  const [visible, setVisible] = useState<DpColaboradorRow[]>(() => rows.filter((r) => r.ativo));
  const fora = useMemo(() => new Set(foraDaTabela), [foraDaTabela]);

  // Memoizado: a FilterTable recalcula tudo quando `columns` muda de identidade.
  const columns = useMemo<FilterColumn<DpColaboradorRow>[]>(
    () => [
      {
        key: "nome",
        label: "Nome",
        plain: (r) => r.nome,
        sortVal: (r) => r.nome.toLowerCase(),
        cell: (r) => (
          <Link href={`/dp/colaboradores/${r.id}`} className="font-medium text-ink-primary hover:underline">
            {r.nome}
          </Link>
        ),
      },
      ...(semEmpresa
        ? [
            {
              key: "unidade",
              label: "Unidade (Sólides)",
              plain: (r: DpColaboradorRow) => r.unidadeNome ?? "—",
              sortVal: (r: DpColaboradorRow) => (r.unidadeNome ?? "").toLowerCase(),
            },
          ]
        : []),
      {
        key: "departamento",
        label: "Departamento",
        plain: (r) => r.departamentoNome ?? "—",
        sortVal: (r) => (r.departamentoNome ?? "").toLowerCase(),
      },
      {
        key: "cargo",
        label: "Cargo",
        plain: (r) => r.cargoNome ?? "—",
        sortVal: (r) => (r.cargoNome ?? "").toLowerCase(),
      },
      {
        key: "contrato",
        label: "Contrato",
        plain: (r) => r.tipoContrato ?? "—",
        sortVal: (r) => r.tipoContrato ?? "",
      },
      {
        key: "admissao",
        label: "Admissão",
        plain: (r) => formatDayBR(r.dataAdmissao),
        sortVal: (r) => r.dataAdmissao ?? "",
      },
      ...(fora.size > 0
        ? [
            {
              key: "tabela",
              label: "Tabela salarial",
              plain: (r: DpColaboradorRow) => (fora.has(r.id) ? "Salário ≠ tabela" : "—"),
              sortVal: (r: DpColaboradorRow) => (fora.has(r.id) ? "0" : "1"),
              cell: (r: DpColaboradorRow) =>
                fora.has(r.id) ? (
                  <span className="rounded bg-red-500/15 px-1.5 text-xs font-medium text-red-800 dark:text-red-300">salário ≠ tabela</span>
                ) : (
                  "—"
                ),
            },
          ]
        : []),
      {
        key: "situacao",
        label: "Situação",
        plain: situacao,
        sortVal: situacao,
        cell: (r) => (r.ativo ? "Ativo" : <span className="text-ink-muted">Desligado</span>),
      },
    ],
    [semEmpresa, fora],
  );

  return (
    <div className="space-y-3">
      <p className="text-sm text-ink-muted">
        {visible.length} de {rows.length} colaboradores na tela
        {semEmpresa && (
          <>
            {" · "}
            <Link href="/dp/empresas" className="text-amber-700 hover:underline dark:text-amber-400">
              fazer o de-para de empresas
            </Link>
          </>
        )}
        {fora.size > 0 && (
          <span className="text-red-700 dark:text-red-400">
            {" · "}
            {fora.size} com salário da Sólides diferente da tabela salarial (em vermelho). Corrija na Sólides — o sistema não muda o
            salário; o alerta some quando a sincronização trouxer o valor da tabela. O detalhe está em Cargos e salários › Enquadramento.
          </span>
        )}
      </p>
      <FilterTable
        rows={rows}
        columns={columns}
        rowKey={(r) => r.id}
        onVisibleChange={setVisible}
        rowClassName={(r) => (fora.has(r.id) ? "bg-red-500/10" : undefined)}
        initialState={INITIAL}
        emptyMessage={
          rows.length === 0
            ? semEmpresa
              ? "Todos os colaboradores têm empresa definida."
              : "Nenhum colaborador nesta empresa. Se a Sólides ainda não foi sincronizada, a sincronização fica em Configurações."
            : "Nenhum colaborador corresponde aos filtros."
        }
      />
    </div>
  );
}
