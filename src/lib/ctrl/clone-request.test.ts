import assert from "node:assert/strict";
import { test } from "node:test";

import { buildClonePrefill, valorParaCampo, type CloneAvailability, type CloneSourceRow } from "./clone-request";

function row(over: Partial<CloneSourceRow> = {}): CloneSourceRow {
  return {
    id: "req-1",
    request_number: 120,
    title: "Licença do software",
    description: "Licença do software",
    sector_id: "sec-ti",
    expense_type_id: "tipo-sw",
    supplier_id: "sup-1",
    event_id: null,
    projeto_nome: "PROJETO X",
    amount: 1234.5,
    usd_amount: null,
    payment_method: "boleto",
    installment_total: null,
    needs_credit_card: null,
    supplier_issues_invoice: "sim",
    favorecido: "FORNECEDOR LTDA",
    bank_cpf_cnpj: "12.345.678/0001-90",
    bank_name: null,
    bank_agency: null,
    bank_account: null,
    bank_account_digit: null,
    pix_key: null,
    pix_key_type: null,
    justification: null,
    observations: "Renovação anual",
    is_rateio: false,
    rateio: null,
    ...over,
  };
}

const avail: CloneAvailability = {
  supplierIds: new Set(["sup-1"]),
  sectorIds: new Set(["sec-ti", "sec-mkt"]),
  expenseTypeIds: new Set(["tipo-sw"]),
  eventIds: new Set(["ev-1"]),
  hasEvents: true,
};

test("valorParaCampo: formato do campo de valor", () => {
  assert.equal(valorParaCampo(1234.5), "1.234,50");
  assert.equal(valorParaCampo(0.07), "0,07");
  assert.equal(valorParaCampo(1000000), "1.000.000,00");
  assert.equal(valorParaCampo(null), "");
  assert.equal(valorParaCampo(0), "");
});

test("herda fornecedor, setor, tipo, descrição, projeto, valor e método", () => {
  const p = buildClonePrefill(row(), avail);
  assert.equal(p.supplierId, "sup-1");
  assert.equal(p.sectorId, "sec-ti");
  assert.equal(p.expenseTypeId, "tipo-sw");
  assert.equal(p.description, "Licença do software");
  assert.equal(p.projetoNome, "PROJETO X");
  assert.equal(p.amountStr, "1.234,50");
  assert.equal(p.paymentMethod, "boleto");
  assert.equal(p.observations, "Renovação anual");
  assert.equal(p.sourceNumber, 120);
});

test("o que é do pagamento NÃO vem: o tipo nem tem campo de vencimento, competência, anexo ou código de barras", () => {
  const p = buildClonePrefill(row(), avail) as unknown as Record<string, unknown>;
  for (const campo of ["dueDate", "due_date", "refMonth", "refYear", "barcode", "invoiceNumber", "attachmentPath"]) {
    assert.equal(campo in p, false, campo);
  }
});

test("boleto avisa para anexar o boleto novo", () => {
  const p = buildClonePrefill(row(), avail);
  assert.ok(p.avisos.some((a) => a.includes("boleto")));
});

test("PIX copia e cola: o código do pagamento antigo não é copiado", () => {
  const p = buildClonePrefill(row({ payment_method: "pix_copia_cola", pix_key: "000201...antigo" }), avail);
  assert.equal(p.pixKey, "");
  assert.ok(p.avisos.some((a) => a.includes("copia e cola")));
});

test("PIX comum mantém a chave (é do fornecedor)", () => {
  const p = buildClonePrefill(row({ payment_method: "pix", pix_key: "chave@x.com", pix_key_type: "email" }), avail);
  assert.equal(p.pixKey, "chave@x.com");
  assert.equal(p.pixKeyType, "email");
});

test("evento: sem evento na original vira 'Nenhum evento'; evento inativo fica para escolher, com aviso", () => {
  assert.equal(buildClonePrefill(row({ event_id: null }), avail).eventId, "none");
  assert.equal(buildClonePrefill(row({ event_id: "ev-1" }), avail).eventId, "ev-1");
  const inativo = buildClonePrefill(row({ event_id: "ev-velho" }), avail);
  assert.equal(inativo.eventId, "");
  assert.ok(inativo.avisos.some((a) => a.includes("evento")));
  // Sem eventos cadastrados o campo nem aparece: nada a escolher.
  assert.equal(buildClonePrefill(row(), { ...avail, hasEvents: false }).eventId, "");
});

test("cadastro indisponível fica em branco com aviso, sem derrubar o resto", () => {
  const p = buildClonePrefill(row({ supplier_id: "sup-rejeitado", sector_id: "sec-outro", expense_type_id: "tipo-inativo" }), avail);
  assert.equal(p.supplierId, "");
  assert.equal(p.sectorId, "");
  assert.equal(p.expenseTypeId, "");
  assert.equal(p.amountStr, "1.234,50");
  assert.equal(p.avisos.filter((a) => !a.includes("boleto")).length, 3);
});

test("cartão parcelado: refaz a compra inteira (total do grupo, mesmas parcelas, sem o sufixo)", () => {
  const p = buildClonePrefill(
    row({
      payment_method: "cartao_credito",
      title: "Notebook — Parcela 2/6",
      description: "Notebook — Parcela 2/6",
      amount: 500,
      installment_total: 6,
      needs_credit_card: true,
    }),
    avail,
    3000,
  );
  assert.equal(p.installments, 6);
  assert.equal(p.amountStr, "3.000,00");
  assert.equal(p.description, "Notebook");
  assert.equal(p.needsCreditCard, "sim");
});

test("rateio: copia as parcelas; setor fora do alcance vira linha a escolher", () => {
  const p = buildClonePrefill(
    row({
      is_rateio: true,
      rateio: [
        { sector_id: "sec-ti", amount: 700 },
        { sector_id: "sec-fora", amount: 534.5 },
      ],
    }),
    avail,
  );
  assert.equal(p.isRateio, true);
  assert.deepEqual(p.rateioRows, [
    { sectorId: "sec-ti", valueStr: "700,00" },
    { sectorId: "", valueStr: "534,50" },
  ]);
  assert.equal(p.sectorId, "");
  assert.ok(p.avisos.some((a) => a.includes("rateio")));
});

test("compra em dólar: herda o valor em US$ (o real é recalculado com o câmbio de hoje)", () => {
  const p = buildClonePrefill(row({ payment_method: "cartao_credito", usd_amount: 99.9, amount: 560 }), avail);
  assert.equal(p.isUsd, true);
  assert.equal(p.usdAmountStr, "99,90");
  assert.equal(p.amountStr, "");
});
