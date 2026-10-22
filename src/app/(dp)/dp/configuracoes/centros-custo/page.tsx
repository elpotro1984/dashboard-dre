import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";

import { DpCentrosCustoClient } from "@/components/dp/centros-custo-client";
import { DpNaoInstalado } from "@/components/dp/nao-instalado";
import { DP_CONFIG_PATH } from "@/lib/auth/dp";
import { getDpUser } from "@/lib/dp/auth";
import { getDpCargosPagina } from "@/lib/dp/cargos-queries";
import { getDpEmpresaAtiva } from "@/lib/dp/empresa-ativa";
import { DpNaoInstaladoError } from "@/lib/dp/queries";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

/**
 * Configurações › Centros de custo, por empresa (era item do menu principal até 22/10/2026). Centro de custo ≠ departamento/setor (o DP
 * trata como coisas diferentes). O padrão de cada pessoa vem da linha da
 * tabela salarial; a exceção é feita na ficha.
 */
export default async function DpCentrosCustoPage() {
  const user = await getDpUser();
  if (!user) redirect("/");
  const db = createAdminClient();
  try {
    // Empresa ativa = seletor do topo, recortado pelo que esta pessoa pode ver.
    const { ativa: escolhida } = await getDpEmpresaAtiva(db, user);
    const pagina = escolhida ? await getDpCargosPagina(db, escolhida.id) : null;

    // Uso de cada centro: linhas da tabela que o têm como padrão e pessoas que caem nele.
    const uso = new Map<string, { linhas: number; pessoas: number }>();
    for (const l of pagina?.tabela ?? []) {
      if (!l.centroCustoId) continue;
      const u = uso.get(l.centroCustoId) ?? { linhas: 0, pessoas: 0 };
      u.linhas += 1;
      uso.set(l.centroCustoId, u);
    }
    for (const r of pagina?.enquadramento ?? []) {
      if (!r.centroId) continue;
      const u = uso.get(r.centroId) ?? { linhas: 0, pessoas: 0 };
      u.pessoas += 1;
      uso.set(r.centroId, u);
    }
    const semCentro = (pagina?.enquadramento ?? []).filter((r) => !r.centroId).length;

    return (
      <div className="mx-auto max-w-4xl space-y-4">
        <Link href={DP_CONFIG_PATH} className="inline-flex items-center gap-1 text-sm text-ink-muted hover:text-ink-primary">
          <ArrowLeft className="h-4 w-4" /> Configurações
        </Link>
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-xl font-semibold text-ink-primary">Centros de custo</h1>
            <p className="text-sm text-ink-muted">
              Diferente do departamento e do setor. O centro de custo de cada pessoa vem da linha dela na tabela salarial — exceções
              se fazem na ficha.
            </p>
          </div>
          {escolhida && <span className="text-sm font-medium text-ink-muted">{escolhida.name}</span>}
        </div>
        {escolhida && pagina ? (
          <DpCentrosCustoClient
            key={escolhida.id}
            companyId={escolhida.id}
            centros={pagina.centros.map((c) => ({ ...c, ...(uso.get(c.id) ?? { linhas: 0, pessoas: 0 }) }))}
            semCentro={semCentro}
            ativos={pagina.enquadramento.length}
          />
        ) : (
          <p className="text-sm text-ink-muted">Nenhuma empresa liberada para você no Departamento Pessoal.</p>
        )}
      </div>
    );
  } catch (error) {
    if (error instanceof DpNaoInstaladoError) return <DpNaoInstalado migration="20261002150000_dp_base_cadastral.sql" />;
    throw error;
  }
}
