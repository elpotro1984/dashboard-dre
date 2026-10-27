// =============================================================================
// As opções de um <select> de cargo no quadro de pessoal.
//
// A regra é uma só, e ela não é cosmética: **o valor gravado nunca desaparece
// da tela.**
//
// O quadro tem três campos de cargo (atual, movimentação 1 e 2) e todos são
// `<select>`. A tela filtrava o valor contra a lista de opções e exibia vazio
// quando não achava — então um cargo que EXISTE no banco aparecia como
// "— cargo —". Enquanto a única origem era o Plano de Cargos isso quase nunca
// acontecia; passou a acontecer sempre que uma segunda origem entrou:
//
//  - o sync do DP grava o nome da linha da tabela salarial do Departamento
//    Pessoal, que não está no Plano de Cargos do Orçamento;
//  - um nível renomeado ou removido do plano deixa para trás o cargo de quem
//    já estava no quadro;
//  - o cargo digitado antes de o plano existir.
//
// Mostrar vazio é o pior resultado possível aqui: o número do orçamento usa o
// salário, que continua certo, então nada denuncia o problema — e o primeiro
// clique no seletor substitui um cargo que ninguém queria trocar.
//
// Módulo PURO: a mesma regra vale nos três campos, e um `cargoValue` local por
// campo foi exatamente o que deixou o buraco passar.
// =============================================================================

export interface CargoOpcao {
  label: string;
  /** Salário-base sugerido ao escolher. `null` = a origem não sugere nenhum. */
  salario: number | null;
  /**
   * `lista` — veio do cadastro (Plano de Cargos, ou a tabela salarial do DP).
   * `gravado` — está na linha e NÃO está no cadastro. A tela o marca, porque
   * escolhê-lo não traz salário e o admin precisa saber por quê.
   */
  fonte: "lista" | "gravado";
}

/**
 * As opções a renderizar, com o valor gravado garantido na frente.
 *
 * A opção sintética entra PRIMEIRO de propósito: é o valor atual do campo, e um
 * `<select>` cujo valor selecionado está no fim de uma lista de 200 cargos não
 * mostra ao usuário o que ele tem.
 */
export function opcoesDeCargo(
  lista: readonly { label: string; salario: number }[],
  atual: string | null | undefined,
): CargoOpcao[] {
  const opcoes: CargoOpcao[] = lista.map((o) => ({
    label: o.label,
    salario: o.salario,
    fonte: "lista",
  }));

  const gravado = (atual ?? "").trim();
  if (!gravado) return opcoes;
  if (opcoes.some((o) => o.label === gravado)) return opcoes;

  return [{ label: gravado, salario: null, fonte: "gravado" }, ...opcoes];
}

/** O rótulo que a tela mostra para a opção, marcando a que não está no cadastro. */
export function rotuloOpcaoDeCargo(o: CargoOpcao): string {
  return o.fonte === "gravado" ? `${o.label} (fora do cadastro)` : o.label;
}

/**
 * De qual lista o campo de MOVIMENTAÇÃO escolhe.
 *
 * Decisão de 27/10/2026: a movimentação usa a **tabela salarial do DP** — é o
 * cadastro que o Departamento Pessoal mantém de verdade, com cargo, senioridade
 * e step separados. O Plano de Cargos do Orçamento continua existindo e é quem
 * define o cargo ATUAL e os benefícios.
 *
 * Com o DP sem tabela para a empresa, cai no Plano de Cargos em vez de deixar o
 * campo vazio: degradar para o comportamento anterior é melhor que tirar do
 * gestor a única forma de preencher a movimentação.
 *
 * **Não misture as duas listas num seletor só.** O mesmo cargo existiria duas
 * vezes com salários diferentes — e um deles traz benefícios do nível e o outro
 * não, o que mudaria o custo da pessoa dependendo de qual linha o gestor
 * clicou, sem nada na tela explicando a diferença.
 */
export function listaDaMovimentacao<T>(doDp: readonly T[], doPlano: readonly T[]): readonly T[] {
  return doDp.length > 0 ? doDp : doPlano;
}

// ─── Salário digitado à mão ─────────────────────────────────────────────────

/** Meio centavo: o mesmo corte usado no resto do módulo. */
const EPSILON = 0.005;

/**
 * O salário que a lista oferece para este cargo, ou `null` quando ela não o
 * tem (cargo digitado à mão, ou nível que saiu do cadastro).
 */
export function salarioDoCargo(
  lista: readonly { label: string; salario: number }[],
  cargo: string | null | undefined,
): number | null {
  const nome = (cargo ?? "").trim();
  if (!nome) return null;
  const achado = lista.find((o) => o.label === nome);
  return achado ? achado.salario : null;
}

/**
 * Este salário foi digitado à mão, em vez de vir da tabela de cargos?
 *
 * A marca é DERIVADA, não uma coluna: comparar o valor com o que a tabela
 * oferece para o cargo escolhido responde a pergunta sem guardar nada, e
 * continua respondendo depois de recarregar a tela — que é o que o pedido
 * exige ("deve ficar marcado com *").
 *
 * Três casos dão `true`, e os três merecem a marca:
 *  - cargo que a lista NÃO tem (foi digitado): não há de onde o número viesse;
 *  - cargo da lista com valor diferente: alguém editou por cima;
 *  - salário sem cargo nenhum: idem, não veio de lista.
 *
 * Consequência assumida: se a tabela de cargos mudar DEPOIS, um valor que veio
 * dela passa a aparecer marcado. Não é erro de leitura — aquele número deixou
 * de ser o da tabela, que é exatamente o que a marca informa. Por isso a
 * legenda fala em "não é o da tabela", e não em "alguém digitou".
 */
export function salarioEhManual(input: {
  lista: readonly { label: string; salario: number }[];
  cargo: string | null | undefined;
  salario: number | null | undefined;
}): boolean {
  const { salario } = input;
  // Sem valor não há o que marcar — a célula está vazia.
  if (salario == null || !Number.isFinite(salario)) return false;
  const daTabela = salarioDoCargo(input.lista, input.cargo);
  if (daTabela == null) return true;
  return Math.abs(daTabela - salario) >= EPSILON;
}

/** A legenda do asterisco, num lugar só — a tela e um export futuro concordam. */
export const LEGENDA_SALARIO_MANUAL =
  "* salário digitado à mão: não é o valor que a tabela de cargos dá para esse cargo.";
