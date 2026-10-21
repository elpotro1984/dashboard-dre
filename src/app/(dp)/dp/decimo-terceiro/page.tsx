import { redirect } from "next/navigation";

import { Dp13Client } from "@/components/dp/folha/decimo-terceiro-client";
import { DpNaoInstalado } from "@/components/dp/nao-instalado";
import { todayBR } from "@/lib/ctrl/datetime";
import { getDpUser } from "@/lib/dp/auth";
import { getDpEmpresaAtiva } from "@/lib/dp/empresa-ativa";
import { getDecimoTerceiro } from "@/lib/dp/folha/decimo-terceiro-queries";
import { DpNaoInstaladoError } from "@/lib/dp/queries";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

/**
 * 13º salário da EMPRESA ATIVA (seletor do topo), por ano (?ano=; sem ele, o
 * ano corrente). A população é a da folha de dezembro e o cálculo, o do motor
 * (folha/decimo-terceiro.ts) — ou o retrato, quando a parcela está fechada.
 */
export default async function Dp13Page({ searchParams }: { searchParams: { ano?: string } }) {
  const user = await getDpUser();
  if (!user) redirect("/");
  const pedido = Number(searchParams.ano);
  const ano = Number.isInteger(pedido) && pedido >= 2020 && pedido <= 2100 ? pedido : Number(todayBR().slice(0, 4));

  const db = createAdminClient();
  try {
    const { ativa } = await getDpEmpresaAtiva(db, user);
    const dados = ativa ? await getDecimoTerceiro(db, ativa.id, ano) : null;
    return (
      <div className="mx-auto max-w-7xl space-y-4">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-xl font-semibold text-ink-primary">13º salário</h1>
            <p className="text-sm text-ink-muted">1ª e 2ª parcela de cada pessoa, com INSS, IRRF e FGTS — da Sólides e do cadastro da folha.</p>
          </div>
          {ativa && <span className="text-sm font-medium text-ink-muted">{ativa.name}</span>}
        </div>
        {ativa && dados ? (
          <Dp13Client key={`${ativa.id}-${ano}`} dados={dados} companyName={ativa.name} gestor={user.role === "gestor"} />
        ) : (
          <p className="text-sm text-ink-muted">Nenhuma empresa liberada para você no Departamento Pessoal.</p>
        )}
      </div>
    );
  } catch (error) {
    if (error instanceof DpNaoInstaladoError) return <DpNaoInstalado migration="20261021140000_dp_folha_13_rescisao.sql" />;
    throw error;
  }
}
