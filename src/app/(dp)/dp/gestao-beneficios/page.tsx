import { redirect } from "next/navigation";

import { DpGestaoBeneficiosClient } from "@/components/dp/gestao-beneficios-client";
import { DpNaoInstalado } from "@/components/dp/nao-instalado";
import { todayBR } from "@/lib/ctrl/datetime";
import { getDpUser } from "@/lib/dp/auth";
import { getDpEmpresaAtiva } from "@/lib/dp/empresa-ativa";
import { competenciaValida } from "@/lib/dp/folha/parametros";
import { getGestaoBeneficios } from "@/lib/dp/gestao-beneficios-queries";
import { DpNaoInstaladoError } from "@/lib/dp/queries";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

/**
 * Gestão de benefícios da EMPRESA ATIVA no mês: quanto cada pessoa recebe pelo
 * card "Benefícios" da ficha, com os dias do mês aplicados (férias do Pagamento
 * de férias, admissão e desligamento). De todos do DP, na empresa que alcançam.
 */
export default async function DpGestaoBeneficiosPage({ searchParams }: { searchParams: { competencia?: string } }) {
  const user = await getDpUser();
  if (!user) redirect("/");
  const competencia = competenciaValida(searchParams.competencia) ? searchParams.competencia : todayBR().slice(0, 7);

  const db = createAdminClient();
  try {
    const { ativa } = await getDpEmpresaAtiva(db, user);
    const dados = ativa ? await getGestaoBeneficios(db, ativa.id, competencia) : null;
    return (
      <div className="mx-auto max-w-7xl space-y-4">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-xl font-semibold text-ink-primary">Gestão de benefícios</h1>
            <p className="text-sm text-ink-muted">Quanto cada pessoa recebe de benefício no mês, pelos dias que ela vai trabalhar.</p>
          </div>
          {ativa && <span className="text-sm font-medium text-ink-muted">{ativa.name}</span>}
        </div>
        {ativa && dados ? (
          <DpGestaoBeneficiosClient key={`${ativa.id}-${competencia}`} dados={dados} />
        ) : (
          <p className="text-sm text-ink-muted">Nenhuma empresa liberada para você no Departamento Pessoal.</p>
        )}
      </div>
    );
  } catch (error) {
    if (error instanceof DpNaoInstaladoError) return <DpNaoInstalado migration="20261027170000_dp_beneficios_config.sql" />;
    throw error;
  }
}
