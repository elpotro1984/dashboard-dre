import type { UnifiedProfile, UserProfileType } from "@/lib/supabase/types";

// ============================================================================
// Quem pode ver/usar a tela "Validação Relatório" (/financeiro/validacao-relatorio).
//
// Regra de negócio (fechada):
//   - perfil CSC;
//   - Admin;
//   - Marcela de Souza  (marcela@quokka.net.br);
//   - Marcelo Gonçalves (marcelo@quokka.net.br).
//
// Qualquer outro usuário NÃO vê o item no menu, é bloqueado no middleware e
// levaria 403 nas rotas de API. Espelha public.can_validate_bi_reports() no
// banco (RLS) — ao mudar um, mude os dois.
//
// ⚠️ AO INCLUIR UM E-MAIL AQUI, confira o catálogo em
//    `src/lib/auth/user-exceptions.ts` — ele já lê esta lista, mas é o que
//    mantém a exceção visível no botão "Regras especiais" da tela de Usuários.
// ============================================================================

/** E-mails nominais liberados além do perfil CSC/admin. Sempre em minúsculas. */
export const BI_VALIDATION_EXTRA_EMAILS: ReadonlySet<string> = new Set([
  "marcela@quokka.net.br",
  "marcelo@quokka.net.br",
]);

/** Rota da tela. Centralizada para o menu, o middleware e os redirects. */
export const BI_VALIDATION_PATH = "/financeiro/validacao-relatorio";

/** Chave do item no menu lateral (NAV_GROUPS). */
export const BI_VALIDATION_NAV_KEY = "fin-validacao";

function normalizeEmail(email: string | null | undefined): string {
  return (email ?? "").trim().toLowerCase();
}

/**
 * Versão "crua" — usada pelo middleware, que só tem `profile` + e-mail do
 * usuário autenticado (não carrega o UnifiedProfile completo).
 */
export function canAccessBiValidationByProfile(
  profile: UserProfileType | null,
  email: string | null | undefined,
): boolean {
  // Validador de contrato é perfil-ILHA: só /contratos, sem exceção nominal.
  // Precisa ser negado aqui também — as rotas /api/* NÃO passam pelo guard de
  // caminho do middleware (ver `isApiRoute` em lib/supabase/middleware.ts), de
  // modo que elas dependem exclusivamente desta função.
  if (profile === "validador_contrato") return false;
  if (profile === "admin" || profile === "csc") return true;
  return BI_VALIDATION_EXTRA_EMAILS.has(normalizeEmail(email));
}

/**
 * Empresas cujos relatórios a pessoa vê e valida: admin, todas (null); os
 * demais (CSC e exceções nominais), SÓ as do Financeiro na tela de Usuários.
 * Até a varredura de 26/10/2026 a tela e as rotas liam TODAS as empresas pelo
 * service role — o acesso à tela não pode virar acesso a empresa.
 */
export function biValidationCompanyScope(
  profile: Pick<UnifiedProfile, "profile" | "role" | "company_ids"> &
    Partial<Pick<UnifiedProfile, "can_financeiro">>,
): string[] | null {
  if (profile.role === "admin" || profile.profile === "admin") return null;
  return profile.can_financeiro === false ? [] : profile.company_ids;
}

/** A linha (empresa) está no escopo da pessoa? */
export function biValidationInScope(escopo: string[] | null, companyId: string): boolean {
  return escopo === null || escopo.includes(companyId);
}

/** Versão usada nas páginas/rotas, a partir do perfil da sessão. */
export function canAccessBiValidation(
  profile: Pick<UnifiedProfile, "profile" | "role" | "email"> &
    Partial<Pick<UnifiedProfile, "financeiro_perfil">> | null,
): boolean {
  if (!profile) return false;
  // A ilha do validador de contrato vence inclusive o `role` legado abaixo.
  if (profile.profile === "validador_contrato") return false;
  // `role` legado ainda marca admins criados antes do modelo unificado.
  if (profile.role === "admin") return true;
  // CSC pelo perfil DO MÓDULO Financeiro (sem perfil gravado, é o próprio
  // profile 'csc' — ver @/lib/auth/module-access).
  if (profile.financeiro_perfil === "csc") return true;
  return canAccessBiValidationByProfile(profile.profile, profile.email);
}
