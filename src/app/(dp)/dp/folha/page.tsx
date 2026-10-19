import { redirect } from "next/navigation";

import { DpFolhaClient } from "@/components/dp/folha/folha-client";
import { DpNaoInstalado } from "@/components/dp/nao-instalado";
import { todayBR } from "@/lib/ctrl/datetime";
import { getDpUser } from "@/lib/dp/auth";
import { getDpEmpresaAtiva } from "@/lib/dp/empresa-ativa";
import { competenciaValida } from "@/lib/dp/folha/parametros";
import { getFolhaEmpresa } from "@/lib/dp/folha/queries";
import { DpNaoInstaladoError } from "@/lib/dp/queries";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

/**
 * Folha do mês da EMPRESA ATIVA (seletor do topo). A competência vem da URL;
 * sem ela, o mês corrente. O cálculo é o do motor (folha/motor.ts) sobre a
 * Sólides + o cadastro da folha + os parâmetros vigentes — ou o retrato
 * gravado, quando a folha está fechada.
 */
export default async function DpFolhaPage({ searchParams }: { searchParams: { competencia?: string } }) {
  const user = await getDpUser();
  if (!user) redirect("/");
  const competencia = competenciaValida(searchParams.competencia) ? searchParams.competencia : todayBR().slice(0, 7);

  const db = createAdminClient();
  try {
    const { ativa } = await getDpEmpresaAtiva(db, user);
    const folha = ativa ? await getFolhaEmpresa(db, ativa.id, competencia) : null;
    return (
      <div className="mx-auto max-w-7xl space-y-4">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-xl font-semibold text-ink-primary">Folha do mês</h1>
            <p className="text-sm text-ink-muted">
              A planilha de folha do DP, dentro do sistema: cadastro e salário vêm da Sólides; o resto, deste cadastro.
            </p>
          </div>
          {ativa && <span className="text-sm font-medium text-ink-muted">{ativa.name}</span>}
        </div>
        {ativa && folha ? (
          <DpFolhaClient key={`${ativa.id}-${competencia}`} folha={folha} companyName={ativa.name} gestor={user.role === "gestor"} />
        ) : (
          <p className="text-sm text-ink-muted">Nenhuma empresa liberada para você no Departamento Pessoal.</p>
        )}
      </div>
    );
  } catch (error) {
    if (error instanceof DpNaoInstaladoError) return <DpNaoInstalado migration="20261019130000_dp_folha_gerencial.sql" />;
    throw error;
  }
}
