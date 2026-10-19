import Link from "next/link";
import { redirect } from "next/navigation";
import { ChevronLeft, ChevronRight, Lock } from "lucide-react";

import { brl } from "@/components/dp/folha/formato";
import { DpTotaisTabela } from "@/components/dp/folha/totais-tabela";
import { DpNaoInstalado } from "@/components/dp/nao-instalado";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { todayBR } from "@/lib/ctrl/datetime";
import { getDpUser } from "@/lib/dp/auth";
import { getDpEmpresaAtiva } from "@/lib/dp/empresa-ativa";
import { somarFolha, type DpFolhaResultado } from "@/lib/dp/folha/motor";
import { competenciaValida, rotuloCompetencia, somarMeses } from "@/lib/dp/folha/parametros";
import { getFolhaEmpresa } from "@/lib/dp/folha/queries";
import { totalizar } from "@/lib/dp/folha/totais";
import { DpNaoInstaladoError } from "@/lib/dp/queries";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

/**
 * Folha do GRUPO: a parte da aba TOTAIS que é por EMPRESA, e o mesmo corte por
 * centro de custo, somando as empresas que a pessoa pode ver (gestor: todas;
 * analista: as dela). Server component de ponta a ponta — só os totais saem
 * da página, nenhum salário individual vai ao navegador.
 */
export default async function DpFolhaGrupoPage({ searchParams }: { searchParams: { competencia?: string } }) {
  const user = await getDpUser();
  if (!user) redirect("/");
  const competencia = competenciaValida(searchParams.competencia) ? searchParams.competencia : todayBR().slice(0, 7);
  const db = createAdminClient();

  let porEmpresa: Array<{ id: string; nome: string; fechada: boolean; linhas: DpFolhaResultado[]; rescisoes: number }>;
  try {
    const { empresas } = await getDpEmpresaAtiva(db, user);
    const comQuadro = empresas.filter((e) => e.ativos > 0);
    porEmpresa = await Promise.all(
      comQuadro.map(async (e) => {
        const f = await getFolhaEmpresa(db, e.id, competencia);
        return {
          id: e.id,
          nome: e.name,
          fechada: f.fechamento !== null,
          linhas: f.linhas,
          rescisoes: f.rescisoes.reduce((s, r) => s + r.valor, 0),
        };
      }),
    );
  } catch (error) {
    if (error instanceof DpNaoInstaladoError) return <DpNaoInstalado migration="20261019130000_dp_folha_gerencial.sql" />;
    throw error;
  }

  const nomePorEmpresa = new Map(porEmpresa.map((e) => [e.id, e.nome]));
  const todas = porEmpresa.flatMap((e) => e.linhas);
  const porEmpresaT = totalizar(
    todas,
    (l) => (l.empresaId ? nomePorEmpresa.get(l.empresaId) ?? null : null),
    porEmpresa.map((e) => ({ grupo: e.nome, valor: e.rescisoes })),
  );
  const porCentro = totalizar(todas, (l) => l.centroCusto, []);
  const fechadas = porEmpresa.filter((e) => e.fechada).length;

  return (
    <div className="mx-auto max-w-7xl space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-ink-primary">Folha do grupo</h1>
          <p className="text-sm text-ink-muted">
            Totais da folha gerencial por empresa e por centro de custo —{" "}
            {user.empresas === null ? "todas as empresas do grupo" : `as ${user.empresas.length} empresa(s) liberadas a você`}.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Link href={`?competencia=${somarMeses(competencia, -1)}`} className="rounded-md border border-input p-1.5 hover:bg-muted" aria-label="Mês anterior">
            <ChevronLeft className="h-4 w-4" />
          </Link>
          <span className="min-w-24 text-center text-lg font-semibold text-ink-primary">{rotuloCompetencia(competencia)}</span>
          <Link href={`?competencia=${somarMeses(competencia, 1)}`} className="rounded-md border border-input p-1.5 hover:bg-muted" aria-label="Próximo mês">
            <ChevronRight className="h-4 w-4" />
          </Link>
        </div>
      </div>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">
            Empresas · {fechadas} de {porEmpresa.length} com a folha fechada
          </CardTitle>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <table className="w-full min-w-[860px] text-sm">
            <thead className="text-left text-ink-muted">
              <tr className="border-b border-border">
                <th className="py-2 pr-3 font-medium">Empresa</th>
                <th className="py-2 pr-3 text-right font-medium">Pessoas</th>
                <th className="py-2 pr-3 text-right font-medium">Salário do mês</th>
                <th className="py-2 pr-3 text-right font-medium">Descontos</th>
                <th className="py-2 pr-3 text-right font-medium">5º dia útil</th>
                <th className="py-2 pr-3 text-right font-medium">Benefícios + VT</th>
                <th className="py-2 pr-3 text-right font-medium">FGTS</th>
                <th className="py-2 text-right font-medium">Total geral</th>
              </tr>
            </thead>
            <tbody>
              {porEmpresa.map((e) => {
                const t = somarFolha(e.linhas);
                return (
                  <tr key={e.id} className="border-b border-border">
                    <td className="py-1.5 pr-3 text-ink-primary">
                      {e.nome}
                      {e.fechada ? (
                        <Lock className="ml-1 inline h-3.5 w-3.5 text-emerald-600" aria-label="Fechada" />
                      ) : (
                        <span className="ml-2 text-xs text-amber-700 dark:text-amber-400">aberta</span>
                      )}
                    </td>
                    <td className="py-1.5 pr-3 text-right tabular-nums">{e.linhas.length}</td>
                    <td className="py-1.5 pr-3 text-right tabular-nums">{brl(t.salarioMes)}</td>
                    <td className="py-1.5 pr-3 text-right tabular-nums">{brl(t.totalDescontos)}</td>
                    <td className="py-1.5 pr-3 text-right tabular-nums">{brl(t.quintoDiaUtil)}</td>
                    <td className="py-1.5 pr-3 text-right tabular-nums">{brl(t.totalExtras)}</td>
                    <td className="py-1.5 pr-3 text-right tabular-nums">{brl(t.fgts)}</td>
                    <td className="py-1.5 text-right font-medium tabular-nums">{brl(t.totalGeral)}</td>
                  </tr>
                );
              })}
              {(() => {
                const t = somarFolha(todas);
                return (
                  <tr className="font-semibold">
                    <td className="py-2 pr-3">Grupo</td>
                    <td className="py-2 pr-3 text-right tabular-nums">{todas.length}</td>
                    <td className="py-2 pr-3 text-right tabular-nums">{brl(t.salarioMes)}</td>
                    <td className="py-2 pr-3 text-right tabular-nums">{brl(t.totalDescontos)}</td>
                    <td className="py-2 pr-3 text-right tabular-nums">{brl(t.quintoDiaUtil)}</td>
                    <td className="py-2 pr-3 text-right tabular-nums">{brl(t.totalExtras)}</td>
                    <td className="py-2 pr-3 text-right tabular-nums">{brl(t.fgts)}</td>
                    <td className="py-2 text-right tabular-nums">{brl(t.totalGeral)}</td>
                  </tr>
                );
              })()}
            </tbody>
          </table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Por empresa e categoria</CardTitle>
        </CardHeader>
        <CardContent>
          <DpTotaisTabela t={porEmpresaT} rotuloGrupo="Empresa" />
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Por centro de custo</CardTitle>
        </CardHeader>
        <CardContent>
          <DpTotaisTabela t={porCentro} rotuloGrupo="Centro de custo" />
        </CardContent>
      </Card>

      <p className="text-xs text-ink-muted">
        Folha aberta é calculada com os dados de hoje; fechada, com o retrato do fechamento. A folha oficial continua na contabilidade.
      </p>
    </div>
  );
}
