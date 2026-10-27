// ============================================================================
// Recorte por EMPRESA do DP — puro e testado. É a regra única de "esta pessoa
// pode ver esta empresa?", usada pelas telas, pelas actions, pelo seletor do
// topo e pelos painéis do grupo. Se cada tela decidisse por conta, uma delas
// acabaria mostrando a empresa errada a uma analista.
//
//   `empresas = null`  → todas, inclusive quem está SEM empresa definida. Só o
//                       ADMIN com o DP e sem empresa marcada chega aqui
//                       (escopoDeEmpresasDp).
//   `empresas = [...]` → só essas; nunca "sem empresa". É o caso dos dois
//                       papéis (Visão Estratégica e Operacional) desde
//                       26/10/2026, e do admin com empresas marcadas desde 27/10.
//
// Quem não tem nenhuma empresa liberada vê ZERO — falha fechada.
// ============================================================================

import type { DpRole } from "@/lib/auth/dp";
import { needsOrgConfirmation } from "@/lib/ctrl/org-gate";

export interface DpEscopo {
  role: DpRole;
  /** null = todas as empresas (só o admin sem empresa marcada). */
  empresas: string[] | null;
}

/**
 * O recorte a partir das empresas marcadas na tela de Usuários
 * (`dp_user_empresas`). ADMIN sem nenhuma marcada vê todas — é o "Todas as
 * empresas" da tela, que o Lucas e o Marcelo têm. Admin COM empresas marcadas
 * fica só nelas, como qualquer pessoa (27/10/2026, para a Carol). Quem não é
 * admin: só as marcadas, e nenhuma = zero.
 *
 * Leitura que FALHOU (`null`) vira zero para todos, admin inclusive: tratá-la
 * como "nenhuma marcada" daria todas as empresas justamente ao admin recortado.
 */
export function escopoDeEmpresasDp(marcadas: string[] | null, isAdmin: boolean): string[] | null {
  if (marcadas === null) return [];
  return isAdmin && marcadas.length === 0 ? null : marcadas;
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

/**
 * A tela de escolha OBRIGATÓRIA da empresa (DpEmpresaGate) aparece para quem vê
 * MAIS DE UMA empresa e ainda não escolheu NESTE login — a regra do Compras
 * (needsOrgConfirmation). O cookie da última empresa, sozinho, não libera: ele
 * sobrevive entre logins, e é isso que levava a trabalhar na empresa de ontem
 * sem perceber. Cookie de empresa fora da lista também pergunta.
 */
export function precisaEscolherEmpresa(input: {
  empresas: ReadonlyArray<{ id: string }>;
  cookieId: string | null;
  /** A chave de login gravada quando a empresa foi escolhida (cookie de sessão). */
  confirmada: string | null;
  /** A chave do login atual (session_id do Supabase Auth). */
  chaveDoLogin: string;
}): boolean {
  return needsOrgConfirmation({
    orgCount: input.empresas.length,
    confirmedKey: input.confirmada,
    currentKey: input.chaveDoLogin,
    cookieSlugValid: input.empresas.some((e) => e.id === input.cookieId),
  });
}
