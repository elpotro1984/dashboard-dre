import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";

import { DpAcessosClient } from "@/components/dp/acessos-client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { DP_CONFIG_PATH } from "@/lib/auth/dp";
import { formatDateTimeBR } from "@/lib/ctrl/datetime";
import { ROTULO_PAPEL } from "@/lib/dp/acessos";
import { listDpConcessoes, listDpConcessoesLog, listDpUsuariosElegiveis } from "@/lib/dp/acessos-queries";
import { getDpUser } from "@/lib/dp/auth";
import { listDpEmpresasComQuadro } from "@/lib/dp/cargos-queries";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

const ACAO: Record<"concedeu" | "alterou" | "removeu", string> = {
  concedeu: "concedeu o DP a",
  alterou: "alterou o acesso de",
  removeu: "removeu o acesso de",
};

/**
 * Configurações › Acessos: quem usa o DP. Só o gestor (o middleware já
 * redireciona; esta é a 2ª trava). A tela de Usuários da plataforma continua
 * sem mostrar nada do DP — é aqui, e só aqui, que se concede.
 */
export default async function DpAcessosPage() {
  const user = await getDpUser();
  if (!user) redirect("/");
  if (user.role !== "gestor") redirect("/dp");

  const db = createAdminClient();
  const [concessoes, empresas, log] = await Promise.all([listDpConcessoes(db), listDpEmpresasComQuadro(db), listDpConcessoesLog(db)]);
  const usuarios = await listDpUsuariosElegiveis(db, new Set(concessoes.map((c) => c.userId)));
  const nomeEmpresa = new Map(empresas.map((e) => [e.id, e.name]));
  const empresasOrdenadas = empresas
    .slice()
    .sort((a, b) => Number(b.ativos > 0) - Number(a.ativos > 0) || a.name.localeCompare(b.name, "pt-BR"));

  return (
    <div className="mx-auto max-w-5xl space-y-4">
      <Link href={DP_CONFIG_PATH} className="inline-flex items-center gap-1 text-sm text-ink-muted hover:text-ink-primary">
        <ArrowLeft className="h-4 w-4" /> Configurações
      </Link>
      <div>
        <h1 className="text-xl font-semibold text-ink-primary">Acessos</h1>
        <p className="text-sm text-ink-muted">
          Quem usa o Departamento Pessoal, com qual papel e quais empresas. Ser administrador da plataforma não dá acesso: só o que
          está nesta lista vale.
        </p>
      </div>

      {log === null && (
        <p className="rounded-md border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-sm text-amber-900 dark:text-amber-200">
          Acessos por empresa ainda não instalados no banco (migration 20261019120000). Até lá, só dá para ver a lista — conceder
          analista e registrar as mudanças depende dela.
        </p>
      )}

      <DpAcessosClient concessoes={concessoes} usuarios={usuarios} empresas={empresasOrdenadas} meuId={user.id} />

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Histórico de concessões</CardTitle>
        </CardHeader>
        <CardContent className="text-sm">
          {log === null || log.length === 0 ? (
            <p className="text-ink-muted">
              Nenhuma mudança registrada ainda. Os acessos de Lucas e Marcelo vieram da criação do módulo (29/09/2026).
            </p>
          ) : (
            <ul className="space-y-1">
              {log.map((l) => (
                <li key={l.id} className="flex flex-wrap gap-x-3">
                  <span className="w-32 shrink-0 tabular-nums text-ink-muted">{formatDateTimeBR(l.createdAt)}</span>
                  <span>
                    <span className="font-medium text-ink-primary">{l.por ?? "—"}</span> {ACAO[l.acao]}{" "}
                    <span className="font-medium text-ink-primary">{l.alvo ?? "—"}</span>
                    {l.papel && <span className="text-ink-muted"> · {ROTULO_PAPEL[l.papel]}</span>}
                    {l.papel === "analista" && (
                      <span className="text-ink-muted">
                        {" · "}
                        {l.empresas.length === 0 ? "nenhuma empresa" : l.empresas.map((id) => nomeEmpresa.get(id) ?? "empresa inativa").join(", ")}
                      </span>
                    )}
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
