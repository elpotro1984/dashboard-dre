// Valor fixo: do realizado do ano-base por fornecedor ao valor atual do contrato.

import test from "node:test";
import assert from "node:assert/strict";

import {
  chaveFornecedor,
  jaContratado,
  juntarFornecedores,
  mesesDoAcumulado,
  ordenarSugeridos,
  sugerirFornecedor,
} from "./valor-fixo-fornecedores";

test("o acumulado vira o valor de cada mês", () => {
  assert.deepEqual(mesesDoAcumulado([1000, 2000, 2000, 3050]), [1000, 1000, 0, 1050]);
});

test("o valor atual é o ÚLTIMO mês pago, não a média", () => {
  // Aluguel de 1.000 reajustado para 1.050 em abril: a média (1.016,67) ficaria
  // abaixo do que se paga hoje.
  const s = sugerirFornecedor({
    fornecedor: "Imobiliária X",
    total: 4100,
    acumulado: [1000, 2000, 3000, 4050],
  });
  assert.equal(s.valorAtual, 1050);
  assert.equal(s.ultimoMes, 4);
  assert.equal(s.mesesPagos, 4);
  assert.equal(s.recorrente, true);
});

test("mês sem pagamento no fim não apaga o último valor", () => {
  const s = sugerirFornecedor({ fornecedor: "A", total: 600, acumulado: [300, 600, 600] });
  assert.equal(s.ultimoMes, 2);
  assert.equal(s.valorAtual, 300);
});

test("pagamento único não é recorrente", () => {
  const s = sugerirFornecedor({ fornecedor: "B", total: 900, acumulado: [0, 900, 900] });
  assert.equal(s.mesesPagos, 1);
  assert.equal(s.recorrente, false);
  assert.equal(s.valorAtual, 900);
});

test("só pagou no mês em curso: o valor é o desse mês, sem mês fechado", () => {
  const s = sugerirFornecedor({ fornecedor: "C", total: 450, acumulado: [0, 0, 0] });
  assert.equal(s.ultimoMes, null);
  assert.equal(s.valorAtual, 450);
  assert.equal(s.mesesPagos, 0);
});

test("fração de centavo não conta como mês pago", () => {
  const s = sugerirFornecedor({ fornecedor: "D", total: 100.004, acumulado: [100, 100.004] });
  assert.equal(s.mesesPagos, 1);
  assert.equal(s.ultimoMes, 1);
});

test("o mesmo fornecedor em duas gêmeas soma mês a mês", () => {
  const [f] = juntarFornecedores([
    [{ fornecedor: "Limpa Tudo LTDA", total: 300, acumulado: [100, 200] }],
    [{ fornecedor: "LIMPA  TUDO ltda", total: 50, acumulado: [0, 50] }],
  ]);
  assert.equal(f.total, 350);
  assert.deepEqual(f.acumulado, [100, 250]);
});

test("o fornecedor já contratado casa pelo nome, ignorando acento e caixa", () => {
  assert.equal(chaveFornecedor("  Energisa  Mato   Grosso "), "energisa mato grosso");
  assert.equal(jaContratado("Águas de Cuiabá", ["AGUAS DE CUIABA", null]), true);
  assert.equal(jaContratado("Águas de Cuiabá", ["Energisa"]), false);
});

test("recorrentes vêm primeiro, depois o maior valor", () => {
  const base = { totalAno: 0, mesesPagos: 0, ultimoMes: 1 };
  const ordem = ordenarSugeridos([
    { ...base, fornecedor: "Avulso grande", valorAtual: 9000, recorrente: false },
    { ...base, fornecedor: "Fixo pequeno", valorAtual: 100, recorrente: true },
    { ...base, fornecedor: "Fixo grande", valorAtual: 5000, recorrente: true },
  ]).map((f) => f.fornecedor);
  assert.deepEqual(ordem, ["Fixo grande", "Fixo pequeno", "Avulso grande"]);
});
