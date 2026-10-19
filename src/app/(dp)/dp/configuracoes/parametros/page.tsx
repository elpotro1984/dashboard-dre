import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";

import { DpParametrosFolhaClient } from "@/components/dp/folha/parametros-client";
import { DpNaoInstalado } from "@/components/dp/nao-instalado";
import { DP_CONFIG_PATH } from "@/lib/auth/dp";
import { todayBR } from "@/lib/ctrl/datetime";
import { getDpUser } from "@/lib/dp/auth";
import { listParametrosVigencias } from "@/lib/dp/folha/queries";
import { DpNaoInstaladoError, listDpCompanies } from "@/lib/dp/queries";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

/** Configurações › Parâmetros da folha — a aba TABELAS da planilha, com vigência. Só o gestor. */
export default async function DpParametrosFolhaPage() {
  const user = await getDpUser();
  if (!user) redirect("/");
  if (user.role !== "gestor") redirect("/dp");

  const db = createAdminClient();
  try {
    const [vigencias, empresas] = await Promise.all([listParametrosVigencias(db), listDpCompanies(db)]);
    return (
      <div className="mx-auto max-w-6xl space-y-4">
        <Link href={DP_CONFIG_PATH} className="inline-flex items-center gap-1 text-sm text-ink-muted hover:text-ink-primary">
          <ArrowLeft className="h-4 w-4" /> Configurações
        </Link>
        <div>
          <h1 className="text-xl font-semibold text-ink-primary">Parâmetros da folha</h1>
          <p className="text-sm text-ink-muted">
            INSS, IRRF, salário-família, planos, VT e alimentação, por vigência. O sistema traz a tabela legal de 2026 como ponto de
            partida — a conferência é do DP.
          </p>
        </div>
        <DpParametrosFolhaClient vigencias={vigencias} empresas={empresas} hoje={todayBR().slice(0, 7)} />
      </div>
    );
  } catch (error) {
    if (error instanceof DpNaoInstaladoError) return <DpNaoInstalado migration="20261019130000_dp_folha_gerencial.sql" />;
    throw error;
  }
}
