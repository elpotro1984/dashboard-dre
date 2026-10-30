// O andamento de cada método no card do hub.

import test from "node:test";
import assert from "node:assert/strict";

import { chaveFinalizacao } from "./finalizacao";
import type { OrcamentoMetodo } from "./metodos";
import {
  fatiaFechada,
  progressoPessoal,
  progressoPorCategoria,
  progressoViagens,
  textoProgresso,
} from "./progresso";

const BALDE = "balde";
const fechou = (metodo: OrcamentoMetodo, categoryCode: string, setorId: string | null) =>
  chaveFinalizacao({ metodo, categoryCode, setorId });

const semMapa = new Map<string, readonly string[]>();

test("sem setor: a fatia fechada no balde OU em setor nulo conta", () => {
  assert.equal(
    fatiaFechada(new Set([fechou("media", "c1", BALDE)]), "media", "c1", null, false, BALDE),
    true,
  );
  assert.equal(
    fatiaFechada(new Set([fechou("pessoal", "", null)]), "pessoal", "", null, false, BALDE),
    true,
  );
  // O método conta: fechar a média não fecha o valor fixo da mesma categoria.
  assert.equal(
    fatiaFechada(new Set([fechou("media", "c1", BALDE)]), "valor_fixo", "c1", null, false, BALDE),
    false,
  );
});

test("categoria sem setor: finalizada, em andamento (tem dado) e não iniciada", () => {
  const p = progressoPorCategoria({
    metodo: "planejamento_socios",
    categorias: ["a", "b", "c"],
    porSetor: false,
    baldeId: BALDE,
    fechadas: new Set([fechou("planejamento_socios", "a", BALDE)]),
    atribuidos: semMapa,
    comDado: new Map([
      ["a", new Set([BALDE])],
      ["b", new Set([BALDE])],
    ]),
    escopo: null,
  });
  assert.deepEqual(p, { unidade: "categoria", total: 3, finalizadas: 1, emAndamento: 1 });
});

test("com setor: a categoria só fecha quando TODOS os setores dela fecham", () => {
  const p = progressoPorCategoria({
    metodo: "media",
    categorias: ["mkt"],
    porSetor: true,
    baldeId: null,
    fechadas: new Set([fechou("media", "mkt", "com")]),
    atribuidos: new Map([["mkt", ["com", "prod"]]]),
    comDado: new Map(),
    escopo: null,
  });
  // Um setor fechado e outro aberto = em andamento, não finalizada.
  assert.deepEqual(p, { unidade: "categoria", total: 1, finalizadas: 0, emAndamento: 1 });
});

test("com setor: dado num setor fora da atribuição também precisa fechar", () => {
  const p = progressoPorCategoria({
    metodo: "valor_fixo",
    categorias: ["aluguel"],
    porSetor: true,
    baldeId: null,
    fechadas: new Set([fechou("valor_fixo", "aluguel", "adm")]),
    atribuidos: new Map([["aluguel", ["adm"]]]),
    comDado: new Map([["aluguel", new Set(["adm", "ops"])]]),
    escopo: null,
  });
  assert.equal(p.finalizadas, 0);
  assert.equal(p.emAndamento, 1);
});

test("com setor: o escopo do Gerente recorta os setores e tira do total o que não é dele", () => {
  const p = progressoPorCategoria({
    metodo: "media",
    categorias: ["mkt", "ti"],
    porSetor: true,
    baldeId: null,
    fechadas: new Set([fechou("media", "mkt", "com")]),
    atribuidos: new Map([
      ["mkt", ["com", "prod"]],
      ["ti", ["prod"]],
    ]),
    comDado: new Map(),
    escopo: ["com"],
  });
  // Do ponto de vista do Comercial: Marketing é a única categoria dele, e fechou.
  assert.deepEqual(p, { unidade: "categoria", total: 1, finalizadas: 1, emAndamento: 0 });
});

test("pessoal sem setor é UM quadro", () => {
  const aberto = progressoPessoal({
    porSetor: false,
    baldeId: BALDE,
    fechadas: new Set(),
    setores: [],
    colaboradores: new Map([[null, 12]]),
  });
  assert.deepEqual(aberto, { unidade: "quadro", total: 1, finalizadas: 0, emAndamento: 1 });

  const fechado = progressoPessoal({
    porSetor: false,
    baldeId: BALDE,
    fechadas: new Set([fechou("pessoal", "", null)]),
    setores: [],
    colaboradores: new Map([[null, 12]]),
  });
  assert.equal(fechado.finalizadas, 1);
  assert.equal(fechado.emAndamento, 0);
});

test("pessoal com setor: o balde só entra se tiver gente", () => {
  const p = progressoPessoal({
    porSetor: true,
    baldeId: BALDE,
    fechadas: new Set([fechou("pessoal", "", "com")]),
    setores: ["com", "prod", "ti"],
    colaboradores: new Map([
      ["com", 3],
      ["prod", 2],
    ]),
  });
  assert.deepEqual(p, { unidade: "setor", total: 3, finalizadas: 1, emAndamento: 1 });

  const comBalde = progressoPessoal({
    porSetor: true,
    baldeId: BALDE,
    fechadas: new Set(),
    setores: ["com"],
    colaboradores: new Map([[BALDE, 4]]),
  });
  assert.equal(comBalde.total, 2);
  assert.equal(comBalde.emAndamento, 1);
});

test("viagens: rascunho não começou, o resto anda, a fatia fechada finaliza", () => {
  const p = progressoViagens({
    porSetor: false,
    baldeId: BALDE,
    fechadas: new Set([fechou("viagens", "2.01.98", BALDE)]),
    viagens: [
      { status: "em_aprovacao", categoryCode: "2.01.98", setorId: BALDE },
      { status: "em_cotacao", categoryCode: "2.04.10", setorId: BALDE },
      { status: "rascunho", categoryCode: "2.04.10", setorId: BALDE },
      { status: "aguardando_cotacao", categoryCode: null, setorId: BALDE },
    ],
  });
  assert.deepEqual(p, { unidade: "viagem", total: 4, finalizadas: 1, emAndamento: 2 });
});

test("o texto concorda com a unidade e some quando não há o que contar", () => {
  assert.deepEqual(
    textoProgresso({ unidade: "categoria", total: 30, finalizadas: 10, emAndamento: 5 }),
    { principal: "10/30 categorias finalizadas", secundario: "5 em andamento", completo: false },
  );
  assert.equal(
    textoProgresso({ unidade: "setor", total: 4, finalizadas: 4, emAndamento: 0 })?.principal,
    "4/4 setores finalizados",
  );
  assert.equal(
    textoProgresso({ unidade: "categoria", total: 1, finalizadas: 0, emAndamento: 0 })?.principal,
    "0/1 categoria finalizada",
  );
  assert.equal(textoProgresso({ unidade: "viagem", total: 0, finalizadas: 0, emAndamento: 0 }), null);
  assert.equal(textoProgresso(null), null);
});

test("o quadro único diz o estado, não 0/1", () => {
  const base = { unidade: "quadro" as const, total: 1 };
  assert.equal(textoProgresso({ ...base, finalizadas: 1, emAndamento: 0 })?.principal, "Quadro finalizado");
  assert.equal(textoProgresso({ ...base, finalizadas: 0, emAndamento: 1 })?.principal, "Quadro em andamento");
  assert.equal(textoProgresso({ ...base, finalizadas: 0, emAndamento: 0 })?.principal, "Quadro não iniciado");
});
