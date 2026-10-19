import { redirect } from "next/navigation";

import { DpCargosClient } from "@/components/dp/cargos-client";
import { DpNaoInstalado } from "@/components/dp/nao-instalado";
import { getDpUser } from "@/lib/dp/auth";
import { getDpCargosPagina } from "@/lib/dp/cargos-queries";
import { getDpEmpresaAtiva } from "@/lib/dp/empresa-ativa";
import { DpNaoInstaladoError } from "@/lib/dp/queries";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

/**
 * Cargos e salários, por empresa: a tabela salarial (Setor | Cargo | Step |
 * Salário), o de-para dos cargos da Sólides para uma linha dela e o
 * enquadramento de cada pessoa.
 */
export default async function DpCargosPage() {
  const user = await getDpUser();
  if (!user) redirect("/");

  const db = createAdminClient();
  try {
    // Empresa ativa = seletor do topo, recortado pelo que esta pessoa pode ver.
    const { ativa: escolhida } = await getDpEmpresaAtiva(db, user);
    const pagina = escolhida ? await getDpCargosPagina(db, escolhida.id) : null;

    return (
      <div className="mx-auto max-w-7xl space-y-4">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-xl font-semibold text-ink-primary">Cargos e salários</h1>
            <p className="text-sm text-ink-muted">
              A tabela salarial de cada empresa e onde cada pessoa está em relação a ela.
            </p>
          </div>
          {escolhida && <span className="text-sm font-medium text-ink-muted">{escolhida.name}</span>}
        </div>
        {escolhida && pagina ? (
          <DpCargosClient key={escolhida.id} companyId={escolhida.id} companyName={escolhida.name} pagina={pagina} />
        ) : (
          <p className="text-sm text-ink-muted">Nenhuma empresa liberada para você no Departamento Pessoal.</p>
        )}
      </div>
    );
  } catch (error) {
    if (error instanceof DpNaoInstaladoError) return <DpNaoInstalado migration="20261002130000_dp_tabela_salarial.sql" />;
    throw error;
  }
}
