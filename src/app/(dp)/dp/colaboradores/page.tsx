import Link from "next/link";
import { redirect } from "next/navigation";

import { DpColaboradoresClient } from "@/components/dp/colaboradores-client";
import { DpNaoInstalado } from "@/components/dp/nao-instalado";
import { DP_COLABORADORES_PATH } from "@/lib/auth/dp";
import { getDpUser } from "@/lib/dp/auth";
import { getDpEmpresaAtiva } from "@/lib/dp/empresa-ativa";
import { DpNaoInstaladoError, listDpColaboradores } from "@/lib/dp/queries";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

/**
 * Colaboradores da EMPRESA ATIVA (seletor do topo). O recorte é feito aqui, no
 * servidor: a lista vai para um componente client, e mandar ao navegador quem
 * é de outra empresa para esconder lá seria entregar o dado à analista.
 *
 * Quem está SEM empresa definida não é de empresa nenhuma — só o gestor o vê,
 * pelo recorte `?sem-empresa=1` (é ele quem resolve o de-para).
 */
export default async function DpColaboradoresPage({ searchParams }: { searchParams: { "sem-empresa"?: string } }) {
  const user = await getDpUser();
  if (!user) redirect("/");
  const gestor = user.role === "gestor";
  const semEmpresaView = gestor && searchParams["sem-empresa"] === "1";
  const db = createAdminClient();

  let todos;
  let ativa;
  try {
    [todos, { ativa }] = await Promise.all([listDpColaboradores(db), getDpEmpresaAtiva(db, user)]);
  } catch (error) {
    if (error instanceof DpNaoInstaladoError) return <DpNaoInstalado />;
    throw error;
  }

  const semEmpresa = gestor ? todos.filter((r) => r.empresa.companyId === null) : [];
  const rows = semEmpresaView ? semEmpresa : ativa ? todos.filter((r) => r.empresa.companyId === ativa.id) : [];
  const semEmpresaAtivos = semEmpresa.filter((r) => r.ativo).length;

  return (
    <div className="mx-auto max-w-7xl space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-ink-primary">
            {semEmpresaView ? "Colaboradores sem empresa definida" : "Colaboradores"}
          </h1>
          <p className="text-sm text-ink-muted">
            Cadastro espelhado da Sólides — correções são feitas lá e aparecem aqui na próxima sincronização.
          </p>
        </div>
        {semEmpresaView ? (
          <Link href={DP_COLABORADORES_PATH} className="text-sm text-ink-muted hover:text-ink-primary hover:underline">
            Voltar à empresa ativa
          </Link>
        ) : (
          ativa && <span className="text-sm font-medium text-ink-muted">{ativa.name}</span>
        )}
      </div>

      {!semEmpresaView && semEmpresaAtivos > 0 && (
        <p className="text-sm">
          <Link href={`${DP_COLABORADORES_PATH}?sem-empresa=1`} className="text-amber-700 hover:underline dark:text-amber-400">
            {semEmpresaAtivos} colaborador(es) ativo(s) sem empresa definida
          </Link>
          <span className="text-ink-muted"> — não aparecem em empresa nenhuma até o de-para ser feito.</span>
        </p>
      )}

      {!semEmpresaView && !ativa ? (
        <p className="text-sm text-ink-muted">Nenhuma empresa liberada para você no Departamento Pessoal.</p>
      ) : (
        <DpColaboradoresClient key={semEmpresaView ? "sem" : ativa?.id} rows={rows} semEmpresa={semEmpresaView} />
      )}
    </div>
  );
}
