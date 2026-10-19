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
export function DpColaboradoresClient({ rows, semEmpresa = false }: { rows: DpColaboradorRow[]; semEmpresa?: boolean }) {
  const [visible, setVisible] = useState<DpColaboradorRow[]>(() => rows.filter((r) => r.ativo));

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
      {
        key: "situacao",
        label: "Situação",
        plain: situacao,
        sortVal: situacao,
        cell: (r) => (r.ativo ? "Ativo" : <span className="text-ink-muted">Desligado</span>),
      },
    ],
    [semEmpresa],
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
      </p>
      <FilterTable
        rows={rows}
        columns={columns}
        rowKey={(r) => r.id}
        onVisibleChange={setVisible}
        initialState={INITIAL}
        emptyMessage={
          rows.length === 0
            ? semEmpresa
              ? "Todos os colaboradores têm empresa definida."
              : "Nenhum colaborador nesta empresa. Se a Sólides ainda não foi sincronizada, a sincronização fica na Visão geral."
            : "Nenhum colaborador corresponde aos filtros."
        }
      />
    </div>
  );
}
