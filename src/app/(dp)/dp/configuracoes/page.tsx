import Link from "next/link";
import { redirect } from "next/navigation";
import { Building2, ChevronRight, Scale, Users } from "lucide-react";
import type { LucideIcon } from "lucide-react";

import { DpSyncPanel } from "@/components/dp/sync-panel";
import { DP_ACESSOS_PATH, DP_EMPRESAS_PATH, DP_PARAMETROS_FOLHA_PATH } from "@/lib/auth/dp";
import { getDpUser } from "@/lib/dp/auth";
import { DpNaoInstaladoError, lastDpSyncRun } from "@/lib/dp/queries";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

interface ConfigCard {
  title: string;
  description: string;
  href: string | null;
  icon: LucideIcon;
}

// Telas de configuração do DP — só do GESTOR. Mesmo padrão de cards do hub do
// Compras (/ctrl/configuracoes). Card sem href aparece como "em breve".
const CARDS: ConfigCard[] = [
  {
    title: "Acessos",
    description: "Quem usa o DP, com qual papel (gestor ou analista) e quais empresas cada analista vê.",
    href: DP_ACESSOS_PATH,
    icon: Users,
  },
  {
    title: "Empresas (de-para da Sólides)",
    description: "A que empresa do Control Hub pertence cada unidade e departamento da Sólides.",
    href: DP_EMPRESAS_PATH,
    icon: Building2,
  },
  {
    title: "Parâmetros da folha",
    description: "INSS, IRRF, salário-família, planos de saúde por faixa etária, VT e alimentação — com vigência.",
    href: DP_PARAMETROS_FOLHA_PATH,
    icon: Scale,
  },
];

export default async function DpConfiguracoesPage() {
  const user = await getDpUser();
  if (!user) redirect("/");
  // O middleware já redireciona a analista; esta é a 2ª trava.
  if (user.role !== "gestor") redirect("/dp");

  let lastRun = null;
  try {
    lastRun = await lastDpSyncRun(createAdminClient());
  } catch (error) {
    if (!(error instanceof DpNaoInstaladoError)) throw error;
  }

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-ink-primary">Configurações do DP</h1>
        <p className="text-sm text-ink-muted">Cadastros e parâmetros do módulo. Só o gestor vê esta área.</p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        {CARDS.map((card) => {
          const Icon = card.icon;
          const corpo = (
            <>
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md border bg-background text-muted-foreground group-hover:text-foreground">
                <Icon className="h-5 w-5" />
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1 font-semibold text-ink-primary">
                  {card.title}
                  {card.href ? (
                    <ChevronRight className="h-4 w-4 opacity-0 transition-opacity group-hover:opacity-100" />
                  ) : (
                    <span className="ml-1 rounded bg-muted px-1.5 py-0.5 text-xs font-normal text-ink-muted">em breve</span>
                  )}
                </div>
                <p className="mt-0.5 text-sm text-ink-muted">{card.description}</p>
              </div>
            </>
          );
          return card.href ? (
            <Link
              key={card.title}
              href={card.href}
              className="group flex items-start gap-4 rounded-lg border bg-card p-5 transition-colors hover:border-primary/40 hover:bg-muted/40"
            >
              {corpo}
            </Link>
          ) : (
            <div key={card.title} className="flex items-start gap-4 rounded-lg border border-dashed bg-card p-5 opacity-70">
              {corpo}
            </div>
          );
        })}
      </div>

      <section className="space-y-2">
        <h2 className="text-base font-semibold text-ink-primary">Sincronização com a Sólides</h2>
        <DpSyncPanel lastRun={lastRun} />
      </section>
    </div>
  );
}
