import { dayKeyBR } from "@/lib/ctrl/datetime";

// ============================================================================
// Caixinhas da Puxada (Vendas e Pós-Vendas) — saldo INFORMATIVO ao lado da
// Verificação Orçamentária da nova requisição (28/10/2026). Puro e testado; a
// leitura da planilha e do banco está em caixinha-saldo.ts.
//
// O saldo de cada caixinha vive numa planilha que é fechada uma vez por mês, e
// o que sai pelo Control Hub durante o mês só entra nela no fechamento. Então:
//
//   saldo = valor da planilha − requisições que ainda não estão nela
//
// O fechamento é CRAVADO NO DIA 10 (decisão do dono do projeto): a planilha
// atualizada no dia 10 traz tudo que venceu até o dia 9, e o Control Hub
// desconta o que vence do dia 10 em diante. O corte NÃO é o dia em que o
// sistema percebeu a mudança — se ninguém abrir uma requisição Puxada até o
// dia 15, as de 10 a 14 ainda não estão na planilha e continuam descontando.
//
// Como saber se a planilha já foi fechada: cada valor DIFERENTE lido é gravado
// (ctrl_caixinha_leituras). Mudou num ciclo novo → é o fechamento, o corte vai
// para o dia 10 desse ciclo. Mudou no mesmo ciclo → é correção, o corte fica.
// Não mudou ainda no ciclo novo → a planilha está atrasada, e o corte continua
// no ciclo anterior: o saldo segue certo, só com um aviso. Isso é o que impede
// o erro mais perigoso (planilha atrasada fazendo o saldo parecer MAIOR).
//
// Só desconta requisição dos setores CSC Pós-Vendas e CSC Consultoria
// (SETORES_DA_CAIXINHA); no rateio, só a parcela desses setores.
//
// É informativo: não bloqueia o envio nem muda alçada. A verificação de
// orçamento do setor continua igual.
// ============================================================================

export type CaixinhaChave = "puxada_vendas" | "puxada_pos_vendas";

export interface CaixinhaConfig {
  chave: CaixinhaChave;
  /** Tipo de despesa do Compras (ctrl_expense_types.id) — por ID, nunca por nome. */
  expenseTypeId: string;
  rotulo: string;
  /** Célula do saldo na aba da planilha. */
  celula: string;
}

export const CAIXINHAS: readonly CaixinhaConfig[] = [
  {
    chave: "puxada_vendas",
    expenseTypeId: "1a6f8b09-e45c-481d-b9da-7de219524acd", // "Puxada de Vendas" (Viva Company)
    rotulo: "Caixinha da Puxada de Vendas",
    celula: "B2",
  },
  {
    chave: "puxada_pos_vendas",
    expenseTypeId: "9929b231-19e6-47e3-8be5-9a689d3e3b87", // "Puxada Pós-Vendas" (Viva Company)
    rotulo: "Caixinha da Puxada Pós-Vendas",
    celula: "B3",
  },
];

export function caixinhaDoTipo(expenseTypeId: string | null | undefined): CaixinhaConfig | null {
  if (!expenseTypeId) return null;
  return CAIXINHAS.find((c) => c.expenseTypeId === expenseTypeId) ?? null;
}

/**
 * Só estes setores consomem a caixinha (decisão do dono do projeto, 28/10/2026):
 * requisição Puxada de outro setor aparece no cartão, mas não desconta. Vale
 * para as duas caixinhas — qual delas é decidido pelo TIPO. Por ID, como as
 * regras por setor de routing.ts: o nome se renomeia.
 */
export const SETORES_DA_CAIXINHA: readonly { id: string; nome: string }[] = [
  { id: "5769358c-b068-4bb4-8a7b-0e749ed13ec1", nome: "CSC Pós-Vendas" },
  { id: "eb14752a-f384-4978-ac0c-d6c3c6fb430b", nome: "CSC Consultoria" },
];

export const SETORES_DA_CAIXINHA_TEXTO = SETORES_DA_CAIXINHA.map((s) => s.nome).join(" e ");

export function setorConsomeCaixinha(sectorId: string | null | undefined): boolean {
  return !!sectorId && SETORES_DA_CAIXINHA.some((s) => s.id === sectorId);
}

/**
 * Quanto ESTA requisição (ainda no formulário) tira da caixinha. No rateio, só
 * as parcelas dos setores da caixinha; recorrência cria uma requisição por mês,
 * todas com o valor cheio, então multiplica.
 */
export function valorQueConsome(input: {
  sectorId: string | null;
  valor: number;
  ocorrencias: number;
  rateio: { sectorId: string; amount: number }[] | null;
}): number {
  const base = input.rateio
    ? input.rateio.filter((p) => setorConsomeCaixinha(p.sectorId)).reduce((s, p) => s + p.amount, 0)
    : setorConsomeCaixinha(input.sectorId)
      ? input.valor
      : 0;
  return centavos(base * Math.max(1, input.ocorrencias));
}

export const DIA_DO_FECHAMENTO = 10;

const pad = (n: number) => String(n).padStart(2, "0");
const centavos = (n: number) => Math.round(n * 100) / 100;

/**
 * Dia em que começou o ciclo vigente no dia informado ('YYYY-MM-DD', já em
 * Brasília): o dia 10 mais recente que não passa dele.
 */
export function inicioDoCiclo(dia: string): string {
  const [ano, mes, d] = dia.slice(0, 10).split("-").map(Number);
  if (d >= DIA_DO_FECHAMENTO) return `${ano}-${pad(mes)}-${pad(DIA_DO_FECHAMENTO)}`;
  const mesAnterior = mes === 1 ? 12 : mes - 1;
  const anoAnterior = mes === 1 ? ano - 1 : ano;
  return `${anoAnterior}-${pad(mesAnterior)}-${pad(DIA_DO_FECHAMENTO)}`;
}

export interface LeituraGravada {
  valor: number;
  /** A partir deste dia (inclusive) o Control Hub desconta. */
  corte: string;
  /** Dia (Brasília) em que este valor foi lido pela primeira vez. */
  lidoEm: string;
}

/**
 * O que gravar ao ler `valor` hoje. `null` = igual à última leitura, nada a
 * gravar. Mudou no mesmo ciclo da última leitura → correção (mantém o corte,
 * inclusive um corte ajustado à mão). Mudou num ciclo posterior → fechamento,
 * corte no dia 10 do ciclo de hoje.
 */
export function novaLeitura(
  ultima: LeituraGravada | null,
  valor: number,
  hoje: string,
): { valor: number; corte: string } | null {
  if (ultima && Math.abs(ultima.valor - valor) < 0.005) return null;
  const ciclo = inicioDoCiclo(hoje);
  if (ultima && inicioDoCiclo(ultima.lidoEm) === ciclo) {
    return { valor, corte: ultima.corte };
  }
  return { valor, corte: ciclo };
}

/**
 * A planilha ainda não mudou desde que o ciclo virou: o fechamento do dia 10
 * não foi lançado (ou o saldo coincidiu). O corte segue no ciclo anterior, e o
 * número continua certo — o aviso é para quem atualiza a planilha.
 */
export function planilhaAtrasada(ultima: LeituraGravada, hoje: string): boolean {
  return inicioDoCiclo(ultima.lidoEm) < inicioDoCiclo(hoje);
}

// ─── Consumo ────────────────────────────────────────────────────────────────

/** Aprovada (antes ou depois do envio à Omie): já saiu da caixinha. */
export const STATUS_CONSUMIDO = ["aprovado", "agendado", "info_pagamento_pendente"] as const;
/** Ainda em aprovação: vai sair se for aprovada. */
export const STATUS_PENDENTE = [
  "pendente",
  "pendente_diretor",
  "aguardando_complementacao",
  "aguardando_aprovacao_fornecedor",
] as const;
// Rejeitada, estornada, inativada e excluída não contam.

/**
 * Uma requisição — ou, no rateio, UMA PARCELA dela (o setor e o valor da
 * parcela, com a data e o status da requisição-mãe).
 */
export interface RequisicaoDaCaixinha {
  amount: number | string;
  status: string;
  due_date: string | null;
  created_at: string;
  sector_id: string | null;
}

/**
 * Data que decide se a requisição já está na planilha: o VENCIMENTO (é quando
 * o dinheiro sai), com a criação em Brasília como reserva — mesmo critério do
 * orçamento do Compras (budget-cutoff.ts). Parcela com vencimento futuro conta
 * desde já e só entra na planilha no fechamento do mês em que vencer.
 */
export function dataQueConta(r: Pick<RequisicaoDaCaixinha, "due_date" | "created_at">): string {
  return r.due_date ?? dayKeyBR(r.created_at);
}

export interface Consumo {
  consumido: number;
  qtdConsumido: number;
  pendente: number;
  qtdPendente: number;
}

export function somarConsumo(requisicoes: RequisicaoDaCaixinha[], corte: string): Consumo {
  const consumidos = new Set<string>(STATUS_CONSUMIDO);
  const pendentes = new Set<string>(STATUS_PENDENTE);
  let consumido = 0;
  let qtdConsumido = 0;
  let pendente = 0;
  let qtdPendente = 0;
  for (const r of requisicoes) {
    if (!setorConsomeCaixinha(r.sector_id)) continue;
    if (dataQueConta(r) < corte) continue;
    const valor = Number(r.amount) || 0;
    if (consumidos.has(r.status)) {
      consumido += valor;
      qtdConsumido++;
    } else if (pendentes.has(r.status)) {
      pendente += valor;
      qtdPendente++;
    }
  }
  return { consumido: centavos(consumido), qtdConsumido, pendente: centavos(pendente), qtdPendente };
}

// ─── Saldo ──────────────────────────────────────────────────────────────────

export interface SaldoCaixinha extends Consumo {
  chave: CaixinhaChave;
  rotulo: string;
  /** Valor da planilha considerado. `null` = nunca foi possível ler. */
  saldoPlanilha: number | null;
  /** A partir deste dia o Control Hub desconta. */
  corte: string;
  /** "agora" = lido nesta consulta; "anterior" = planilha indisponível, vale a última leitura gravada. */
  origem: "agora" | "anterior" | null;
  /** Dia em que o valor considerado foi lido pela primeira vez. */
  lidoEm: string | null;
  /** Planilha sem o fechamento do ciclo atual (ver planilhaAtrasada). */
  atrasada: boolean;
  /** Falha de leitura da planilha, em português. */
  erroPlanilha: string | null;
  /** saldoPlanilha − consumido. */
  disponivel: number | null;
  /** disponivel − pendente: o que sobra se tudo que está em aprovação passar. */
  projetado: number | null;
}

export function montarSaldo(input: {
  caixinha: CaixinhaConfig;
  saldoPlanilha: number | null;
  corte: string;
  origem: SaldoCaixinha["origem"];
  lidoEm: string | null;
  atrasada: boolean;
  erroPlanilha: string | null;
  consumo: Consumo;
}): SaldoCaixinha {
  const { caixinha, saldoPlanilha, consumo } = input;
  const disponivel = saldoPlanilha === null ? null : centavos(saldoPlanilha - consumo.consumido);
  return {
    chave: caixinha.chave,
    rotulo: caixinha.rotulo,
    saldoPlanilha,
    corte: input.corte,
    origem: input.origem,
    lidoEm: input.lidoEm,
    atrasada: input.atrasada,
    erroPlanilha: input.erroPlanilha,
    ...consumo,
    disponivel,
    projetado: disponivel === null ? null : centavos(disponivel - consumo.pendente),
  };
}

// ─── Planilha ───────────────────────────────────────────────────────────────

/** "B3" → { linha: 2, coluna: 1 } (0-based, a partir de A1). */
export function posicaoDaCelula(celula: string): { linha: number; coluna: number } {
  const m = /^([A-Z]+)(\d+)$/.exec(celula.trim().toUpperCase());
  if (!m) throw new Error(`Célula inválida: ${celula}`);
  let coluna = 0;
  for (const ch of m[1]) coluna = coluna * 26 + (ch.charCodeAt(0) - 64);
  return { linha: Number(m[2]) - 1, coluna: coluna - 1 };
}

/** Range A1 que cobre todas as células ("A1:B3" para B2 e B3). */
export function rangeQueCobre(celulas: string[]): string {
  let ultimaLinha = 0;
  let ultimaColuna = 0;
  for (const c of celulas) {
    const p = posicaoDaCelula(c);
    ultimaLinha = Math.max(ultimaLinha, p.linha);
    ultimaColuna = Math.max(ultimaColuna, p.coluna);
  }
  let letras = "";
  for (let n = ultimaColuna + 1; n > 0; n = Math.floor((n - 1) / 26)) {
    letras = String.fromCharCode(65 + ((n - 1) % 26)) + letras;
  }
  return `A1:${letras}${ultimaLinha + 1}`;
}

/**
 * Valor numérico de uma célula: number cru, ou texto no formato brasileiro
 * ("R$ 1.234,56", "-1.234,56"). Vazio ou ilegível → null (nunca zero: zero
 * na caixinha é um saldo, "não consegui ler" é outra coisa). Arredonda ao
 * centavo: a soma da planilha chega com resíduo de ponto flutuante
 * (20651.940000000002 na primeira leitura real), e o banco guarda 2 casas.
 */
export function valorDaCelula(rows: unknown[][], celula: string): number | null {
  const { linha, coluna } = posicaoDaCelula(celula);
  const cell = rows[linha]?.[coluna];
  if (typeof cell === "number") return Number.isFinite(cell) ? centavos(cell) : null;
  if (typeof cell !== "string") return null;
  const limpo = cell.replace(/R\$/i, "").replace(/\s/g, "");
  if (!/\d/.test(limpo)) return null;
  const n = Number(limpo.replace(/\./g, "").replace(",", "."));
  return Number.isFinite(n) ? centavos(n) : null;
}
