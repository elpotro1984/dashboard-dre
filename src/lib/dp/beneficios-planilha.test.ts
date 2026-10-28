import assert from "node:assert/strict";
import { test } from "node:test";

import { BENEFICIOS_COLABORADOR_VAZIO, opcoesDoBloco } from "@/lib/dp/beneficios-colaborador";
import type { DpBeneficiosDados } from "@/lib/dp/beneficios-config";
import {
  DESTINOS_PLANILHA,
  escolhasNaPlanilha,
  idDoColaboradorPlanilha,
  opcoesDaPlanilha,
  rotuloColaboradorPlanilha,
} from "@/lib/dp/beneficios-planilha";

const CFG: DpBeneficiosDados = {
  alimentacao: { regra: "diario", faixas: [{ id: "va1", nome: "Faixa 1", valor: 20 }] },
  transporte: { descontar6: true, bilhetes: [{ id: "vt1", nome: "Bilhete BH", valor: 11 }] },
  gasolina: { faixas: [{ id: "g1", de: 0, ate: 11, valor: 150 }, { id: "g2", de: 11.1, ate: null, valor: 300 }] },
  carona: { faixas: [{ id: "c1", de: 0, ate: 20, valor: 80 }] },
  home_office: { porDias: [{ id: "h1", dias: 1, valor: 20 }, { id: "h3", dias: 3, valor: 10 }] },
  sesi: { modalidades: [{ id: "s1", nome: "Individual", valor: 45 }] },
  salario_familia: { cota: 67.54, limite: 1980.38, vigencia: null, fonte: null },
  assiduidade: { valor: 50 },
};

test("rótulo do colaborador: o ID no fim é o que a importação lê de volta", () => {
  const r = rotuloColaboradorPlanilha({ nome: "Ana (Souza)", empresa: "Dataforte", solidesId: 123 });
  assert.equal(r, "Ana (Souza) — Dataforte (ID 123)");
  assert.equal(idDoColaboradorPlanilha(r), 123, "parêntese no nome não confunde");
  assert.equal(idDoColaboradorPlanilha(" 456 "), 456, "a coluna de ID digitada");
  assert.equal(idDoColaboradorPlanilha(789), 789);
  assert.equal(idDoColaboradorPlanilha("Ana Souza"), null);
  assert.equal(idDoColaboradorPlanilha(1.5), null);
});

test("opções da lista = o texto do card (é o que a importação casa de volta)", () => {
  const o = opcoesDaPlanilha(CFG);
  assert.deepEqual(o.gasolina, opcoesDoBloco(CFG, "gasolina").map((x) => x.nome));
  assert.deepEqual(o.gasolina, ["de 0 a 11 km", "acima de 11,1 km"]);
  assert.deepEqual(o.homeOffice, ["1 dia presencial", "3 dias presenciais"]);
  assert.deepEqual(o.alimentacao, ["Faixa 1"]);
  assert.equal(DESTINOS_PLANILHA.at(-1), "Separado");
  assert.equal(DESTINOS_PLANILHA.length, 9, "os oito benefícios + Separado");
});

test("o modelo vem com o que a pessoa já tem; escolha que saiu do cadastro vira vazio", () => {
  const e = {
    ...BENEFICIOS_COLABORADOR_VAZIO,
    alimentacao: { id: "va1", nome: "Faixa 1" },
    gasolina: { id: "sumiu", nome: "Antiga" },
    homeOfficeDias: 3,
    assiduidade: true,
  };
  assert.deepEqual(escolhasNaPlanilha(e, CFG), {
    alimentacao: "Faixa 1",
    transporte: "",
    gasolina: "",
    carona: "",
    homeOffice: "3 dias presenciais",
    sesi: "",
    assiduidade: "Sim",
  });
  assert.equal(escolhasNaPlanilha({ ...e, homeOfficeDias: 2 }, CFG).homeOffice, "", "dias sem valor na empresa");
});
