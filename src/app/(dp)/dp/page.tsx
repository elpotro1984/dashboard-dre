import Link from "next/link";
import { redirect } from "next/navigation";

import { DpListaAlertasExperiencia } from "@/components/dp/alertas-experiencia";
import { DpNaoInstalado } from "@/components/dp/nao-instalado";
import { DpSyncPanel } from "@/components/dp/sync-panel";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatDateTimeBR, formatDayBR } from "@/lib/ctrl/datetime";
import { lerExperiencia } from "@/lib/dp/alertas";
import { JANELA_ALERTA_EXPERIENCIA } from "@/lib/dp/vinculo";
import { getDpUser } from "@/lib/dp/auth";
import { recortarPorEmpresa } from "@/lib/dp/escopo";
import { descreverEvento } from "@/lib/dp/historico";
import { DpNaoInstaladoError, lastDpSyncRun, listDpColaboradores, listDpEventosRecentes } from "@/lib/dp/queries";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

/**
 * Visão geral do Departamento Pessoal: o quadro ativo por empresa, vindo da
 * Sólides. É painel do GRUPO (ignora o seletor de empresa do topo), mas sempre
 * recortado pelo escopo: a analista vê só as empresas dela, e "sem empresa
 * definida" e a sincronização são só do gestor.
 */
export default async function DpOverviewPage() {
  const user = await getDpUser();
  if (!user) redirect("/");

  // Admin client depois do gate — ver @/lib/dp/queries.
  const db = createAdminClient();
  const gestor = user.role === "gestor";
  let loaded;
  try {
    const desde = new Date(Date.now() - 30 * 86_400_000).toISOString();
    loaded = await Promise.all([
      listDpColaboradores(db).then((rows) => recortarPorEmpresa(user, rows, (r) => r.empresa.companyId)),
      gestor ? lastDpSyncRun(db) : Promise.resolve(null),
      listDpEventosRecentes(db, desde, user),
      // Falha na leitura não derruba a Visão geral — o cartão diz que não leu.
      lerExperiencia(db, user).catch((e: unknown) => {
        console.error("[dp] experiência:", e instanceof Error ? e.message : e);
        return null;
      }),
    ]);
  } catch (error) {
    if (error instanceof DpNaoInstaladoError) return <DpNaoInstalado />;
    throw error;
  }
  const [rows, lastRun, eventos, alertasExp] = loaded;

  const ativos = rows.filter((r) => r.ativo);
  const semEmpresa = ativos.filter((r) => !r.companyName).length;
  const porEmpresa = new Map<string, number>();
  for (const r of ativos) if (r.companyName) porEmpresa.set(r.companyName, (porEmpresa.get(r.companyName) ?? 0) + 1);
  const empresas = Array.from(porEmpresa).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "pt-BR"));

  return (
    <div className="mx-auto max-w-6xl space-y-4">
      <div>
        <h1 className="text-xl font-semibold text-ink-primary">Departamento Pessoal</h1>
        <p className="text-sm text-ink-muted">
          {gestor ? "Quadro do grupo" : "Quadro das empresas liberadas a você"}, espelhado da Sólides. Módulo de acesso
          restrito — administradores não têm acesso automático.
        </p>
      </div>

      {gestor && <DpSyncPanel lastRun={lastRun} />}

      <div className={`grid gap-3 ${gestor ? "sm:grid-cols-3" : "sm:grid-cols-2"}`}>
        <Stat label="Colaboradores ativos" value={ativos.length} href="/dp/colaboradores" />
        <Stat label="Empresas com quadro" value={empresas.length} />
        {gestor && <Stat label="Sem empresa definida" value={semEmpresa} href="/dp/empresas" alert={semEmpresa > 0} />}
      </div>

      {empresas.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Ativos por empresa</CardTitle>
          </CardHeader>
          <CardContent>
            <table className="w-full text-sm">
              <tbody>
                {empresas.map(([nome, n]) => (
                  <tr key={nome} className="border-t border-border first:border-t-0">
                    <td className="py-1.5 text-ink-primary">{nome}</td>
                    <td className="py-1.5 text-right tabular-nums">{n}</td>
                  </tr>
                ))}
                {semEmpresa > 0 && (
                  <tr className="border-t border-border">
                    <td className="py-1.5">
                      <Link href="/dp/empresas" className="text-amber-700 hover:underline dark:text-amber-400">
                        Sem empresa definida
                      </Link>
                    </td>
                    <td className="py-1.5 text-right tabular-nums text-amber-700 dark:text-amber-400">{semEmpresa}</td>
                  </tr>
                )}
              </tbody>
            </table>
          </CardContent>
        </Card>
      )}
      {/* Sempre à vista: vazio, o cartão diz quando é o próximo vencimento. */}
      <Card className={alertasExp && alertasExp.alertas.length > 0 ? "border-amber-500/40" : undefined}>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Experiência vencendo nos próximos {JANELA_ALERTA_EXPERIENCIA} dias</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          {alertasExp === null ? (
            <p className="text-ink-muted">Não foi possível ler os períodos de experiência agora.</p>
          ) : alertasExp.alertas.length > 0 ? (
            <DpListaAlertasExperiencia alertas={alertasExp.alertas} />
          ) : (
            <p className="text-ink-muted">
              Ninguém com período vencendo nos próximos {JANELA_ALERTA_EXPERIENCIA} dias.
              {alertasExp.proximo && (
                <>
                  {" "}
                  O próximo é em {formatDayBR(alertasExp.proximo.fim)} (em {alertasExp.proximo.diasRestantes} dias):{" "}
                  <Link href={`/dp/colaboradores/${alertasExp.proximo.id}`} className="text-ink-primary hover:underline">
                    {alertasExp.proximo.nome}
                  </Link>
                  , {alertasExp.proximo.periodo === 1 ? "fim do 1º período" : "fim da prorrogação"}
                  {alertasExp.proximo.empresa ? ` · ${alertasExp.proximo.empresa}` : ""}.
                </>
              )}
            </p>
          )}
          <p className="text-xs text-ink-muted">
            Só CLT. O fim do 1º período e o tamanho dele (“2 x 45 dias”) vêm da Sólides; a prorrogação é o fim do 1º + o mesmo
            tamanho. O alerta também aparece na tela inicial de quem tem o DP.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Movimentações dos últimos 30 dias</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          {eventos === null ? (
            <p className="text-ink-muted">Histórico ainda não instalado no banco (migration 20261001160000).</p>
          ) : eventos.length === 0 ? (
            <p className="text-ink-muted">
              Nenhuma movimentação percebida. O histórico registra o que muda na Sólides a partir de 01/10/2026.
            </p>
          ) : (
            <ul className="space-y-1">
              {eventos.map((e) => (
                <li key={e.id} className="flex flex-wrap gap-x-3">
                  <span className="w-32 shrink-0 tabular-nums text-ink-muted">{formatDateTimeBR(e.detectadoEm)}</span>
                  {e.colaboradorId ? (
                    <Link href={`/dp/colaboradores/${e.colaboradorId}`} className="font-medium text-ink-primary hover:underline">
                      {e.nome}
                    </Link>
                  ) : (
                    <span className="font-medium text-ink-primary">{e.nome ?? "—"}</span>
                  )}
                  <span className="text-ink-muted">
                    {descreverEvento({ tipo: e.tipo, campo: e.campo, valor_anterior: e.valorAnterior, valor_novo: e.valorNovo })}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function Stat({ label, value, href, alert }: { label: string; value: number; href?: string; alert?: boolean }) {
  const body = (
    <Card className={alert ? "border-amber-500/40" : undefined}>
      <CardContent className="py-4">
        <p className="text-sm text-ink-muted">{label}</p>
        <p className={`text-2xl font-semibold tabular-nums ${alert ? "text-amber-700 dark:text-amber-400" : "text-ink-primary"}`}>
          {value}
        </p>
      </CardContent>
    </Card>
  );
  return href ? <Link href={href} className="block hover:opacity-90">{body}</Link> : body;
}
