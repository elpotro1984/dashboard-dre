import { cookies } from "next/headers";

export const ACTIVE_MODULE_COOKIE = "active_module";
export const ACTIVE_SEGMENT_COOKIE = "active_segment_slug";
// Filtro de empresas COMPARTILHADO entre Dashboard / Fluxo de Caixa / Budget.
// Fonte de verdade lida no SERVIDOR ao renderizar essas telas, para que a
// empresa selecionada sobreviva a navegacao sem depender de round-trip no
// cliente. O nome e duplicado em `shared-company-filter.ts` (modulo client-only,
// que nao pode importar `next/headers`) — manter os dois em sincronia.
export const ACTIVE_COMPANY_IDS_COOKIE = "active_company_ids";
// Empresa ativa do módulo Compras (a "organização de compras" — ver
// docs/superpowers/specs/2026-10-06-ctrl-multiempresa-design.md). Guarda o SLUG
// da org. O chamador valida o slug contra as empresas que o usuário realmente
// pode acessar (ctrl_user_orgs / admin) antes de usar.
export const ACTIVE_CTRL_ORG_COOKIE = "active_ctrl_org";
// Empresa ativa do Departamento Pessoal (id de companies). Validada na leitura
// contra as empresas que a pessoa pode ver — ver @/lib/dp/empresa-ativa.
export const ACTIVE_DP_EMPRESA_COOKIE = "active_dp_empresa";
// Confirmação EXPLÍCITA da empresa do Compras nesta sessão de login. Guarda o
// `session_id` do Supabase Auth em que o usuário escolheu a empresa na tela de
// seleção obrigatória (CtrlOrgGate). Novo login = novo session_id = pergunta de
// novo. O `active_ctrl_org` acima continua lembrando a ÚLTIMA empresa (só para
// marcar "última utilizada" na seleção), mas sozinho não libera as telas.
export const CTRL_ORG_CONFIRMED_COOKIE = "ctrl_org_confirmed";

export type ActiveModule = "dre" | "ctrl" | "case" | "viagens" | "vb" | "caixa" | "dp";

export const VALID_MODULES: readonly ActiveModule[] = ["dre", "ctrl", "case", "viagens", "vb", "caixa", "dp"] as const;

/**
 * Read the active module from cookies. Returns null if not set or invalid.
 * Caller decides the fallback (usually first module the user has access to).
 */
export async function readActiveModule(): Promise<ActiveModule | null> {
  const store = await cookies();
  const raw = store.get(ACTIVE_MODULE_COOKIE)?.value;
  if (!raw) return null;
  return (VALID_MODULES as readonly string[]).includes(raw) ? (raw as ActiveModule) : null;
}

/**
 * Read the active segment slug from cookies. Returns null if not set.
 * Caller is responsible for validating the slug against the user's segments.
 */
export async function readActiveSegmentSlug(): Promise<string | null> {
  const store = await cookies();
  return store.get(ACTIVE_SEGMENT_COOKIE)?.value ?? null;
}

/**
 * Lê o slug da empresa ativa do Compras do cookie. Retorna null se ausente.
 * O chamador valida o slug contra as empresas que o usuário pode acessar.
 */
export async function readActiveCtrlOrgSlug(): Promise<string | null> {
  const store = await cookies();
  return store.get(ACTIVE_CTRL_ORG_COOKIE)?.value ?? null;
}

/** Empresa ativa do DP (id) do cookie, ou null. O chamador valida o acesso. */
export async function readActiveDpEmpresa(): Promise<string | null> {
  const store = await cookies();
  return store.get(ACTIVE_DP_EMPRESA_COOKIE)?.value ?? null;
}

/** Lê o session_id em que a empresa do Compras foi confirmada (ou null). */
export async function readCtrlOrgConfirmedSession(): Promise<string | null> {
  const store = await cookies();
  return store.get(CTRL_ORG_CONFIRMED_COOKIE)?.value ?? null;
}

/**
 * Le o filtro de empresas compartilhado (Dashboard/Fluxo/Budget) do cookie.
 * Retorna a lista de company ids salva pela ultima selecao do usuario, ou []
 * quando ausente. O CHAMADOR deve validar os ids contra as empresas que o
 * usuario realmente pode ver (allowedCompanyIds) — isso garante o escopo por
 * segmento e impede vazamento entre usuarios que compartilham o navegador.
 */
export async function readActiveCompanyIds(): Promise<string[]> {
  const store = await cookies();
  const raw = store.get(ACTIVE_COMPANY_IDS_COOKIE)?.value;
  if (!raw) return [];
  try {
    return decodeURIComponent(raw)
      .split(",")
      .map((id) => id.trim())
      .filter(Boolean);
  } catch {
    // valor corrompido/mal-codificado — ignora e cai no default da tela
    return [];
  }
}

/**
 * Cookie options for the context cookies. 1 year expiry, lax sameSite, path=/.
 * Used by the POST /api/context route handler.
 */
export const CONTEXT_COOKIE_OPTIONS = {
  path: "/",
  maxAge: 60 * 60 * 24 * 365,
  sameSite: "lax" as const,
  httpOnly: false, // readable from client-only code if ever needed; not sensitive
};

/**
 * Opções do cookie de confirmação da empresa do Compras: cookie de SESSÃO (sem
 * maxAge — some ao fechar o navegador). O vínculo com o session_id do login é o
 * que garante o "pergunta a cada login"; a falta de maxAge é reforço.
 */
export const CTRL_ORG_CONFIRMED_COOKIE_OPTIONS = {
  path: "/",
  sameSite: "lax" as const,
  httpOnly: false, // o SignOutButton apaga pelo client ao sair
};
