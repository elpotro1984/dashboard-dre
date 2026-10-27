/**
 * Módulo Departamento Pessoal (DP) — folha, admissão, férias, ponto, eSocial…
 * Construído aos poucos; esta é a fonte de verdade do ACESSO.
 *
 * ── Acesso (desde 26/10/2026) ───────────────────────────────────────────────
 * O DP é concedido pela tela de Usuários (módulo → perfil) — a tela de Acessos
 * do próprio módulo saiu — e SÓ PELO LUCAS MEIRELES, a qualquer pessoa,
 * inclusive a um admin (@/lib/auth/concessao-reservada). Por isso o ADMIN NÃO
 * HERDA o DP: sem a linha `module='dp'`, nem admin entra. Se herdasse, qualquer
 * admin abriria o DP a outra conta só por torná-la admin.
 *
 * Isto substituiu, no mesmo dia, duas regras anteriores — não as traga de
 * volta: "admin herda o DP como gestor" e o bloqueio por e-mail da admin Carol
 * (que nunca vê o DP sem a concessão, agora pela regra geral, e que o Lucas
 * pode liberar marcando o módulo no cadastro dela).
 *
 * Ficaram: o trigger do banco que só aceita escrita da linha `module='dp'` pelo
 * service role (a tela de Usuários grava por ele; o console, não) e o registro
 * de cada concessão em `dp_concessoes`. O banco espelha a regra em
 * dp_has_access() (migration 20261026170000).
 *
 * ── Dois papéis ────────────────────────────────────────────────────────────
 *  - `gestor` ("Visão Estratégica"): as empresas marcadas + as configurações
 *    do grupo (parâmetros da folha, de-para de empresas).
 *  - `analista` ("Visão Operacional"): as empresas marcadas; folha e cadastros,
 *    sem as configurações do grupo.
 *  Os dois são recortados por `dp_user_empresas`; o admin COM a concessão vê
 *  todas as empresas.
 *
 * Client-safe: só constantes e funções puras.
 */
export const DP_MODULE = "dp";

export type DpRole = "gestor" | "analista";

export const DP_ROLE_GESTOR: DpRole = "gestor";
export const DP_ROLE_ANALISTA: DpRole = "analista";

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
/** Custo com colaborador — só do admin com a Visão Estratégica (ver podeVerCustoColaborador). */
export const DP_NAV_KEY_CUSTO = "dp-custo-colaborador";
export const DP_CUSTO_PATH = "/dp/custo-colaborador";

/**
 * Papel efetivo no DP a partir das linhas de `user_module_roles`, ou null.
 * Com as duas linhas, `gestor` prevalece. Papel desconhecido não concede nada —
 * falha fechada, para uma linha digitada errado não abrir um módulo sigiloso.
 * Ser admin NÃO conta (ver o cabeçalho): só a linha concede.
 */
export function resolveDpRole(
  rows: Array<{ module?: string | null; role?: string | null }> | null | undefined,
): DpRole | null {
  let role: DpRole | null = null;
  for (const row of rows ?? []) {
    if (row?.module !== DP_MODULE) continue;
    if (row.role === DP_ROLE_GESTOR) return DP_ROLE_GESTOR;
    if (row.role === DP_ROLE_ANALISTA) role = DP_ROLE_ANALISTA;
  }
  return role;
}

/** Há concessão do módulo (qualquer papel)? Para o middleware e a root page. */
export function hasDpGrant(rows: Array<{ module?: string | null; role?: string | null }> | null | undefined): boolean {
  return resolveDpRole(rows) !== null;
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

/**
 * "Custo com colaborador" (27/10/2026): só quem é ADMIN e tem o DP na Visão
 * Estratégica (`gestor`). As duas condições, não uma: a Visão Estratégica sozinha
 * é dada a gente do DP que não é admin, e ser admin não dá o DP (só o Lucas o
 * concede). Mesma regra no menu, no middleware e na página.
 */
export function podeVerCustoColaborador(isAdmin: boolean, role: DpRole | null): boolean {
  return isAdmin && role === DP_ROLE_GESTOR;
}

export function isDpCustoPath(pathname: string): boolean {
  return pathname === DP_CUSTO_PATH || pathname.startsWith(`${DP_CUSTO_PATH}/`);
}
