// ============================================================================
// Planilha de QUALQUER origem → pessoas da folha — puro e testado. É a base de
// duas telas: a CONFERÊNCIA com a folha da contabilidade (o resumo que ela
// manda todo mês) e o LANÇAMENTO de valores do mês vindos de fora (fatura da
// operadora, comissões). Não há layout fixo: na primeira vez o DP aponta qual
// coluna é o quê, e o sistema guarda o mapeamento por empresa — guardando o
// NOME do cabeçalho, não a posição, para a coluna mudar de lugar no mês
// seguinte sem quebrar nada.
//
// Casamento: CPF quando a planilha tem (é exato); senão nome, pela mesma regra
// da importação da planilha do DP (exato, depois continência com UM candidato).
// Pessoa que aparece em várias linhas (relatório por rubrica) tem os valores
// SOMADOS — e isso é contado, para ninguém se surpreender.
// ============================================================================

import { casarNome, normalizarNome, type DpPessoaParaCasar } from "@/lib/dp/folha/importacao";
import type { DpFolhaLancamento, DpFolhaResultado } from "@/lib/dp/folha/motor";

// ── leitura das células ────────────────────────────────────────────────────

/** Valor da célula: número, "1.234,56", "R$ 1.234,56", "(1.234,56)" e "1.234,56-" (negativos). Vazio = null. */
export function lerValor(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v !== "string") return null;
  let t = v.trim();
  if (!t) return null;
  let neg = false;
  if (/^\(.*\)$/.test(t)) {
    neg = true;
    t = t.slice(1, -1);
  }
  if (t.endsWith("-")) {
    neg = true;
    t = t.slice(0, -1);
  }
  if (t.startsWith("-")) {
    neg = true;
    t = t.slice(1);
  }
  t = t.replace(/R\$|\s/g, "");
  if (!/^[\d.,]+$/.test(t)) return null;
  const n = Number(t.includes(",") ? t.replace(/\./g, "").replace(",", ".") : t);
  return Number.isFinite(n) ? (neg ? -n : n) : null;
}

/** CPF só com dígitos; o Excel come os zeros da frente quando a coluna é número. */
export function normalizarCpf(v: unknown): string | null {
  const d = String(v ?? "").replace(/\D/g, "");
  if (d.length < 9 || d.length > 11) return null;
  return d.padStart(11, "0");
}

// ── cabeçalho ──────────────────────────────────────────────────────────────

export interface DpPlanilhaLida {
  cabecalho: string[];
  /** Linhas de dados (depois do cabeçalho), sem as totalmente vazias. */
  linhas: unknown[][];
  linhaCabecalho: number;
}

/**
 * O cabeçalho é a linha, entre as 20 primeiras, com MAIS células de texto
 * (relatório de contabilidade costuma ter título, CNPJ e competência antes).
 */
export function lerPlanilhaGenerica(matriz: unknown[][]): DpPlanilhaLida | { erro: string } {
  let melhor = -1;
  let melhorN = 1;
  for (let i = 0; i < Math.min(20, matriz.length); i++) {
    const n = (matriz[i] ?? []).filter((c) => typeof c === "string" && c.trim() && lerValor(c) === null).length;
    if (n > melhorN) {
      melhor = i;
      melhorN = n;
    }
  }
  if (melhor < 0) return { erro: "Não encontrei uma linha de cabeçalho (nomes das colunas) na planilha." };
  const cabecalho = (matriz[melhor] ?? []).map((c) => String(c ?? "").replace(/\s+/g, " ").trim());
  const linhas = matriz.slice(melhor + 1).filter((r) => (r ?? []).some((c) => c !== "" && c !== null && c !== undefined));
  return { cabecalho, linhas, linhaCabecalho: melhor + 1 };
}

/** Índice da coluna pelo nome guardado (sem acento/caixa); -1 se a planilha não tem. */
export function indiceDaColuna(cabecalho: string[], nome: string | null | undefined): number {
  if (!nome) return -1;
  const alvo = normalizarNome(nome);
  return cabecalho.findIndex((c) => normalizarNome(c) === alvo);
}

// ── o que se confere ───────────────────────────────────────────────────────

export const CAMPOS_CONFERENCIA = [
  "salarioMes",
  "ferias",
  "totalEntradas",
  "inssMes",
  "irrf",
  "fgts",
  "vtDesconto",
  "planoSaude",
  "coparticipacao",
  "salarioFamilia",
  "adiantamento",
  "totalDescontos",
  "saldo",
  "quintoDiaUtil",
] as const;
export type DpCampoConferencia = (typeof CAMPOS_CONFERENCIA)[number];

export const ROTULO_CONFERENCIA: Record<DpCampoConferencia, string> = {
  salarioMes: "Salário do mês",
  ferias: "Férias + 1/3",
  totalEntradas: "Total de proventos",
  inssMes: "INSS do mês",
  irrf: "IRRF",
  fgts: "FGTS",
  vtDesconto: "Desconto de VT",
  planoSaude: "Plano de saúde",
  coparticipacao: "Coparticipação",
  salarioFamilia: "Salário-família",
  adiantamento: "Adiantamento",
  totalDescontos: "Total de descontos",
  saldo: "Líquido (antes do adiantamento)",
  quintoDiaUtil: "Líquido a receber",
};

/** O número da folha daqui para um campo da conferência. */
export function valorDaFolha(r: DpFolhaResultado, campo: DpCampoConferencia): number {
  if (campo === "inssMes") return Math.round((r.inss + r.inssFerias) * 100) / 100;
  if (campo === "ferias") return r.totalFerias;
  return r[campo];
}

/**
 * Palavras do cabeçalho que sugerem cada coluna (primeira vez, sem layout
 * guardado). Cada campo tem pistas em ORDEM de especificidade, e a pista
 * específica de todos os campos é tentada antes da genérica de qualquer um —
 * senão "Salário Bruto Carteira" levaria o salário do mês e "TOTAL GERAL (…
 * Líquido)" o líquido a receber (os dois erros apareceram no ensaio com a
 * planilha real de set/2026).
 */
const PISTAS: Array<[DpCampoConferencia | "cpf" | "nome", RegExp[]]> = [
  ["cpf", [/\bcpf\b/]],
  ["nome", [/\b(nomes?|funcionarios?|colaboradores?|empregados?)\b/]],
  ["quintoDiaUtil", [/liquido a receber|a receber|dia util|valor liquido/, /^liquido$/]],
  ["saldo", [/liquido antes|^saldo/]],
  ["totalDescontos", [/total (de )?descontos|descontos total/]],
  ["totalEntradas", [/total (de )?(proventos|vencimentos|entradas)|proventos total/, /vencimentos/]],
  ["inssMes", [/\binss\b(?!.*ferias)/]],
  ["irrf", [/\birrf\b|imposto de renda/, /\bir\b/]],
  ["fgts", [/\bfgts\b/]],
  ["vtDesconto", [/(desconto|desc) (de )?(vale )?transporte|desconto vt/]],
  ["salarioFamilia", [/salario familia/]],
  ["adiantamento", [/adiantamento/]],
  ["coparticipacao", [/copart/]],
  ["planoSaude", [/plano de saude|assistencia medica/, /plano|saude|medic/]],
  ["ferias", [/total (de )?ferias/, /^ferias/]],
  ["salarioMes", [/salario (bruto )?do mes|salario mes|salario base|base/, /salario/]],
];

export interface DpMapeamentoPlanilha {
  /** Nome da coluna que identifica a pessoa. */
  identificador: string;
  tipoIdentificador: "cpf" | "nome";
  /** Campo da folha → nome da coluna na planilha. */
  campos: Partial<Record<DpCampoConferencia, string>>;
}

export function sugerirMapeamento(cabecalho: string[]): DpMapeamentoPlanilha {
  const usados = new Set<number>();
  const achados = new Map<string, number>();
  const norm = cabecalho.map((c) => normalizarNome(c));
  // Rodada 1: a pista mais específica de cada campo; rodada 2: as genéricas.
  const rodadas = Math.max(...PISTAS.map(([, rs]) => rs.length));
  for (let r = 0; r < rodadas; r++) {
    for (const [k, rs] of PISTAS) {
      if (achados.has(k) || !rs[r]) continue;
      const i = norm.findIndex((c, j) => !usados.has(j) && rs[r].test(c));
      if (i >= 0) {
        usados.add(i);
        achados.set(k, i);
      }
    }
  }
  const iCpf = achados.get("cpf") ?? -1;
  const iNome = achados.get("nome") ?? -1;
  const campos: DpMapeamentoPlanilha["campos"] = {};
  for (const [k, i] of Array.from(achados)) {
    if (k !== "cpf" && k !== "nome") campos[k as DpCampoConferencia] = cabecalho[i];
  }
  return {
    identificador: iCpf >= 0 ? cabecalho[iCpf] : iNome >= 0 ? cabecalho[iNome] : "",
    tipoIdentificador: iCpf >= 0 ? "cpf" : "nome",
    campos,
  };
}

// ── casar as linhas com as pessoas ─────────────────────────────────────────

export interface DpPessoaDaFolha extends DpPessoaParaCasar {
  cpf: string | null;
}

export interface DpLinhaCasada {
  solidesId: number;
  /** Valores somados de todas as linhas da pessoa, por coluna. */
  valores: Record<string, number>;
  linhas: number;
}

export interface DpCasamentoPlanilha {
  casadas: Map<number, DpLinhaCasada>;
  naoEncontradas: string[];
  ambiguas: string[];
  /** Pessoas que apareciam em mais de uma linha (valores somados). */
  repetidas: number;
}

export function casarPlanilha(
  p: DpPlanilhaLida,
  identificador: string,
  tipo: "cpf" | "nome",
  colunas: string[],
  pessoas: DpPessoaDaFolha[],
): DpCasamentoPlanilha {
  const iId = indiceDaColuna(p.cabecalho, identificador);
  const idx = colunas.map((c) => [c, indiceDaColuna(p.cabecalho, c)] as const).filter(([, i]) => i >= 0);
  const porCpf = new Map(pessoas.filter((x) => x.cpf).map((x) => [x.cpf as string, x.solidesId]));
  const out: DpCasamentoPlanilha = { casadas: new Map(), naoEncontradas: [], ambiguas: [], repetidas: 0 };
  if (iId < 0) return out;
  for (const row of p.linhas) {
    const bruto = row[iId];
    const rotulo = String(bruto ?? "").trim();
    if (!rotulo) continue;
    let id: number | null = null;
    if (tipo === "cpf") {
      const cpf = normalizarCpf(bruto);
      id = cpf ? porCpf.get(cpf) ?? null : null;
      if (id === null) {
        out.naoEncontradas.push(rotulo);
        continue;
      }
    } else {
      const c = casarNome(rotulo, pessoas);
      if (c.tipo === "nenhum") {
        // Linha de total/subtotal do relatório não é pessoa.
        if (!/^total|^subtotal/i.test(normalizarNome(rotulo))) out.naoEncontradas.push(rotulo);
        continue;
      }
      if (c.tipo === "ambiguo") {
        out.ambiguas.push(rotulo);
        continue;
      }
      id = c.solidesId;
    }
    const atual = out.casadas.get(id) ?? { solidesId: id, valores: {}, linhas: 0 };
    if (atual.linhas === 1) out.repetidas++;
    atual.linhas++;
    for (const [col, i] of idx) {
      const v = lerValor(row[i]);
      if (v !== null) atual.valores[col] = Math.round(((atual.valores[col] ?? 0) + v) * 100) / 100;
    }
    out.casadas.set(id, atual);
  }
  return out;
}

// ── conferência ────────────────────────────────────────────────────────────

export interface DpDiferenca {
  solidesId: number;
  nome: string;
  campo: DpCampoConferencia;
  folha: number;
  planilha: number;
  diferenca: number;
}

export interface DpResultadoConferencia {
  /** Pessoas presentes nos dois lados. */
  conferidas: number;
  /** Pessoas sem diferença em nenhum campo conferido. */
  semDiferenca: number;
  diferencas: DpDiferenca[];
  soNaFolha: string[];
  soNaPlanilha: string[];
  ambiguas: string[];
  repetidas: number;
  /** Total por campo dos dois lados, só de quem está nos dois. */
  totais: Array<{ campo: DpCampoConferencia; folha: number; planilha: number }>;
}

/**
 * Compara campo a campo. A contabilidade pode trazer os descontos com sinal
 * negativo; o sinal é ignorado (compara-se o valor absoluto), porque é a
 * convenção do relatório, não diferença de cálculo.
 */
export function conferir(
  folha: DpFolhaResultado[],
  casamento: DpCasamentoPlanilha,
  mapeamento: DpMapeamentoPlanilha,
  tolerancia = 0.05,
): DpResultadoConferencia {
  const campos = (Object.entries(mapeamento.campos) as Array<[DpCampoConferencia, string]>).filter(([, col]) => col);
  const porId = new Map(folha.map((r) => [r.solidesId, r]));
  const diferencas: DpDiferenca[] = [];
  const comDif = new Set<number>();
  const totais = new Map<DpCampoConferencia, { folha: number; planilha: number }>(campos.map(([k]) => [k, { folha: 0, planilha: 0 }]));
  let conferidas = 0;
  for (const [id, linha] of Array.from(casamento.casadas)) {
    const r = porId.get(id);
    if (!r) continue;
    conferidas++;
    for (const [campo, col] of campos) {
      const vp = linha.valores[col];
      if (vp === undefined) continue;
      const planilha = Math.abs(vp);
      const nosso = Math.abs(valorDaFolha(r, campo));
      const t = totais.get(campo)!;
      t.folha += nosso;
      t.planilha += planilha;
      const dif = Math.round((nosso - planilha) * 100) / 100;
      if (Math.abs(dif) > tolerancia) {
        diferencas.push({ solidesId: id, nome: r.nome, campo, folha: nosso, planilha, diferenca: dif });
        comDif.add(id);
      }
    }
  }
  diferencas.sort((a, b) => Math.abs(b.diferenca) - Math.abs(a.diferenca));
  return {
    conferidas,
    semDiferenca: conferidas - comDif.size,
    diferencas,
    soNaFolha: folha.filter((r) => !casamento.casadas.has(r.solidesId)).map((r) => r.nome),
    soNaPlanilha: casamento.naoEncontradas,
    ambiguas: casamento.ambiguas,
    repetidas: casamento.repetidas,
    totais: campos.map(([campo]) => ({
      campo,
      folha: Math.round(totais.get(campo)!.folha * 100) / 100,
      planilha: Math.round(totais.get(campo)!.planilha * 100) / 100,
    })),
  };
}

// ── valores do mês vindos de planilha ──────────────────────────────────────

export const CAMPOS_VALORES = [
  "coparticipacao",
  "outrosDescontos",
  "outrosProventos",
  "comissao",
  "diasTrabalhados",
  "diasFerias",
  "inssFerias",
  "vtDiasDesconto",
] as const satisfies ReadonlyArray<keyof DpFolhaLancamento>;
export type DpCampoValor = (typeof CAMPOS_VALORES)[number];

export const ROTULO_VALOR: Record<DpCampoValor, string> = {
  coparticipacao: "Coparticipação do plano",
  outrosDescontos: "Outros descontos",
  outrosProventos: "Outros proventos",
  comissao: "Comissão / meta",
  diasTrabalhados: "Dias trabalhados",
  diasFerias: "Dias de férias",
  inssFerias: "INSS do recibo de férias",
  vtDiasDesconto: "Dias de VT a descontar",
};

export interface DpMudancaValor {
  solidesId: number;
  antes: number | null;
  depois: number;
}

/**
 * O que lançar: SUBSTITUIR põe o valor da planilha; SOMAR acrescenta ao que já
 * está no mês (duas faturas da mesma operadora, por exemplo). Valor igual ao
 * atual não é mudança. Valores em dinheiro usam o absoluto (fatura pode vir
 * com sinal de débito); dias não.
 */
export function planejarValores(
  casamento: DpCasamentoPlanilha,
  coluna: string,
  campo: DpCampoValor,
  modo: "substituir" | "somar",
  atuais: Map<number, DpFolhaLancamento>,
): DpMudancaValor[] {
  const dinheiro = campo !== "diasTrabalhados" && campo !== "diasFerias" && campo !== "vtDiasDesconto";
  const out: DpMudancaValor[] = [];
  for (const [id, l] of Array.from(casamento.casadas)) {
    const v = l.valores[coluna];
    if (v === undefined) continue;
    const valor = dinheiro ? Math.abs(v) : v;
    const antes = (atuais.get(id)?.[campo] as number | null | undefined) ?? null;
    const depois = Math.round((modo === "somar" ? (antes ?? 0) + valor : valor) * 100) / 100;
    if (antes !== null && Math.abs(antes - depois) < 0.005) continue;
    out.push({ solidesId: id, antes, depois });
  }
  return out;
}
