import { redirect } from "next/navigation";

import { DpImpostosClient, type DpImpostosDados } from "@/components/dp/folha/impostos-client";
import { DpNaoInstalado } from "@/components/dp/nao-instalado";
import { todayBR } from "@/lib/ctrl/datetime";
import { getDpUser } from "@/lib/dp/auth";
import { getDpEmpresaAtiva } from "@/lib/dp/empresa-ativa";
import { lerEncargosDaEmpresa } from "@/lib/dp/encargos-dp";
import { competenciaValida } from "@/lib/dp/folha/parametros";
import { getFolhaEmpresa } from "@/lib/dp/folha/queries";
import { DpNaoInstaladoError } from "@/lib/dp/queries";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

/**
 * Impostos da folha do mês da EMPRESA ATIVA: INSS, IRRF, FGTS, salário-família
 * e os encargos da empresa, cada um com a tabela usada, a memória de cálculo
 * por pessoa e o valor manual. Os números são os da Folha do mês (o mesmo
 * motor); o patronal usa as alíquotas do cadastro de encargos da empresa.
 */
export default async function DpImpostosPage({ searchParams }: { searchParams: { competencia?: string } }) {
  const user = await getDpUser();
  if (!user) redirect("/");
  const competencia = competenciaValida(searchParams.competencia) ? searchParams.competencia : todayBR().slice(0, 7);

  const db = createAdminClient();
  try {
    const { ativa } = await getDpEmpresaAtiva(db, user);
    let dados: DpImpostosDados | null = null;
    if (ativa) {
      const [folha, encargos] = await Promise.all([
        getFolhaEmpresa(db, ativa.id, competencia),
        lerEncargosDaEmpresa(db, ativa.id, Number(competencia.slice(0, 4))),
      ]);
      dados = {
        companyId: ativa.id,
        competencia,
        vigencia: folha.vigencia,
        parametros: folha.parametros,
        fechamento: folha.fechamento,
        linhas: folha.linhas,
        lancamentos: Object.fromEntries(
          folha.pessoas.filter((p) => p.temLancamento).map((p) => [p.solidesId, { ajustes: p.lancamento.ajustes, inssFerias: p.lancamento.inssFerias }]),
        ),
        encargos: encargos.values,
        origemEncargos: encargos.origem,
      };
    }
    return (
      <div className="mx-auto max-w-7xl space-y-4">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-xl font-semibold text-ink-primary">Impostos</h1>
            <p className="text-sm text-ink-muted">INSS, IRRF, FGTS e encargos da empresa: a conta de cada pessoa e o que recolher no mês.</p>
          </div>
          {ativa && <span className="text-sm font-medium text-ink-muted">{ativa.name}</span>}
        </div>
        {ativa && dados ? (
          <DpImpostosClient key={`${ativa.id}-${competencia}`} dados={dados} gestor={user.role === "gestor"} />
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
