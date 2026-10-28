import { redirect } from "next/navigation";

import { DpCustoColaboradorClient, type DpCustoDados } from "@/components/dp/custo-colaborador-client";
import { DpNaoInstalado } from "@/components/dp/nao-instalado";
import { podeVerCustoColaborador } from "@/lib/auth/dp";
import { getSessionContext } from "@/lib/auth/session";
import { todayBR } from "@/lib/ctrl/datetime";
import { getDpUser } from "@/lib/dp/auth";
import { getDpEmpresaAtiva } from "@/lib/dp/empresa-ativa";
import { lerEncargosDaEmpresa } from "@/lib/dp/encargos-dp";
import { ativoNoCusto, custoDoColaborador, entraNoCusto } from "@/lib/dp/folha/custo-colaborador";
import { competenciaValida } from "@/lib/dp/folha/parametros";
import { entradaDe, listParametrosVigencias, listPessoasDaFolha, parametrosDaCompetencia } from "@/lib/dp/folha/queries";
import { DpNaoInstaladoError, lastDpSyncRun, ultimaSincronizacaoOk } from "@/lib/dp/queries";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

/**
 * Custos com colaboradores da EMPRESA ATIVA: quanto cada pessoa custa por mês, com
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
      const [{ pessoas }, vigencias, encargos, sincronizadaEm, ultimaExecucao] = await Promise.all([
        listPessoasDaFolha(db, ativa.id, competencia),
        listParametrosVigencias(db),
        lerEncargosDaEmpresa(db, ativa.id, Number(competencia.slice(0, 4))),
        // Melhor esforço: a data da Sólides é aviso, não pode derrubar a tela.
        ultimaSincronizacaoOk(db).catch(() => null),
        lastDpSyncRun(db).catch(() => null),
      ]);
      const { vigencia, parametros } = parametrosDaCompetencia(vigencias, competencia);
      dados = {
        competencia,
        vigencia,
        fgtsPercentual: parametros.fgtsPercentual,
        encargos: encargos.values,
        origemEncargos: encargos.origem,
        linhas: pessoas
          .filter((p) => entraNoCusto(p, competencia))
          // Setor = o departamento da Sólides, não o "setor da folha" que o DP reclassifica.
          .map((p) => custoDoColaborador({ ...entradaDe(p, ativa.id), setor: p.setor }, parametros, encargos.values, competencia))
          .sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR")),
        avulsosFora: pessoas.filter((p) => p.avulso !== null && ativoNoCusto(p.desligamento, competencia)).length,
        solides: {
          sincronizadaEm,
          falhando: ultimaExecucao?.status === "erro" ? (ultimaExecucao.erro ?? "erro sem mensagem") : null,
        },
      };
    }
    return (
      <div className="mx-auto max-w-7xl space-y-4">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-xl font-semibold text-ink-primary">Custos com colaboradores</h1>
            <p className="text-sm text-ink-muted">
              Quanto cada pessoa da Sólides custa à empresa por mês: salários, encargos e benefícios, com os valores fixos do cadastro.
            </p>
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
