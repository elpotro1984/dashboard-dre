import Link from "next/link";
import { redirect } from "next/navigation";
import { Building2, ChevronRight, Percent, Scale, Target } from "lucide-react";
import type { LucideIcon } from "lucide-react";

import { DpSyncPanel } from "@/components/dp/sync-panel";
import { DP_CENTROS_PATH, DP_EMPRESAS_PATH, DP_ENCARGOS_PATH, DP_PARAMETROS_FOLHA_PATH } from "@/lib/auth/dp";
import { getDpUser } from "@/lib/dp/auth";
import { getDpEmpresaAtiva } from "@/lib/dp/empresa-ativa";
import { DpNaoInstaladoError, lastDpSyncRun } from "@/lib/dp/queries";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

interface ConfigCard {
  title: string;
  description: string;
  href: string;
  icon: LucideIcon;
}

// Configurações do DP em dois blocos (22/10/2026): as da EMPRESA ATIVA, de todos
// do DP, e as do GRUPO, só do gestor (isDpGestorPath barra as rotas). Cargos e
// salários fica no menu principal: é trabalho do dia a dia, não configuração.
const DA_EMPRESA: ConfigCard[] = [
  {
    title: "Centros de custo",
    description: "Cadastro da empresa. O de cada pessoa vem da linha dela na tabela salarial; exceções na ficha.",
    href: DP_CENTROS_PATH,
    icon: Target,
  },
  {
    title: "Encargos da empresa",
    description: "Regime tributário e alíquotas patronais (INSS, RAT × FAP, terceiros) — o mesmo cadastro do Orçamento.",
    href: DP_ENCARGOS_PATH,
    icon: Percent,
  },
];

const DO_GRUPO: ConfigCard[] = [
  {
    title: "Parâmetros da folha",
    description: "INSS, IRRF, salário-família, planos de saúde por faixa etária, VT e alimentação — com vigência.",
    href: DP_PARAMETROS_FOLHA_PATH,
    icon: Scale,
  },
  {
    title: "Empresas (de-para da Sólides)",
    description: "A que empresa do Control Hub pertence cada unidade e departamento da Sólides.",
    href: DP_EMPRESAS_PATH,
    icon: Building2,
  },
];

function Cards({ cards }: { cards: ConfigCard[] }) {
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      {cards.map((card) => {
        const Icon = card.icon;
        return (
          <Link
            key={card.title}
            href={card.href}
            className="group flex items-start gap-4 rounded-lg border bg-card p-5 transition-colors hover:border-primary/40 hover:bg-muted/40"
          >
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md border bg-background text-muted-foreground group-hover:text-foreground">
              <Icon className="h-5 w-5" />
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1 font-semibold text-ink-primary">
                {card.title}
                <ChevronRight className="h-4 w-4 opacity-0 transition-opacity group-hover:opacity-100" />
              </div>
              <p className="mt-0.5 text-sm text-ink-muted">{card.description}</p>
            </div>
          </Link>
        );
      })}
    </div>
  );
}

export default async function DpConfiguracoesPage() {
  const user = await getDpUser();
  if (!user) redirect("/");
  const gestor = user.role === "gestor";

  const db = createAdminClient();
  const { ativa } = await getDpEmpresaAtiva(db, user);
  let lastRun = null;
  if (gestor) {
    try {
      lastRun = await lastDpSyncRun(db);
    } catch (error) {
      if (!(error instanceof DpNaoInstaladoError)) throw error;
    }
  }

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-ink-primary">Configurações do DP</h1>
        <p className="text-sm text-ink-muted">Cadastros e parâmetros do módulo.</p>
      </div>

      <section className="space-y-2">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-base font-semibold text-ink-primary">Desta empresa</h2>
          <span className="text-sm text-ink-muted">{ativa ? ativa.name : "nenhuma empresa liberada"} · troque no seletor do topo</span>
        </div>
        <Cards cards={DA_EMPRESA} />
      </section>

      {gestor && (
        <>
          <section className="space-y-2">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h2 className="text-base font-semibold text-ink-primary">Do grupo</h2>
              <span className="text-sm text-ink-muted">só o gestor vê</span>
            </div>
            <Cards cards={DO_GRUPO} />
          </section>

          <section className="space-y-2">
            <h2 className="text-base font-semibold text-ink-primary">Sincronização com a Sólides</h2>
            <DpSyncPanel lastRun={lastRun} />
          </section>
        </>
      )}
    </div>
  );
}
