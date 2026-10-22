import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";

import { DpEncargosEmpresaClient, type DpEncargosEmpresaDados } from "@/components/dp/encargos-empresa-client";
import { DP_CONFIG_PATH } from "@/lib/auth/dp";
import { todayBR } from "@/lib/ctrl/datetime";
import { getDpUser } from "@/lib/dp/auth";
import { getDpEmpresaAtiva } from "@/lib/dp/empresa-ativa";
import { resolverEncargos } from "@/lib/orcamento/encargos";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

/**
 * Configurações › Encargos da empresa (empresa ativa): regime tributário e as
 * alíquotas patronais por ano — o MESMO cadastro do Orçamento, lido pelas
 * Simulações e pelos Impostos do DP. Todos do DP veem; só o gestor grava.
 */
export default async function DpEncargosEmpresaPage({ searchParams }: { searchParams: { ano?: string } }) {
  const user = await getDpUser();
  if (!user) redirect("/");
  const anoHoje = Number(todayBR().slice(0, 4));
  const pedido = Number(searchParams.ano);
  const ano = Number.isInteger(pedido) && pedido >= 2000 && pedido <= 2100 ? pedido : anoHoje;

  const db = createAdminClient();
  const { ativa } = await getDpEmpresaAtiva(db, user);
  let dados: DpEncargosEmpresaDados | null = null;
  if (ativa) {
    const [{ data: company }, { data: rows, error }] = await Promise.all([
      db.from("companies").select("regime_tributario").eq("id", ativa.id).maybeSingle(),
      db.from("orcamento_encargos").select("year, inss_patronal, rat_fap, terceiros, fgts, updated_at").eq("company_id", ativa.id).order("year", { ascending: false }),
    ]);
    const regime = (company?.regime_tributario as string | null) ?? null;
    const linhas = error ? [] : rows ?? [];
    const doAno = linhas.find((r) => Number(r.year) === ano) ?? null;
    // Sem linha no ano, a folha do DP usa a do ano mais recente (lerEncargosDaEmpresa) — a tela diz isso.
    const maisRecente = linhas[0] ?? null;
    dados = {
      companyId: ativa.id,
      ano,
      regime,
      temLinha: Boolean(doAno),
      values: resolverEncargos((doAno ?? maisRecente) as Record<string, unknown> | null, regime).values,
      anoUsado: doAno ? ano : maisRecente ? Number(maisRecente.year) : null,
      anos: linhas.map((r) => Number(r.year)),
      atualizadoEm: (doAno?.updated_at as string | null) ?? null,
      instalado: !error,
    };
  }

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <Link href={DP_CONFIG_PATH} className="inline-flex items-center gap-1 text-sm text-ink-muted hover:text-ink-primary">
        <ArrowLeft className="h-4 w-4" /> Configurações
      </Link>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-ink-primary">Encargos da empresa</h1>
          <p className="text-sm text-ink-muted">
            Regime tributário e alíquotas patronais (INSS, RAT × FAP, terceiros). É o mesmo cadastro do Orçamento: mudar aqui muda lá.
          </p>
        </div>
        {ativa && <span className="text-sm font-medium text-ink-muted">{ativa.name}</span>}
      </div>
      {dados ? (
        <DpEncargosEmpresaClient key={`${dados.companyId}-${dados.ano}`} dados={dados} gestor={user.role === "gestor"} />
      ) : (
        <p className="text-sm text-ink-muted">Nenhuma empresa liberada para você no Departamento Pessoal.</p>
      )}
    </div>
  );
}
