/**
 * Módulo Departamento Pessoal (DP) — folha, admissão, férias, ponto, eSocial…
 * Construído aos poucos; esta é a fonte de verdade do ACESSO.
 *
 * ── Módulo SIGILOSO ─────────────────────────────────────────────────────────
 * Vai guardar salário, CPF, dados bancários e saúde ocupacional de todo mundo.
 * Por isso segue o modelo do VB, não o do Caixa/Case:
 *
 *  - **Admin NÃO passa por cima.** A única porta é a concessão explícita numa
 *    linha de `user_module_roles` (module='dp').
 *  - **Nenhum admin consegue se conceder.** A policy de `user_module_roles`
 *    deixa qualquer admin escrever ali pelo PostgREST; para o DP um trigger no
 *    banco recusa INSERT/UPDATE/DELETE de linha `module='dp'` que não venha do
 *    service role (ou de migration).
 *  - **Não há botão em Usuários > "Módulos visíveis"**, e o módulo não entra no
 *    catálogo de regras especiais (@/lib/auth/user-exceptions): as duas telas
 *    são vistas por todos os admins. Quem concede é o GESTOR do DP, pela tela
 *    Configurações › Acessos do próprio módulo (desde 19/10/2026).
 *
 * ── Dois papéis (19/10/2026) ───────────────────────────────────────────────
 *  - `gestor`: todas as empresas, Configurações e Acessos.
 *  - `analista`: só as empresas liberadas para ela (`dp_user_empresas`);
 *    trabalha na folha e nos cadastros, sem parâmetros nem acessos.
 *
 * ── Bloqueio nominal ───────────────────────────────────────────────────────
 * `DP_EMAILS_BLOQUEADOS`: pedido do dono do projeto — a admin Carol não vê o
 * DP. Vale mesmo que alguém crie a concessão por engano (pela tela de Acessos
 * ou pelo banco): a sessão, o middleware e a root page ignoram a linha.
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
export const DP_NAV_KEY_CENTROS = "dp-centros-custo";
export const DP_CENTROS_PATH = "/dp/centros-custo";
export const DP_NAV_KEY_CONFIG = "dp-configuracoes";
export const DP_CONFIG_PATH = "/dp/configuracoes";
export const DP_ACESSOS_PATH = "/dp/configuracoes/acessos";
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
 * E-mail bloqueado não entra, com concessão ou sem.
 */
export function resolveDpRole(
  rows: Array<{ module?: string | null; role?: string | null }> | null | undefined,
  email?: string | null,
): DpRole | null {
  if (dpBloqueado(email)) return null;
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
): boolean {
  return resolveDpRole(rows, email) !== null;
}

export function isDpPath(pathname: string): boolean {
  return pathname === DP_PATH || pathname.startsWith(`${DP_PATH}/`);
}

/**
 * Telas só do GESTOR: Configurações (Acessos, parâmetros) e o de-para de
 * empresas — este último decide a que empresa cada pessoa pertence, ou seja, o
 * que cada analista enxerga. A página repete a trava (`requireDpGestor`):
 * esconder do menu nunca é a única defesa.
 */
export function isDpGestorPath(pathname: string): boolean {
  const em = (base: string) => pathname === base || pathname.startsWith(`${base}/`);
  return em(DP_CONFIG_PATH) || em(DP_EMPRESAS_PATH);
}
