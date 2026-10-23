// "Clonar requisição" (tela Requisições → Nova Requisição pré-preenchida).
//
// Módulo PURO: decide o que a requisição nova HERDA da original e o que fica em
// branco. É só um atalho de preenchimento — nada é gravado aqui; a nova segue
// o fluxo normal (verificação de orçamento, aprovação, Contas a Pagar).
//
// Herdado: fornecedor, setor (ou o rateio), tipo de despesa, descrição,
// projeto, evento, valor, método de pagamento + dados bancários/PIX da própria
// requisição, NF (sim/não), justificativa e observações.
//
// NUNCA herdado — é de cada pagamento: vencimento e competência (obrigatórios,
// escolhidos de novo), anexos (boleto, nota, diversos), código de barras, número
// da nota e o código PIX copia e cola. Copiar qualquer um deles faria a
// requisição nova pagar o documento da antiga.
//
// Cadastro que deixou de estar disponível (fornecedor rejeitado, setor fora do
// alcance de quem clona, tipo/evento inativo) fica em branco COM aviso — nunca
// some calado, nem impede o resto do clone.

export interface CloneSourceRow {
  id: string;
  request_number: number;
  title: string;
  description: string | null;
  sector_id: string | null;
  expense_type_id: string | null;
  supplier_id: string | null;
  event_id: string | null;
  projeto_nome: string | null;
  amount: number;
  usd_amount: number | null;
  payment_method: string | null;
  installment_total: number | null;
  needs_credit_card: boolean | null;
  supplier_issues_invoice: string | null;
  favorecido: string | null;
  bank_cpf_cnpj: string | null;
  bank_name: string | null;
  bank_agency: string | null;
  bank_account: string | null;
  bank_account_digit: string | null;
  pix_key: string | null;
  pix_key_type: string | null;
  justification: string | null;
  observations: string | null;
  is_rateio: boolean | null;
  /** Parcelas do rateio (ctrl_request_sectors). */
  rateio: { sector_id: string; amount: number }[] | null;
}

export interface CloneAvailability {
  supplierIds: ReadonlySet<string>;
  sectorIds: ReadonlySet<string>;
  expenseTypeIds: ReadonlySet<string>;
  eventIds: ReadonlySet<string>;
  /** Há eventos ativos cadastrados (sem eles o campo nem aparece no formulário). */
  hasEvents: boolean;
}

export interface ClonePrefill {
  sourceId: string;
  sourceNumber: number;
  description: string;
  sectorId: string;
  isRateio: boolean;
  rateioRows: { sectorId: string; valueStr: string }[];
  expenseTypeId: string;
  amountStr: string;
  isUsd: boolean;
  usdAmountStr: string;
  supplierId: string;
  /** "" = escolher; "none" = "Nenhum evento"; senão o id. */
  eventId: string;
  projetoNome: string;
  paymentMethod: string;
  installments: number;
  needsCreditCard: "" | "sim" | "nao";
  supplierIssuesInvoice: string;
  favorecido: string;
  bankCpfCnpj: string;
  bankName: string;
  bankAgency: string;
  bankAccount: string;
  bankAccountDigit: string;
  pixKey: string;
  pixKeyType: string;
  justification: string;
  observations: string;
  /** O que não pôde ser herdado e precisa de atenção. */
  avisos: string[];
}

const PARCELA_SUFFIX = /\s+—\s+Parcela\s+\d+\/\d+\s*$/;

/** Valor no formato do campo do formulário: 1234.5 → "1.234,50". */
export function valorParaCampo(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n) || n <= 0) return "";
  const [int, dec] = (Math.round(n * 100) / 100).toFixed(2).split(".");
  return `${int.replace(/\B(?=(\d{3})+(?!\d))/g, ".")},${dec}`;
}

export function buildClonePrefill(
  row: CloneSourceRow,
  avail: CloneAvailability,
  /** Cartão parcelado: soma das parcelas do grupo (o `amount` da linha é UMA parcela). */
  installmentGroupTotal?: number | null,
): ClonePrefill {
  const avisos: string[] = [];

  // Descrição: a parcela leva "— Parcela k/N" no título; a compra clonada é a
  // inteira, e o servidor recoloca o sufixo ao criar as parcelas de novo.
  const description = (row.description ?? row.title ?? "").replace(PARCELA_SUFFIX, "").trim();

  // Fornecedor
  let supplierId = row.supplier_id ?? "";
  if (supplierId && !avail.supplierIds.has(supplierId)) {
    supplierId = "";
    avisos.push("O fornecedor da requisição original não está mais disponível (rejeitado ou inativo) — escolha o fornecedor.");
  }

  // Setor / rateio
  const isRateio = Boolean(row.is_rateio) && (row.rateio?.length ?? 0) >= 2;
  let sectorId = isRateio ? "" : row.sector_id ?? "";
  if (!isRateio && sectorId && !avail.sectorIds.has(sectorId)) {
    sectorId = "";
    avisos.push("O setor da requisição original não está disponível para você — escolha o setor.");
  }
  let rateioRows: { sectorId: string; valueStr: string }[] = [
    { sectorId: "", valueStr: "" },
    { sectorId: "", valueStr: "" },
  ];
  if (isRateio) {
    let semSetor = false;
    rateioRows = (row.rateio ?? []).map((p) => {
      const ok = avail.sectorIds.has(p.sector_id);
      if (!ok) semSetor = true;
      return { sectorId: ok ? p.sector_id : "", valueStr: valorParaCampo(p.amount) };
    });
    if (semSetor) {
      avisos.push("Um ou mais setores do rateio não estão disponíveis para você — escolha o setor dessas parcelas.");
    }
  }

  // Tipo de despesa
  let expenseTypeId = row.expense_type_id ?? "";
  if (expenseTypeId && !avail.expenseTypeIds.has(expenseTypeId)) {
    expenseTypeId = "";
    avisos.push("O tipo de despesa da requisição original não está mais ativo — escolha o tipo.");
  }

  // Evento: sem evento na original = escolha explícita "Nenhum evento".
  let eventId = "";
  if (avail.hasEvents) {
    if (!row.event_id) eventId = "none";
    else if (avail.eventIds.has(row.event_id)) eventId = row.event_id;
    else avisos.push("O evento da requisição original não está mais ativo — escolha o evento.");
  }

  // Método e valor
  const paymentMethod = row.payment_method || "boleto";
  const installments =
    paymentMethod === "cartao_credito" && (row.installment_total ?? 0) > 1 ? row.installment_total! : 1;
  const amountTotal =
    installments > 1 && installmentGroupTotal && installmentGroupTotal > 0
      ? installmentGroupTotal
      : row.amount;
  const isUsd = (row.usd_amount ?? 0) > 0 && paymentMethod !== "pix" && paymentMethod !== "pix_copia_cola";

  // PIX copia e cola: o código é do PAGAMENTO, não do fornecedor.
  let pixKey = row.pix_key ?? "";
  if (paymentMethod === "pix_copia_cola") {
    pixKey = "";
    avisos.push("Cole o código PIX copia e cola do novo pagamento.");
  }
  if (paymentMethod === "boleto") {
    avisos.push("Anexe o boleto do novo pagamento — o código de barras é lido dele.");
  }

  return {
    sourceId: row.id,
    sourceNumber: row.request_number,
    description,
    sectorId,
    isRateio,
    rateioRows,
    expenseTypeId,
    amountStr: isUsd || isRateio ? "" : valorParaCampo(amountTotal),
    isUsd,
    usdAmountStr: isUsd ? valorParaCampo(row.usd_amount) : "",
    supplierId,
    eventId,
    projetoNome: row.projeto_nome ?? "",
    paymentMethod,
    installments,
    needsCreditCard:
      row.needs_credit_card === true ? "sim" : row.needs_credit_card === false ? "nao" : "",
    supplierIssuesInvoice: row.supplier_issues_invoice ?? "",
    favorecido: row.favorecido ?? "",
    bankCpfCnpj: row.bank_cpf_cnpj ?? "",
    bankName: row.bank_name ?? "",
    bankAgency: row.bank_agency ?? "",
    bankAccount: row.bank_account ?? "",
    bankAccountDigit: row.bank_account_digit ?? "",
    pixKey,
    pixKeyType: row.pix_key_type ?? "",
    justification: row.justification ?? "",
    observations: row.observations ?? "",
    avisos,
  };
}
