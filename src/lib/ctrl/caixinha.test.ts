import assert from "node:assert/strict";
import { test } from "node:test";

import {
  CAIXINHAS,
  SETORES_DA_CAIXINHA_TEXTO,
  caixinhaDoTipo,
  dataQueConta,
  inicioDoCiclo,
  montarSaldo,
  novaLeitura,
  planilhaAtrasada,
  posicaoDaCelula,
  rangeQueCobre,
  setorConsomeCaixinha,
  somarConsumo,
  valorDaCelula,
  valorQueConsome,
  type LeituraGravada,
  type RequisicaoDaCaixinha,
} from "./caixinha";

const vendas = CAIXINHAS[0];
const CSC_POS = "5769358c-b068-4bb4-8a7b-0e749ed13ec1";
const CSC_CONSULTORIA = "eb14752a-f384-4978-ac0c-d6c3c6fb430b";
const CSC = "521074f1-cb92-4ef9-a40a-a0e45c1711c6"; // setor "CSC": não consome

function req(
  amount: number,
  status: string,
  due_date: string | null,
  created_at = "2026-10-01T15:00:00Z",
  sector_id: string | null = CSC_POS,
): RequisicaoDaCaixinha {
  return { amount, status, due_date, created_at, sector_id };
}

test("setorConsomeCaixinha: só CSC Pós-Vendas e CSC Consultoria, por id", () => {
  assert.equal(setorConsomeCaixinha(CSC_POS), true);
  assert.equal(setorConsomeCaixinha(CSC_CONSULTORIA), true);
  assert.equal(setorConsomeCaixinha(CSC), false);
  assert.equal(setorConsomeCaixinha(""), false);
  assert.equal(setorConsomeCaixinha(null), false);
  assert.equal(SETORES_DA_CAIXINHA_TEXTO, "CSC Pós-Vendas e CSC Consultoria");
});

test("somarConsumo: setor fora da lista não desconta", () => {
  const c = somarConsumo(
    [
      req(100, "aprovado", "2026-10-20", undefined, CSC_POS),
      req(200, "aprovado", "2026-10-20", undefined, CSC_CONSULTORIA),
      req(999, "aprovado", "2026-10-20", undefined, CSC),
      req(999, "pendente", "2026-10-20", undefined, CSC),
      req(999, "aprovado", "2026-10-20", undefined, null),
    ],
    "2026-10-10",
  );
  assert.deepEqual(c, { consumido: 300, qtdConsumido: 2, pendente: 0, qtdPendente: 0 });
});

test("valorQueConsome: o que esta requisição tira da caixinha", () => {
  const base = { valor: 1000, ocorrencias: 1, rateio: null };
  assert.equal(valorQueConsome({ ...base, sectorId: CSC_POS }), 1000);
  assert.equal(valorQueConsome({ ...base, sectorId: CSC }), 0);
  assert.equal(valorQueConsome({ ...base, sectorId: null }), 0);
  // Recorrência: uma requisição por mês, todas com o valor cheio.
  assert.equal(valorQueConsome({ ...base, sectorId: CSC_CONSULTORIA, ocorrencias: 3 }), 3000);
  // Rateio: só as parcelas dos setores da caixinha.
  assert.equal(
    valorQueConsome({
      ...base,
      sectorId: CSC,
      rateio: [
        { sectorId: CSC, amount: 600 },
        { sectorId: CSC_CONSULTORIA, amount: 250.5 },
        { sectorId: CSC_POS, amount: 149.5 },
      ],
    }),
    400,
  );
  assert.equal(valorQueConsome({ ...base, sectorId: CSC_POS, rateio: [{ sectorId: CSC, amount: 1000 }] }), 0);
});

test("caixinhaDoTipo: só os dois tipos Puxada, por id", () => {
  assert.equal(caixinhaDoTipo("1a6f8b09-e45c-481d-b9da-7de219524acd")?.chave, "puxada_vendas");
  assert.equal(caixinhaDoTipo("9929b231-19e6-47e3-8be5-9a689d3e3b87")?.chave, "puxada_pos_vendas");
  assert.equal(caixinhaDoTipo("outro"), null);
  assert.equal(caixinhaDoTipo(""), null);
  assert.equal(caixinhaDoTipo(null), null);
});

test("inicioDoCiclo: o dia 10 mais recente", () => {
  assert.equal(inicioDoCiclo("2026-10-28"), "2026-10-10");
  assert.equal(inicioDoCiclo("2026-10-10"), "2026-10-10");
  assert.equal(inicioDoCiclo("2026-11-09"), "2026-10-10");
  assert.equal(inicioDoCiclo("2026-11-10"), "2026-11-10");
  // Virada do ano.
  assert.equal(inicioDoCiclo("2027-01-05"), "2026-12-10");
});

test("novaLeitura: primeira leitura abre o ciclo de hoje", () => {
  assert.deepEqual(novaLeitura(null, 1000, "2026-10-28"), { valor: 1000, corte: "2026-10-10" });
});

test("novaLeitura: valor igual não grava nada", () => {
  const ultima: LeituraGravada = { valor: 1000, corte: "2026-10-10", lidoEm: "2026-10-12" };
  assert.equal(novaLeitura(ultima, 1000, "2026-11-20"), null);
  assert.equal(novaLeitura(ultima, 1000.004, "2026-10-20"), null);
});

test("novaLeitura: mudou no MESMO ciclo é correção e preserva o corte (até o ajustado à mão)", () => {
  const ultima: LeituraGravada = { valor: 1000, corte: "2026-10-01", lidoEm: "2026-10-28" };
  assert.deepEqual(novaLeitura(ultima, 1200, "2026-11-05"), { valor: 1200, corte: "2026-10-01" });
});

test("novaLeitura: mudou num ciclo novo é o fechamento — corte no dia 10, não no dia da leitura", () => {
  const ultima: LeituraGravada = { valor: 1000, corte: "2026-10-10", lidoEm: "2026-10-12" };
  // Ninguém abriu requisição Puxada até o dia 25: o corte continua sendo o dia 10.
  assert.deepEqual(novaLeitura(ultima, 500, "2026-11-25"), { valor: 500, corte: "2026-11-10" });
});

test("planilhaAtrasada: ciclo virou e a planilha não mudou", () => {
  const ultima: LeituraGravada = { valor: 1000, corte: "2026-10-10", lidoEm: "2026-10-12" };
  assert.equal(planilhaAtrasada(ultima, "2026-11-09"), false);
  assert.equal(planilhaAtrasada(ultima, "2026-11-10"), true);
  assert.equal(planilhaAtrasada({ ...ultima, lidoEm: "2026-11-10" }, "2026-11-30"), false);
});

test("dataQueConta: vencimento; sem ele, a criação no dia de Brasília", () => {
  assert.equal(dataQueConta({ due_date: "2026-11-03", created_at: "2026-10-30T12:00:00Z" }), "2026-11-03");
  // 01:30 UTC do dia 10 ainda é dia 9 em Brasília.
  assert.equal(dataQueConta({ due_date: null, created_at: "2026-11-10T01:30:00Z" }), "2026-11-09");
});

test("somarConsumo: aprovadas × em aprovação × fora; só do corte em diante", () => {
  const c = somarConsumo(
    [
      req(300, "aprovado", "2026-10-15"),
      req(200, "agendado", "2026-10-20"),
      req(50, "info_pagamento_pendente", "2026-10-21"),
      req(100, "pendente", "2026-10-22"),
      req(40, "pendente_diretor", "2026-10-23"),
      req(999, "rejeitado", "2026-10-15"),
      req(999, "estornado", "2026-10-15"),
      req(999, "inativado_csc", "2026-10-15"),
      req(999, "aprovado", "2026-10-09"), // antes do corte: já está na planilha
      req(70, "aprovado", "2027-01-05"), // parcela futura: conta desde já
    ],
    "2026-10-10",
  );
  assert.deepEqual(c, { consumido: 620, qtdConsumido: 4, pendente: 140, qtdPendente: 2 });
});

test("o exemplo do dono do projeto: R$ 1.000, gasta R$ 500 em outubro, fechamento em novembro", () => {
  const outubro = [req(500, "agendado", "2026-10-20")];

  // Outubro: planilha com 1.000, o Control Hub desconta os 500.
  const ultimaOut: LeituraGravada = { valor: 1000, corte: "2026-10-10", lidoEm: "2026-10-10" };
  const emOutubro = montarSaldo({
    caixinha: vendas,
    saldoPlanilha: 1000,
    corte: ultimaOut.corte,
    origem: "agora",
    lidoEm: ultimaOut.lidoEm,
    atrasada: false,
    erroPlanilha: null,
    consumo: somarConsumo(outubro, ultimaOut.corte),
  });
  assert.equal(emOutubro.disponivel, 500);

  // 10/11: a planilha passa a 500 (os 500 de outubro foram lançados nela).
  const nova = novaLeitura(ultimaOut, 500, "2026-11-12");
  assert.deepEqual(nova, { valor: 500, corte: "2026-11-10" });
  const emNovembro = montarSaldo({
    caixinha: vendas,
    saldoPlanilha: 500,
    corte: nova!.corte,
    origem: "agora",
    lidoEm: "2026-11-12",
    atrasada: false,
    erroPlanilha: null,
    consumo: somarConsumo(outubro, nova!.corte),
  });
  // Não zera: os 500 de outubro já estão dentro do valor novo.
  assert.equal(emNovembro.disponivel, 500);
});

test("planilha atrasada: o corte fica no ciclo anterior e o saldo não infla", () => {
  const ultima: LeituraGravada = { valor: 1000, corte: "2026-10-10", lidoEm: "2026-10-10" };
  const reqs = [req(500, "aprovado", "2026-10-20"), req(100, "aprovado", "2026-11-12")];
  // 15/11 e a planilha ainda mostra 1.000 (o fechamento não foi lançado).
  assert.equal(novaLeitura(ultima, 1000, "2026-11-15"), null);
  const s = montarSaldo({
    caixinha: vendas,
    saldoPlanilha: 1000,
    corte: ultima.corte,
    origem: "agora",
    lidoEm: ultima.lidoEm,
    atrasada: planilhaAtrasada(ultima, "2026-11-15"),
    erroPlanilha: null,
    consumo: somarConsumo(reqs, ultima.corte),
  });
  assert.equal(s.disponivel, 400);
  assert.equal(s.atrasada, true);
});

test("montarSaldo: projetado desconta as em aprovação; sem planilha, sem saldo", () => {
  const consumo = { consumido: 300, qtdConsumido: 1, pendente: 120.5, qtdPendente: 1 };
  const s = montarSaldo({
    caixinha: vendas,
    saldoPlanilha: 1000,
    corte: "2026-10-10",
    origem: "agora",
    lidoEm: "2026-10-28",
    atrasada: false,
    erroPlanilha: null,
    consumo,
  });
  assert.equal(s.disponivel, 700);
  assert.equal(s.projetado, 579.5);

  const semPlanilha = montarSaldo({
    caixinha: vendas,
    saldoPlanilha: null,
    corte: "2026-10-10",
    origem: null,
    lidoEm: null,
    atrasada: false,
    erroPlanilha: "o Google não respondeu",
    consumo,
  });
  assert.equal(semPlanilha.disponivel, null);
  assert.equal(semPlanilha.projetado, null);
  assert.equal(semPlanilha.consumido, 300);
});

test("células: posição, range e leitura do valor", () => {
  assert.deepEqual(posicaoDaCelula("B3"), { linha: 2, coluna: 1 });
  assert.deepEqual(posicaoDaCelula("AA1"), { linha: 0, coluna: 26 });
  assert.equal(rangeQueCobre(["B2", "B3"]), "A1:B3");
  assert.equal(rangeQueCobre(CAIXINHAS.map((c) => c.celula)), "A1:B3");

  const rows = [
    ["Caixinha", "Saldo"],
    ["Puxada de Vendas", 1234.5],
    ["Puxada Pós-Vendas", "R$ 2.345,67"],
    ["", ""],
    ["x", "-1.000,00"],
    ["x", 0],
    ["x", 20651.940000000002], // resíduo de ponto flutuante da 1ª leitura real
  ];
  assert.equal(valorDaCelula(rows, "B2"), 1234.5);
  assert.equal(valorDaCelula(rows, "B3"), 2345.67);
  assert.equal(valorDaCelula(rows, "B4"), null); // vazio não é zero
  assert.equal(valorDaCelula(rows, "B5"), -1000);
  assert.equal(valorDaCelula(rows, "B6"), 0); // zero é saldo
  assert.equal(valorDaCelula(rows, "B7"), 20651.94);
  assert.equal(valorDaCelula(rows, "B9"), null); // fora do que veio da API
});
