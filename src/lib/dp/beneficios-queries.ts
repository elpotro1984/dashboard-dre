import "server-only";

import {
  BENEFICIOS_VAZIOS,
  BLOCOS_BENEFICIO,
  blocoValido,
  lerBloco,
  type DpBeneficiosDados,
  type DpBlocoBeneficio,
} from "@/lib/dp/beneficios-config";
import { DpNaoInstaladoError } from "@/lib/dp/queries";
import type { createAdminClient } from "@/lib/supabase/admin";

type AdminClient = ReturnType<typeof createAdminClient>;

export interface DpBlocoSalvo<B extends DpBlocoBeneficio = DpBlocoBeneficio> {
  dados: DpBeneficiosDados[B];
  /** false = o bloco nunca foi salvo nesta empresa (a tela mostra o vazio). */
  salvo: boolean;
  atualizadoEm: string | null;
  atualizadoPor: string | null;
}

export interface DpReajusteBeneficio {
  percentual: number;
  em: string;
  por: string | null;
}

export interface DpBeneficiosEmpresa {
  blocos: { [B in DpBlocoBeneficio]: DpBlocoSalvo<B> };
  /** Os últimos reajustes de cada bloco, do mais recente para o mais antigo. */
  reajustes: Record<DpBlocoBeneficio, DpReajusteBeneficio[]>;
}

function check(error: { code?: string; message: string } | null, what: string): void {
  if (!error) return;
  if (error.code === "PGRST205" || error.code === "42P01") throw new DpNaoInstaladoError();
  throw new Error(`${what}: ${error.message}`);
}

/** Os oito blocos da empresa (o não salvo vem vazio) e os últimos reajustes de cada um. */
export async function getDpBeneficios(db: AdminClient, companyId: string): Promise<DpBeneficiosEmpresa> {
  const [cfg, rj] = await Promise.all([
    db.from("dp_beneficios_config").select("bloco, dados, updated_at, updated_by").eq("company_id", companyId),
    db
      .from("dp_beneficios_reajustes")
      .select("bloco, percentual, aplicado_em, aplicado_por")
      .eq("company_id", companyId)
      .order("aplicado_em", { ascending: false })
      .limit(80),
  ]);
  check(cfg.error, "dp_beneficios_config");
  check(rj.error, "dp_beneficios_reajustes");

  // Nomes em consulta à parte: embed de `users` já foi ambíguo neste projeto (PGRST201).
  const ids = Array.from(
    new Set([...(cfg.data ?? []).map((r) => r.updated_by), ...(rj.data ?? []).map((r) => r.aplicado_por)].filter(Boolean) as string[]),
  );
  const { data: users } = ids.length ? await db.from("users").select("id, name, email").in("id", ids) : { data: [] };
  const nome = (id: string | null) => {
    const u = (users ?? []).find((x) => x.id === id);
    return u ? ((u.name as string | null) ?? (u.email as string)) : null;
  };

  const blocos = Object.fromEntries(
    BLOCOS_BENEFICIO.map((b) => [b, { dados: BENEFICIOS_VAZIOS[b], salvo: false, atualizadoEm: null, atualizadoPor: null }]),
  ) as unknown as DpBeneficiosEmpresa["blocos"];
  for (const r of cfg.data ?? []) {
    const b = r.bloco as string;
    if (!blocoValido(b)) continue;
    (blocos as Record<DpBlocoBeneficio, DpBlocoSalvo>)[b] = {
      dados: lerBloco(b, r.dados),
      salvo: true,
      atualizadoEm: r.updated_at as string,
      atualizadoPor: nome(r.updated_by as string | null),
    };
  }

  const reajustes = Object.fromEntries(BLOCOS_BENEFICIO.map((b) => [b, [] as DpReajusteBeneficio[]])) as Record<DpBlocoBeneficio, DpReajusteBeneficio[]>;
  for (const r of rj.data ?? []) {
    const b = r.bloco as string;
    if (!blocoValido(b) || reajustes[b].length >= 5) continue;
    reajustes[b].push({ percentual: Number(r.percentual), em: r.aplicado_em as string, por: nome(r.aplicado_por as string | null) });
  }
  return { blocos, reajustes };
}
