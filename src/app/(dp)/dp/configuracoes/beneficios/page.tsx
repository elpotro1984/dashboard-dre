import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";

import { DpBeneficiosConfigClient } from "@/components/dp/beneficios-config-client";
import { DpNaoInstalado } from "@/components/dp/nao-instalado";
import { DP_CONFIG_PATH } from "@/lib/auth/dp";
import { getDpUser } from "@/lib/dp/auth";
import { getDpBeneficios } from "@/lib/dp/beneficios-queries";
import { getDpEmpresaAtiva } from "@/lib/dp/empresa-ativa";
import { DpNaoInstaladoError } from "@/lib/dp/queries";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";
// A busca do salário-família na web leva dezenas de segundos.
export const maxDuration = 120;

/**
 * Configurações › Benefícios (empresa ativa): os oito blocos de benefícios que
 * a Gestão de benefícios usa, com os valores desta empresa e o reajuste % de
 * cada bloco. Todos do DP (as duas visões) salvam, reajustam, buscam na web e
 * copiam de outra empresa — desde 29/10/2026; antes só a Estratégica gravava.
 */
export default async function DpBeneficiosPage() {
  const user = await getDpUser();
  if (!user) redirect("/");

  const db = createAdminClient();
  try {
    const { ativa } = await getDpEmpresaAtiva(db, user);
    const beneficios = ativa ? await getDpBeneficios(db, ativa.id) : null;
    return (
      <div className="mx-auto max-w-4xl space-y-4">
        <Link href={DP_CONFIG_PATH} className="inline-flex items-center gap-1 text-sm text-ink-muted hover:text-ink-primary">
          <ArrowLeft className="h-4 w-4" /> Configurações
        </Link>
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-xl font-semibold text-ink-primary">Benefícios</h1>
            <p className="text-sm text-ink-muted">
              Os valores de benefícios desta empresa, bloco a bloco. Cada empresa tem os seus; cada bloco tem o próprio reajuste.
            </p>
          </div>
          {ativa && <span className="text-sm font-medium text-ink-muted">{ativa.name}</span>}
        </div>
        {ativa && beneficios ? (
          <DpBeneficiosConfigClient
            key={ativa.id}
            companyId={ativa.id}
            beneficios={beneficios}
            // As duas visões do DP editam e copiam (29/10/2026); o escopo de empresa já foi conferido acima.
            podeEditar
            podeCopiar
          />
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
