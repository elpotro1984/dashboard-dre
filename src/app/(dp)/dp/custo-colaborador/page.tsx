import { redirect } from "next/navigation";

import { DpCustoColaboradorClient, type DpCustoDados } from "@/components/dp/custo-colaborador-client";
import { DpNaoInstalado } from "@/components/dp/nao-instalado";
import { podeVerCustoColaborador } from "@/lib/auth/dp";
import { getSessionContext } from "@/lib/auth/session";
import { todayBR } from "@/lib/ctrl/datetime";
import { getDpUser } from "@/lib/dp/auth";
import { getDpEmpresaAtiva } from "@/lib/dp/empresa-ativa";
import { lerEncargosDaEmpresa } from "@/lib/dp/encargos-dp";
import { ativoNoCusto, custoDoColaborador } from "@/lib/dp/folha/custo-colaborador";
import { competenciaValida } from "@/lib/dp/folha/parametros";
import { entradaDe, listParametrosVigencias, listPessoasDaFolha, parametrosDaCompetencia } from "@/lib/dp/folha/queries";
import { DpNaoInstaladoError } from "@/lib/dp/queries";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

/**
 * Custo com colaborador da EMPRESA ATIVA: quanto cada pessoa custa por mês, com
 * os valores fixos do cadastro, despesa a despesa (@/lib/dp/folha/custo-colaborador).
 * Só do admin com a Visão Estratégica do DP — o middleware barra a rota e a
 * página repete a trava.
 */
export default async function DpCustoColaboradorPage({ searchParams }: { searchParams: { competencia?: string } }) {
  const [user, ctx] = await Promise.all([getDpUser(), getSessionContext()]);
  if (!user) redirect("/");
  // O perfil, como o menu e o middleware: as três camadas leem a mesma coisa.
  if (!podeVerCustoColaborador(ctx.profile?.profile === "admin", user.role)) redirect("/dp");
  const competencia = competenciaValida(searchParams.competencia) ? searchParams.competencia : todayBR().slice(0, 7);

  const db = createAdminClient();
  try {
    const { ativa } = await getDpEmpresaAtiva(db, user);
    let dados: DpCustoDados | null = null;
    if (ativa) {
      const [{ pessoas }, vigencias, encargos] = await Promise.all([
        listPessoasDaFolha(db, ativa.id, competencia),
        listParametrosVigencias(db),
        lerEncargosDaEmpresa(db, ativa.id, Number(competencia.slice(0, 4))),
      ]);
      const { vigencia, parametros } = parametrosDaCompetencia(vigencias, competencia);
      dados = {
        competencia,
        vigencia,
        fgtsPercentual: parametros.fgtsPercentual,
        encargos: encargos.values,
        origemEncargos: encargos.origem,
        linhas: pessoas
          .filter((p) => ativoNoCusto(p.desligamento, competencia))
          .map((p) => custoDoColaborador(entradaDe(p, ativa.id), parametros, encargos.values, competencia))
          .sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR")),
      };
    }
    return (
      <div className="mx-auto max-w-7xl space-y-4">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-xl font-semibold text-ink-primary">Custo com colaborador</h1>
            <p className="text-sm text-ink-muted">Quanto cada pessoa custa à empresa por mês: salários, encargos e benefícios, com os valores fixos do cadastro.</p>
          </div>
          {ativa && <span className="text-sm font-medium text-ink-muted">{ativa.name}</span>}
        </div>
        {ativa && dados ? (
          <DpCustoColaboradorClient key={`${ativa.id}-${competencia}`} dados={dados} />
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
