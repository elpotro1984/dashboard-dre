/**
 * Módulo Departamento Pessoal (DP) — folha, admissão, férias, ponto, eSocial…
 * Construído aos poucos; esta é a fonte de verdade do ACESSO.
 *
 * ── Acesso (desde 26/10/2026) ───────────────────────────────────────────────
 * Até 26/10/2026 o DP era sigiloso (admin não herdava, concessão só pela tela
 * Configurações › Acessos do próprio módulo, fora da tela de Usuários). Por
 * decisão do dono do projeto, esse regime saiu: o DP é concedido pela tela de
 * Usuários (módulo → perfil), como todo módulo, e o ADMIN o herda — ver
 * docs/superpowers/specs/2026-10-26-usuarios-modulo-perfil.md. Ficaram:
 *
 *  - o trigger do banco que só aceita escrita da linha `module='dp'` pelo
 *    service role (a tela de Usuários grava por ele; o console, não);
 *  - o registro de cada concessão em `dp_concessoes`;
 *  - o bloqueio nominal abaixo.
 *
 * ── Dois papéis ────────────────────────────────────────────────────────────
 *  - `gestor` ("Visão Estratégica"): as empresas marcadas + as configurações
 *    do grupo (parâmetros da folha, de-para de empresas).
 *  - `analista` ("Visão Operacional"): as empresas marcadas; folha e cadastros,
 *    sem as configurações do grupo.
 *  Os dois são recortados por `dp_user_empresas`; só o admin vê todas.
 *
 * ── Bloqueio nominal (regra especial) ──────────────────────────────────────
 * `DP_EMAILS_BLOQUEADOS`: pedido do dono do projeto — a admin Carol não vê o
 * DP, apesar de admin. Vale mesmo que alguém crie a concessão por engano: a
 * sessão, o middleware, a root page e dp_has_access() ignoram a linha. Está no
 * catálogo de regras especiais (@/lib/auth/user-exceptions).
 *
 * Client-safe: só constantes e funções puras.
 */
export const DP_MODULE = "dp";

export type DpRole = "gestor" | "analista";

export const DP_ROLE_GESTOR: DpRole = "gestor";
export const DP_ROLE_ANALISTA: DpRole = "analista";

/**
 * E-mails que NUNCA entram no DP, com ou sem concessão. Não é lista de
 * permissão: é a trava para um engano na tela de Acessos não abrir o módulo a
 * quem o dono do projeto decidiu que não vê. Comparação sem caixa.
 */
export const DP_EMAILS_BLOQUEADOS: readonly string[] = ["carol@quokka.net.br"];

export function dpBloqueado(email: string | null | undefined): boolean {
  const e = (email ?? "").trim().toLowerCase();
  return e !== "" && DP_EMAILS_BLOQUEADOS.includes(e);
}

/** Rota raiz do módulo. */
export const DP_PATH = "/dp";

/** Chaves e rotas dos itens do DP no menu lateral. */
export const DP_NAV_KEY_OVERVIEW = "dp-overview";
export const DP_NAV_KEY_COLABORADORES = "dp-colaboradores";
export const DP_COLABORADORES_PATH = "/dp/colaboradores";
export const DP_NAV_KEY_EMPRESAS = "dp-empresas";
export const DP_EMPRESAS_PATH = "/dp/empresas";
export const DP_NAV_KEY_INDICADORES = "dp-indicadores";
export const DP_INDICADORES_PATH = "/dp/indicadores";
export const DP_NAV_KEY_CARGOS = "dp-cargos";
export const DP_CARGOS_PATH = "/dp/cargos";
export const DP_NAV_KEY_SIMULACOES = "dp-simulacoes";
export const DP_SIMULACOES_PATH = "/dp/simulacoes";
export const DP_NAV_KEY_CONFIG = "dp-configuracoes";
export const DP_CONFIG_PATH = "/dp/configuracoes";
/** Configurações da EMPRESA ativa — de todos do DP. */
export const DP_CENTROS_PATH = "/dp/configuracoes/centros-custo";
export const DP_ENCARGOS_PATH = "/dp/configuracoes/encargos";
/** Configurações do GRUPO — só do gestor (ver isDpGestorPath). */
export const DP_PARAMETROS_FOLHA_PATH = "/dp/configuracoes/parametros";
export const DP_NAV_KEY_FOLHA = "dp-folha";
export const DP_FOLHA_PATH = "/dp/folha";
export const DP_NAV_KEY_DECIMO = "dp-decimo-terceiro";
export const DP_NAV_KEY_IMPOSTOS = "dp-impostos";
export const DP_IMPOSTOS_PATH = "/dp/impostos";
export const DP_DECIMO_PATH = "/dp/decimo-terceiro";
export const DP_NAV_KEY_FOLHA_GRUPO = "dp-folha-grupo";
export const DP_FOLHA_GRUPO_PATH = "/dp/folha-grupo";

/**
 * Papel efetivo no DP a partir das linhas de `user_module_roles`, ou null.
 * Com as duas linhas, `gestor` prevalece. Papel desconhecido não concede nada —
 * falha fechada, para uma linha digitada errado não abrir um módulo sigiloso.
 * E-mail bloqueado não entra, com concessão ou sem — nem sendo admin.
 *
 * Admin herda o DP como `gestor` desde 26/10/2026 (tela de Usuários módulo →
 * perfil: "Admin tem acesso a todos os módulos"). Espelha dp_has_access() no
 * banco (migration 20261026120000).
 */
export function resolveDpRole(
  rows: Array<{ module?: string | null; role?: string | null }> | null | undefined,
  email?: string | null,
  isAdmin: boolean = false,
): DpRole | null {
  if (dpBloqueado(email)) return null;
  if (isAdmin) return DP_ROLE_GESTOR;
  let role: DpRole | null = null;
  for (const row of rows ?? []) {
    if (row?.module !== DP_MODULE) continue;
    if (row.role === DP_ROLE_GESTOR) return DP_ROLE_GESTOR;
    if (row.role === DP_ROLE_ANALISTA) role = DP_ROLE_ANALISTA;
  }
  return role;
}

/** Há concessão do módulo (qualquer papel)? Para o middleware e a root page. */
export function hasDpGrant(
  rows: Array<{ module?: string | null; role?: string | null }> | null | undefined,
  email?: string | null,
  isAdmin: boolean = false,
): boolean {
  return resolveDpRole(rows, email, isAdmin) !== null;
}

export function isDpPath(pathname: string): boolean {
  return pathname === DP_PATH || pathname.startsWith(`${DP_PATH}/`);
}

/**
 * Telas só do GESTOR: as configurações do GRUPO — Parâmetros da folha e o
 * de-para de empresas (a tela de Acessos saiu em 26/10/2026: o DP é concedido
 * pela tela de Usuários) (que decide a que empresa cada pessoa pertence, ou
 * seja, o que cada analista enxerga). O hub de Configurações e as telas da
 * empresa ativa (centros de custo, encargos) são de todos do DP desde
 * 22/10/2026. A página repete a trava: esconder do menu nunca é a única defesa.
 */
export function isDpGestorPath(pathname: string): boolean {
  const em = (base: string) => pathname === base || pathname.startsWith(`${base}/`);
  return em(DP_PARAMETROS_FOLHA_PATH) || em(DP_EMPRESAS_PATH);
}
