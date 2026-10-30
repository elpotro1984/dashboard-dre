import { getCurrentSessionContext } from "@/lib/auth/session";
import type { OrcamentoPapel } from "@/lib/supabase/types";
import { ofereceValidacao } from "@/lib/orcamento/validacao-diretoria";
import { setoresDoAnoAtribuidos } from "@/lib/orcamento/setor-atribuicao";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Guard do módulo Orçamento.
 *
 * O módulo era ADMIN-ONLY: uma função só (`getOrcamentoAdmin`) protegia todas
 * as actions, e quem não fosse admin não entrava em lugar nenhum. Com o ciclo
 * construção → validação → retorno, os construtores passaram a ser os GERENTES
 * (cada um nos seus setores) e a diretoria valida — então o guard precisa
 * responder três perguntas, não uma:
 *
 *   1. entra no módulo?            → `getOrcamentoUser()`
 *   2. alcança ESTA empresa?       → `podeVerEmpresa()` / `assertEmpresa()`
 *   3. alcança ESTE setor?         → `setoresDeLeitura()` / `setoresDeEscrita()`
 *
 * O escopo: empresa vem de `orcamento_user_empresas` (a lista do próprio
 * módulo; até a tela nova, espelho das "Unidades" de `user_company_access`) e
 * setor de `orcamento_user_setores`, a atribuição POR EMPRESA do
 * próprio módulo, que casa pelo NOME do setor do orçamento. **Não é
 * `user_sectors`**, que é do Compras e não tem empresa.
 *
 * ── Quem faz o quê ─────────────────────────────────────────────────────────
 *  - `admin`            → tudo, todas as empresas, inclusive a configuração, em
 *                         qualquer fase do ciclo.
 *  - `validador`        → lê as empresas dele sempre. Na janela da validação,
 *                         decide sobre a empresa INTEIRA; fora dela é um
 *                         construtor como os outros, restrito aos setores
 *                         vinculados a ele — a diretoria também monta o próprio
 *                         orçamento (o setor Diretoria).
 *  - `construtor_amplo` → ("Gerente Sócio") lê a empresa inteira, escreve nos
 *                         setores vinculados a ele — e só fora da validação.
 *  - `construtor`       → ("Gerente") lê e escreve só nos setores dele, e só
 *                         fora da validação.
 *
 * Existia uma QUARTA pergunta — "em que fase o ciclo está?" — que tornava o
 * orçamento somente leitura durante a validação. O CICLO foi removido em
 * 24/09/2026 junto com a validação (os dois serão redesenhados), então hoje
 * quem alcança o setor escreve sempre. Ao reconstruir, a trava volta AQUI, em
 * `autorizarEscrita`: foi assim que as 15 actions de escrita a ganharam sem
 * mudar nenhuma delas.
 */
export interface OrcamentoUser {
  userId: string;
  papel: OrcamentoPapel;
  /** Atalho: papel === 'admin'. */
  isAdmin: boolean;
  /** Empresas de `orcamento_user_empresas`; "todas" para admin. */
  companyIds: string[] | "todas";
  /**
   * Setores do COMPRAS vinculados ao usuário (`user_sectors`).
   *
   * **Não é o escopo do Orçamento** desde 29/09/2026: aquele é por empresa e
   * mora em `orcamento_user_setores` (ver `resolverSetoresDoUsuario`). Este
   * campo continua aqui porque a sessão o carrega para o Compras; usá-lo para
   * recortar orçamento devolve o mesmo setor em todas as empresas.
   */
  ctrlSectorIds: string[];
}

/**
 * A tela mostra a este usuário os botões da validação (aprovar/reprovar)?
 *
 * `ofereceValidacao` (o módulo puro da validação) sobre o usuário já carregado
 * — para a página não ter de repetir `user?.papel` espalhado pelas telas.
 * `null` (fora do módulo) nunca vê. Sem aprovação do diretor, ninguém vê.
 */
export function podeValidarOrcamento(
  user: OrcamentoUser | null | undefined,
  aprovacaoDiretor = true,
): boolean {
  // Pergunta de TELA: sem aprovação do diretor não há validação a oferecer
  // (`ofereceValidacao`). Quem decide de fato continua sendo `podeDecidir`.
  return user != null && ofereceValidacao(user.papel, aprovacaoDiretor);
}

/**
 * A empresa × ano tem APROVAÇÃO DO DIRETOR (`orcamento_company_config.
 * aprovacao_diretor`)? Desligada, o gestor que monta o orçamento é quem aprova
 * — ver `podeDecidir`.
 *
 * Sem linha de config, coluna ausente (migration pendente) ou erro: `true`, que
 * é o comportamento de antes da chave. Falhar para o lado do diretor é o seguro
 * — o contrário daria ao gestor o poder de aprovar o próprio orçamento por
 * causa de uma falha de leitura.
 */
export async function aprovacaoDoDiretor(
  supabase: SupabaseClient,
  companyId: string,
  year: number,
): Promise<boolean> {
  const { data, error } = await supabase
    .from("orcamento_company_config")
    .select("aprovacao_diretor")
    .eq("company_id", companyId)
    .eq("year", year)
    .maybeSingle();
  if (error || !data) return true;
  return (data as { aprovacao_diretor?: boolean | null }).aprovacao_diretor !== false;
}

/** Mensagem única de negativa — as actions devolvem `{ error }`, não exceção. */
export const SEM_ACESSO = "Você não tem acesso a este orçamento.";
export const SEM_ACESSO_ADMIN = "Acesso restrito a administradores.";
export const SEM_ACESSO_SETOR =
  "Você só pode alterar o orçamento dos setores vinculados a você.";
/** Recusa por PAPEL: o método é mantido pela administração (ver metodos.ts). */
export const SEM_EDICAO_METODO =
  "Este método é mantido pela administração — você pode consultar, mas não alterar.";

/**
 * Usuário do módulo, ou `null` quando não tem acesso. O papel é resolvido na
 * sessão (perfil + concessão em user_module_roles) — ver @/lib/auth/orcamento.
 */
export async function getOrcamentoUser(): Promise<OrcamentoUser | null> {
  const { supabase, profile, modules } = await getCurrentSessionContext();
  const papel = modules?.orcamento?.papel ?? null;
  if (!profile || !papel) return null;

  return {
    userId: profile.id,
    papel,
    isAdmin: papel === "admin",
    companyIds:
      papel === "admin"
        ? "todas"
        : await empresasDoOrcamento(supabase, profile.id, profile.company_ids),
    ctrlSectorIds: profile.sector_ids,
  };
}

/**
 * Empresas do usuário NO ORÇAMENTO (`orcamento_user_empresas`, migration
 * 20261026120000) — a lista do próprio módulo, que é a mesma que as policies
 * leem. Até a tela de Usuários módulo → perfil, ela é espelho exato de
 * `user_company_access` (gatilho no banco), então o alcance é o de sempre.
 *
 * Fora do `select` da sessão de propósito: embed de tabela que ainda não existe
 * derruba a sessão inteira de todo mundo. Tabela ausente (migration pendente)
 * cai nas unidades do Financeiro — exatamente o comportamento anterior. Qualquer
 * outro erro devolve NENHUMA empresa: falhar para o lado de esconder.
 */
async function empresasDoOrcamento(
  supabase: SupabaseClient,
  userId: string,
  unidadesDoFinanceiro: string[],
): Promise<string[]> {
  // Filtro por usuário EXPLÍCITO, não só pela RLS: a policy deixa admin ler as
  // linhas de todos, e um admin no "ver como" (papel rebaixado na linha de
  // concessão — ver resolveOrcamentoPapel) cai aqui com o papel de construtor.
  const { data, error } = await supabase
    .from("orcamento_user_empresas")
    .select("company_id")
    .eq("user_id", userId);
  if (error) {
    const tabelaAusente = error.code === "42P01" || error.code === "PGRST205";
    return tabelaAusente ? unidadesDoFinanceiro : [];
  }
  return ((data ?? []) as Array<{ company_id: string }>).map((r) => r.company_id);
}

/**
 * Guard das telas de CONFIGURAÇÃO do módulo (método por categoria, plano de
 * cargos, encargos, índices, cadastro de setores). Continua admin-only: um
 * gerente constrói o orçamento, não redefine as premissas dele. Espelha
 * `isOrcamentoConfigPath` em @/lib/auth/access.
 */
export async function getOrcamentoAdmin(): Promise<{ userId: string } | null> {
  const user = await getOrcamentoUser();
  if (!user?.isAdmin) return null;
  return { userId: user.userId };
}

/** True quando o usuário alcança a empresa. */
export function podeVerEmpresa(user: OrcamentoUser, companyId: string): boolean {
  if (user.companyIds === "todas") return true;
  return user.companyIds.includes(companyId);
}

/**
 * True quando o usuário pode ESCREVER no orçamento da empresa.
 *
 * Só o escopo de EMPRESA. Sem ciclo, não há mais uma janela em que um papel
 * escreve e outro não.
 */
export function podeEditarEmpresa(user: OrcamentoUser, companyId: string): boolean {
  return podeVerEmpresa(user, companyId);
}

/**
 * Ids de `orcamento_setores` que o usuário alcança na empresa × ano, ou `null`
 * quando alcança TODOS (admin, validador e Gerente Sócio na leitura).
 *
 * Lista VAZIA é diferente de `null`: significa "nenhum setor" — é o que
 * acontece com um gerente sem setor atribuído NESTA empresa, ou cujo setor
 * ainda não existe neste ano. A consequência é ver nada, nunca ver tudo:
 * falhar para o lado de esconder é deliberado, e `escopo.ts` é quem explica
 * qual dos casos aconteceu.
 */
export async function setoresDeLeitura(
  supabase: SupabaseClient,
  user: OrcamentoUser,
  companyId: string,
  year: number,
): Promise<string[] | null> {
  if (user.isAdmin || user.papel === "validador" || user.papel === "construtor_amplo") {
    return null;
  }
  return resolverSetoresDoUsuario(supabase, user, companyId, year);
}

/**
 * Ids de `orcamento_setores` em que o usuário pode ESCREVER, ou `null` para
 * todos (só admin). O Gerente Sócio lê a empresa inteira mas escreve só nos
 * setores dele — é aqui que os dois papéis de construtor se separam.
 */
export async function setoresDeEscrita(
  supabase: SupabaseClient,
  user: OrcamentoUser,
  companyId: string,
  year: number,
): Promise<string[] | null> {
  if (user.isAdmin) return null;
  // O validador escrevia na empresa INTEIRA durante a janela de validação.
  // Sem ciclo não há janela: ele é um construtor como os outros, restrito aos
  // setores vinculados a ele (a diretoria também monta o próprio orçamento).
  return resolverSetoresDoUsuario(supabase, user, companyId, year);
}

/**
 * Setores que o usuário alcança NESTA empresa × ano.
 *
 * A atribuição é POR EMPRESA (`orcamento_user_setores`) e guarda o NOME do
 * setor do orçamento — não o id da linha (que é por ano) nem o setor do
 * Compras (cuja ponte é opcional e se perde no clone entre anos). Ver
 * `setor-atribuicao.ts`, que é quem casa os nomes.
 *
 * Duas consultas em paralelo e a interseção em memória — PostgREST não faz
 * subconsulta em `in`, e um join aqui obrigaria a expor a tabela de
 * atribuição como embed.
 *
 * **NÃO use `user_sectors` aqui.** Aquilo é o recorte do COMPRAS (alçada de
 * aprovação, tela de Aprovações, lembrete diário) e não tem empresa: usá-lo
 * dava o mesmo setor em todas as empresas que a pessoa alcança, que é
 * exatamente o que esta tabela veio desfazer.
 */
async function resolverSetoresDoUsuario(
  supabase: SupabaseClient,
  user: OrcamentoUser,
  companyId: string,
  year: number,
): Promise<string[]> {
  const [atribuidos, doAno] = await Promise.all([
    supabase
      .from("orcamento_user_setores")
      .select("setor_nome")
      .eq("user_id", user.userId)
      .eq("company_id", companyId),
    supabase
      .from("orcamento_setores")
      .select("id, name")
      .eq("company_id", companyId)
      .eq("year", year),
  ]);

  // Tabela ausente (migration pendente) ou erro: devolve VAZIO, nunca tudo.
  // Falhar para o lado de esconder é deliberado — o aviso de escopo vazio
  // explica o que houve, e `escopo.ts` distingue os motivos.
  if (atribuidos.error || doAno.error) return [];

  return setoresDoAnoAtribuidos(
    ((atribuidos.data ?? []) as Array<Record<string, unknown>>).map(
      (r) => r.setor_nome as string,
    ),
    ((doAno.data ?? []) as Array<Record<string, unknown>>).map((r) => ({
      id: r.id as string,
      name: (r.name as string) ?? "",
    })),
  );
}

/**
 * Guard completo de uma LEITURA de empresa × ano: usuário do módulo, ano
 * válido e empresa no escopo. Devolve também os setores que ele enxerga
 * (`null` = todos), para a action filtrar sem repetir a regra.
 */
export async function autorizarLeitura(
  supabase: SupabaseClient,
  companyId: string,
  year: number,
): Promise<
  | { ok: true; user: OrcamentoUser; setores: string[] | null }
  | { ok: false; error: string }
> {
  const user = await getOrcamentoUser();
  if (!user) return { ok: false, error: SEM_ACESSO };
  if (!podeVerEmpresa(user, companyId)) return { ok: false, error: SEM_ACESSO };
  const setores = await setoresDeLeitura(supabase, user, companyId, year);
  return { ok: true, user, setores };
}

/**
 * Guard completo de uma ESCRITA: tudo o que a leitura confere, mais o papel
 * (a diretoria ainda não escreve) e os setores em que ele pode gravar.
 *
 * Quem chama ainda precisa validar o SETOR DE DESTINO com
 * `podeEscreverNoSetor(res.setores, alvo)` — o destino só é conhecido depois de
 * `setorParaGravar`, que resolve "Todos os setores" para o balde "Não
 * atribuído". É de propósito que um construtor não consiga gravar ali: linha
 * sem dono não é dele.
 */
export async function autorizarEscrita(
  supabase: SupabaseClient,
  companyId: string,
  year: number,
): Promise<
  | {
      ok: true;
      user: OrcamentoUser;
      setores: string[] | null;
    }
  | { ok: false; error: string }
> {
  const user = await getOrcamentoUser();
  if (!user) return { ok: false, error: SEM_ACESSO };
  if (!podeVerEmpresa(user, companyId)) return { ok: false, error: SEM_ACESSO };

  // Aqui ficava a TRAVA POR FASE do ciclo (somente leitura durante a validação).
  // Ela volta neste ponto quando a validação for redesenhada.
  const setores = await setoresDeEscrita(supabase, user, companyId, year);
  return { ok: true, user, setores };
}

/**
 * Confere se o usuário pode escrever numa linha de um setor específico.
 * `setorId` nulo (linha sem setor) só é permitido a admin — uma linha sem setor
 * não pertence a gerente nenhum.
 */
export function podeEscreverNoSetor(
  permitidos: string[] | null,
  setorId: string | null,
): boolean {
  if (permitidos === null) return true; // admin
  if (!setorId) return false;
  return permitidos.includes(setorId);
}
