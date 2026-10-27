import { redirect } from "next/navigation";

import { DpFeriasClient } from "@/components/dp/ferias-client";
import { DpNaoInstalado } from "@/components/dp/nao-instalado";
import { todayBR } from "@/lib/ctrl/datetime";
import { getDpUser } from "@/lib/dp/auth";
import { getDpEmpresaAtiva } from "@/lib/dp/empresa-ativa";
import { getFeriasDoMes } from "@/lib/dp/ferias-queries";
import { competenciaValida } from "@/lib/dp/folha/parametros";
import { DpNaoInstaladoError } from "@/lib/dp/queries";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

/**
 * Pagamento de férias da EMPRESA ATIVA, mês a mês (como a Folha): as férias que
 * começam no mês, com dias e valor. É o controle de férias — a fonte de onde a
 * Folha do mês tira os dias de férias de cada pessoa (@/lib/dp/ferias).
 */
export default async function DpFeriasPage({ searchParams }: { searchParams: { competencia?: string } }) {
  const user = await getDpUser();
  if (!user) redirect("/");
  const competencia = competenciaValida(searchParams.competencia) ? searchParams.competencia : todayBR().slice(0, 7);

  const db = createAdminClient();
  try {
    const { ativa } = await getDpEmpresaAtiva(db, user);
    const dados = ativa ? await getFeriasDoMes(db, ativa.id, competencia) : null;
    if (dados && !dados.instalado) return <DpNaoInstalado migration="20261027180000_dp_ferias.sql" />;
    return (
      <div className="mx-auto max-w-6xl space-y-4">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-xl font-semibold text-ink-primary">Pagamento de férias</h1>
            <p className="text-sm text-ink-muted">As férias que começam no mês, com os dias e o valor de cada uma. A Folha do mês tira os dias de férias daqui.</p>
          </div>
          {ativa && <span className="text-sm font-medium text-ink-muted">{ativa.name}</span>}
        </div>
        {ativa && dados ? (
          <DpFeriasClient key={`${ativa.id}-${competencia}`} companyId={ativa.id} dados={dados} />
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
