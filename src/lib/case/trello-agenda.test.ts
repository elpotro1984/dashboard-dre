import test from "node:test";
import assert from "node:assert/strict";

import { lerAtracoes, lerNps, lerQuadro, lerTitulo, type TrelloBoard } from "./trello-agenda";

test("padrão comum: TIPO - TURMA - LOCAL - DATA - UNIDADE", () => {
  const t = lerTitulo("BAILE - MED SUPREMA 33 - TERRAZZO - 15.08.2026 - VIVA JF");
  assert.equal(t.categoria, "BAILE");
  assert.equal(t.turma, "MED SUPREMA 33");
  assert.equal(t.local_name, "TERRAZZO");
  assert.equal(t.local_city, null);
  assert.equal(t.unidade, "VIVA JF");
  assert.equal(t.event_date, "2026-08-15");
  assert.equal(t.intermediacao, false);
});

test("ano com dois dígitos e barra como separador", () => {
  assert.equal(lerTitulo("BAILE - TERCEIRÃO VIANNA  - ESTAÇÃO SÃO PEDRO - 18.12.26 - VIVA JF").event_date, "2026-12-18");
  assert.equal(lerTitulo("BAILE - JESUITAS 2026 - TERRAZZO - 18/12/2026 - VIVA JF").event_date, "2026-12-18");
});

test("tipo sem hífen e data colada na unidade", () => {
  const t = lerTitulo("BAILE ENFERMAGEM UFJF - ESTAÇÃO SÃO PEDRO - JUIZ DE FORA MG  - VIVA JF 31/10/2026");
  assert.equal(t.categoria, "BAILE");
  assert.equal(t.turma, "ENFERMAGEM UFJF");
  assert.equal(t.local_name, "ESTAÇÃO SÃO PEDRO");
  assert.equal(t.local_city, "JUIZ DE FORA MG");
  assert.equal(t.unidade, "VIVA JF");
  assert.equal(t.event_date, "2026-10-31");
});

test("data no meio do local não quebra a leitura", () => {
  const t = lerTitulo("BAILE - MED ESTÁCIO - 08.01.27 - CASA RIOLL - PETROLINA PE - VIVA GO");
  assert.equal(t.turma, "MED ESTÁCIO");
  assert.equal(t.local_name, "CASA RIOLL");
  assert.equal(t.local_city, "PETROLINA PE");
  assert.equal(t.unidade, "VIVA GO");
  assert.equal(t.event_date, "2027-01-08");
});

test("intermediação vira marca, não turma nem unidade", () => {
  const a = lerTitulo("Contrato intermédio - CASAMENTO - ANA E NION - MILAGRES - 14.11.2026 - INTERMEDIO");
  assert.equal(a.intermediacao, true);
  assert.equal(a.categoria, "CASAMENTO");
  assert.equal(a.turma, "ANA E NION");
  assert.equal(a.local_name, "MILAGRES");
  assert.equal(a.unidade, null);

  const b = lerTitulo("INTERMEDIO - BAILE - MED UNINASSAU - RECIFE PE - 15.01.2027 - VIVA Recife");
  assert.equal(b.intermediacao, true);
  assert.equal(b.categoria, "BAILE");
  assert.equal(b.unidade, "VIVA Recife");
});

test("período: guarda início e fim", () => {
  const t = lerTitulo("BILHETERIA - XIQUE XIQUE - EXPOMINAS - 09.10.2026 a 11.10.2026 - FEAT");
  assert.equal(t.event_date, "2026-10-09");
  assert.equal(t.event_date_fim, "2026-10-11");
  assert.equal(t.local_name, "EXPOMINAS");
  assert.equal(t.unidade, "FEAT");
});

test("data sem ano não é chutada", () => {
  assert.equal(lerTitulo("CSC - VIVA JF - BAILE 22.12 - TERRAZZO").event_date, null);
});

test("data impossível é recusada", () => {
  assert.equal(lerTitulo("BAILE - X - Y - 31.02.2027 - VIVA JF").event_date, null);
});

test("NPs da descrição", () => {
  assert.deepEqual(lerNps("NP 625"), [625]);
  assert.deepEqual(lerNps("FP NP 659\n\nBR NP 660"), [659, 660]);
  assert.deepEqual(lerNps("OFFBEAT - NP 663\n\nWC NO BEAT - 664"), [663]);
  assert.deepEqual(lerNps(""), []);
});

test("atrações: checklist com nome de artista e anexo no padrão; genéricas ignoradas", () => {
  const a = lerAtracoes(
    ["ATRAÇÕES", "DJ GBR", "Ousasamba", "Checklist Leonardo"],
    [
      "CONTRATO_ATRAÇÃO - DJ WM_-_BAILE_ENFERMAGEM_UFJF.pdf",
      "CONTRATO_ATRAÇÃO - ousasamba_-_BAILE.pdf",
      "Contrato Simonésia (1) assinado.pdf",
    ],
  );
  assert.deepEqual(a, ["DJ GBR", "Ousasamba", "DJ WM"]);
});

test("atrações: separador do anexo varia entre espaço, hífen e underscore", () => {
  const a = lerAtracoes([], [
    "CONTRATO_ATRAÇÃO - PABLO -_BAILE_-_FARMACIA_UFJF.pdf",
    "CONTRATO ATRAÇÃO - LD- BAILE - ENGENHARIA UFJF.pdf",
    "CONTRATO_ATRAÇÃO_-_LD_DA_FAVELINHA_-_BAILE_-_MED_EROS.pdf",
  ]);
  assert.deepEqual(a, ["PABLO", "LD", "LD DA FAVELINHA"]);
});

const board = (cards: TrelloBoard["cards"]): TrelloBoard => ({
  lists: [
    { id: "nov", name: "NOVEMBRO - 2026", closed: false },
    { id: "eq", name: "EQUIPE", closed: false },
    { id: "velha", name: "AGOSTO - 2024", closed: true },
  ],
  checklists: [{ id: "c1", name: "FORMULA 7" }],
  cards,
});

const card = (over: Partial<TrelloBoard["cards"][number]>): TrelloBoard["cards"][number] => ({
  id: "x",
  name: "BAILE - TERCEIRAO - UBÁ - 28.11.2026 - VIVA UBÁ",
  desc: "",
  closed: false,
  idList: "nov",
  idChecklists: [],
  ...over,
});

test("quadro: corta pelo dia, ignora apoio, arquivados e cartões sem data", () => {
  const r = lerQuadro(
    board([
      card({ id: "a", idChecklists: ["c1"], desc: "NP 629" }),
      card({ id: "b", name: "BAILE - X - Y - 01.10.2026 - VIVA JF" }),
      card({ id: "c", name: "DAVID", idList: "eq" }),
      card({ id: "d", closed: true }),
      card({ id: "e", idList: "velha" }),
      card({ id: "f", name: "VIVA JF - JESUITAS - BAILE 16.12 - TERRAZZO" }),
    ]),
    "2026-10-14",
  );
  assert.deepEqual(r.linhas.map((l) => l.origem_id), ["a"]);
  assert.deepEqual(r.linhas[0].atracoes, ["FORMULA 7"]);
  assert.deepEqual(r.linhas[0].nps, [629]);
  assert.deepEqual(r.ignorados, [{ titulo: "VIVA JF - JESUITAS - BAILE 16.12 - TERRAZZO", motivo: "sem data completa no título" }]);
});

test("quadro: período que termina depois do corte entra", () => {
  const r = lerQuadro(board([card({ name: "BILHETERIA - X - Y - 10.10.2026 a 20.10.2026 - FEAT" })]), "2026-10-14");
  assert.equal(r.linhas.length, 1);
});

test("quadro: duplicado fica uma vez só, com o cartão mais completo", () => {
  const r = lerQuadro(
    board([
      card({ id: "vazio", name: "BAILE - TERCEIRÃO APOGEU - TERRAZZO - 27.11.2026 - VIVA JF" }),
      card({ id: "cheio", name: "BAILE - TERCEIRÃO APOGEU - TERRAZZO - 27.11.2026 - VIVA JF", desc: "NP 700" }),
    ]),
    "2026-10-14",
  );
  assert.deepEqual(r.linhas.map((l) => l.origem_id), ["cheio"]);
  assert.equal(r.ignorados[0].motivo, "cartão duplicado");
});
