// =============================================================================
// Valor fixo — os FORNECEDORES do ano-base viram contratos (30/10/2026, pedido
// do dono do projeto: "não quero adicionar manualmente").
//
// Cada contrato do Valor fixo é um valor MENSAL ("valor atual") que o índice
// corrige a partir do mês do reajuste. O que serve de valor atual é o ÚLTIMO
// mês pago ao fornecedor, não a média do ano: um aluguel reajustado em julho
// tem a média abaixo do que se paga hoje, e orçar pela média subestimaria o
// contrato antes mesmo do índice.
//
// ── De onde vem o mês ────────────────────────────────────────────────────────
// O banco já tem a leitura do realizado por fornecedor com as regras de empresa
// efetiva, departamento incluído e departamento roteado
// (`orcamento_planejamento_realizado_itens`), mas ela devolve o total do ano e
// um "total até o mês N". Chamá-la com N = 1..K e tirar a diferença dá o valor
// de cada mês — sem uma segunda leitura de `financial_entries`, que divergiria
// da primeira justamente nas regras de roteamento. As contas moram aqui.
// =============================================================================

/** Abaixo de meio centavo é arredondamento, não pagamento. */
const EPSILON = 0.005;

/** Um fornecedor como as chamadas devolvem: o total e o acumulado até cada mês. */
export interface FornecedorAcumulado {
  fornecedor: string;
  /** Total do ano-base inteiro (inclui o mês em curso). */
  total: number;
  /** `acumulado[k-1]` = total pago até o mês k (k = 1..meses fechados). */
  acumulado: number[];
}

export interface FornecedorSugerido {
  fornecedor: string;
  totalAno: number;
  /** Meses FECHADOS com pagamento. */
  mesesPagos: number;
  /** Mês (1..12) do último pagamento fechado; `null` = só pagou no mês em curso. */
  ultimoMes: number | null;
  /** O valor do contrato: o último mês pago (ou o mês em curso, se só houver ele). */
  valorAtual: number | null;
  /** Pagou em 2+ meses — o que tem cara de contrato fixo, e vem marcado. */
  recorrente: boolean;
}

/** Valor de cada mês fechado a partir do acumulado (diferenças sucessivas). */
export function mesesDoAcumulado(acumulado: readonly number[]): number[] {
  return acumulado.map((v, i) => {
    const mes = v - (i === 0 ? 0 : acumulado[i - 1]);
    return Math.abs(mes) < EPSILON ? 0 : Math.round(mes * 100) / 100;
  });
}

/** O que o ano-base diz sobre UM fornecedor. */
export function sugerirFornecedor(f: FornecedorAcumulado): FornecedorSugerido {
  const meses = mesesDoAcumulado(f.acumulado);
  const pagos = meses.map((v, i) => ({ mes: i + 1, v })).filter((m) => m.v > EPSILON);
  const ultimo = pagos.length > 0 ? pagos[pagos.length - 1] : null;
  const fechado = f.acumulado.length > 0 ? f.acumulado[f.acumulado.length - 1] : 0;
  const emCurso = Math.round((f.total - fechado) * 100) / 100;
  return {
    fornecedor: f.fornecedor,
    totalAno: Math.round(f.total * 100) / 100,
    mesesPagos: pagos.length,
    ultimoMes: ultimo?.mes ?? null,
    valorAtual: ultimo ? ultimo.v : emCurso > EPSILON ? emCurso : null,
    recorrente: pagos.length >= 2,
  };
}

/** Nome comparável: sem acento, caixa ou espaço repetido. */
export function chaveFornecedor(nome: string): string {
  return nome
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLocaleLowerCase("pt-BR")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Junta o mesmo fornecedor vindo de códigos diferentes (a categoria e as
 * gêmeas "(*)" que ela absorve): na construção do orçamento é uma categoria só.
 */
export function juntarFornecedores(
  listas: readonly (readonly FornecedorAcumulado[])[],
): FornecedorAcumulado[] {
  const porChave = new Map<string, FornecedorAcumulado>();
  for (const lista of listas) {
    for (const f of lista) {
      const chave = chaveFornecedor(f.fornecedor);
      if (!chave) continue;
      const atual = porChave.get(chave);
      if (!atual) {
        porChave.set(chave, { ...f, acumulado: [...f.acumulado] });
        continue;
      }
      atual.total += f.total;
      atual.acumulado = atual.acumulado.map((v, i) => v + (f.acumulado[i] ?? 0));
    }
  }
  return Array.from(porChave.values());
}

/** Já existe um contrato com este fornecedor na categoria? (casa pelo nome) */
export function jaContratado(fornecedor: string, descricoes: readonly (string | null)[]): boolean {
  const chave = chaveFornecedor(fornecedor);
  return descricoes.some((d) => d != null && chaveFornecedor(d) === chave);
}

/** A ordem da lista: recorrentes primeiro, depois o maior valor mensal. */
export function ordenarSugeridos(lista: readonly FornecedorSugerido[]): FornecedorSugerido[] {
  return lista
    .slice()
    .sort(
      (a, b) =>
        Number(b.recorrente) - Number(a.recorrente) ||
        (b.valorAtual ?? 0) - (a.valorAtual ?? 0) ||
        a.fornecedor.localeCompare(b.fornecedor, "pt-BR"),
    );
}
