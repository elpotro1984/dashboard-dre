// ============================================================================
// Recorte por EMPRESA do DP — puro e testado. É a regra única de "esta pessoa
// pode ver esta empresa?", usada pelas telas, pelas actions, pelo seletor do
// topo e pelos painéis do grupo. Se cada tela decidisse por conta, uma delas
// acabaria mostrando a empresa errada a uma analista.
//
//   gestor   → `empresas = null` → todas, inclusive quem está SEM empresa
//              definida (só o gestor resolve o de-para).
//   analista → `empresas = [...]` → só essas; nunca "sem empresa".
//
// Analista sem nenhuma empresa liberada vê ZERO — falha fechada.
// ============================================================================

import type { DpRole } from "@/lib/auth/dp";

export interface DpEscopo {
  role: DpRole;
  /** null = todas as empresas (gestor). */
  empresas: string[] | null;
}

export function podeVerEmpresa(escopo: DpEscopo, companyId: string | null): boolean {
  if (escopo.empresas === null) return true;
  if (!companyId) return false;
  return escopo.empresas.includes(companyId);
}

/** Filtra linhas pela empresa já resolvida de cada uma. */
export function recortarPorEmpresa<T>(escopo: DpEscopo, linhas: T[], empresaDe: (l: T) => string | null): T[] {
  if (escopo.empresas === null) return linhas;
  const set = new Set(escopo.empresas);
  return linhas.filter((l) => {
    const c = empresaDe(l);
    return c !== null && set.has(c);
  });
}

/**
 * Empresa ativa do seletor do topo: a do cookie se a pessoa pode vê-la; senão
 * a de maior quadro entre as permitidas (é por onde se começa); null se não
 * houver nenhuma. Cookie de empresa não permitida é IGNORADO, nunca obedecido —
 * o cookie vem do navegador.
 */
export function escolherEmpresaAtiva(
  permitidas: Array<{ id: string; ativos: number }>,
  doCookie: string | null,
): string | null {
  if (permitidas.length === 0) return null;
  if (doCookie && permitidas.some((e) => e.id === doCookie)) return doCookie;
  return permitidas.slice().sort((a, b) => b.ativos - a.ativos)[0].id;
}
