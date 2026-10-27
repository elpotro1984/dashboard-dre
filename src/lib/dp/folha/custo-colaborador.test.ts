import assert from "node:assert/strict";
import { test } from "node:test";

import { custoMensal } from "@/lib/dp/simulacao";
import {
  ativoNoCusto,
  colunasComValor,
  COLUNAS_CUSTO,
  custoDoColaborador,
  GRUPO_DA_COLUNA,
  participacao,
  resumirCusto,
} from "@/lib/dp/folha/custo-colaborador";
import { CADASTRO_VAZIO, LANCAMENTO_PADRAO, type DpFolhaEntrada } from "@/lib/dp/folha/motor";
import { PARAMETROS_PADRAO as P } from "@/lib/dp/folha/parametros";

const ENC = { inss_patronal: 20, rat_fap: 2, terceiros: 5.8, fgts: 8 };
const COMP = "2026-09"; // 21 dias úteis (07/09 é feriado)

function pessoa(o: Partial<DpFolhaEntrada> = {}): DpFolhaEntrada {
  return {
    solidesId: 1,
    nome: "Ana",
    setor: "Comercial",
    centroCusto: "001 · Comercial",
    empresaId: "e1",
    contrato: "clt",
    salario: 3000,
    nascimento: "1990-01-01",
    admissao: "2024-01-01",
    desligamento: null,
    cadastro: { ...CADASTRO_VAZIO, planoDependentes: [] },
    lancamento: { ...LANCAMENTO_PADRAO, ajustes: {} },
    ...o,
  };
}

test("CLT: 13º 1/12 e férias 1/36 do salário bruto; encargos sobre salário + 13º + férias", () => {
  const c = custoDoColaborador(pessoa(), P, ENC, COMP);
  assert.equal(c.salario, 3000);
  assert.equal(c.decimo, 250);
  assert.equal(c.ferias, 83.33);
  // base 3.333,33
  assert.deepEqual([c.inssPatronal, c.rat, c.terceiros, c.fgts], [666.67, 66.67, 193.33, 266.67]);
  assert.equal(c.salarios, 3333.33);
  assert.equal(c.encargos, 1193.34);
  assert.equal(c.total, 4526.67);
  assert.equal(c.centroCusto, "001 · Comercial");
});

test("a conta é a mesma das Simulações e do Orçamento (mesmas frações, mesmas alíquotas)", () => {
  const c = custoDoColaborador(pessoa({ salario: 4870.55 }), P, ENC, COMP);
  const sim = custoMensal(4870.55, "clt", ENC).total;
  assert.ok(Math.abs(c.salarios + c.encargos - sim) <= 0.03, `${c.salarios + c.encargos} × ${sim}`);
});

test("estágio, PJ e sócio: só o valor (e os benefícios) — sem 13º, férias e encargos", () => {
  for (const contrato of ["estagio", "prestador", "socio"] as const) {
    const c = custoDoColaborador(pessoa({ contrato, salario: 2000 }), P, ENC, COMP);
    assert.deepEqual([c.salario, c.decimo, c.ferias, c.encargos, c.total], [2000, 0, 0, 0, 2000], contrato);
  }
});

test("aprendiz: FGTS de 2%; sem tipo de contrato conta como CLT", () => {
  const ap = custoDoColaborador(pessoa({ contrato: "aprendiz", salario: 1500 }), P, ENC, COMP);
  assert.equal(ap.fgts, Math.round((1500 + 125 + 41.67) * 0.02 * 100) / 100);
  const outro = custoDoColaborador(pessoa({ contrato: "outro" }), P, ENC, COMP);
  assert.equal(outro.total, custoDoColaborador(pessoa(), P, ENC, COMP).total);
});

test("proventos fixos do cadastro entram no salário bruto e na base", () => {
  const cadastro = {
    ...CADASTRO_VAZIO,
    recorrentes: [
      { id: "g", tipo: "provento" as const, descricao: "Gratificação", valor: 600, inicio: "2026-01", fim: null },
      { id: "c", tipo: "desconto" as const, descricao: "Consignado", valor: 300, inicio: "2026-01", fim: null },
      { id: "x", tipo: "provento" as const, descricao: "Vencida", valor: 999, inicio: "2025-01", fim: "2025-12" },
    ],
  };
  const c = custoDoColaborador(pessoa({ cadastro }), P, ENC, COMP);
  assert.equal(c.proventos, 600); // o desconto é do colaborador; o vencido não vale no mês
  assert.equal(c.decimo, 300); // 1/12 de 3.600
});

test("benefícios: só a parte da EMPRESA — plano (Ambulatorial do titular) e VT líquido do desconto", () => {
  const cadastro = {
    ...CADASTRO_VAZIO,
    planoSaude: "enfermaria" as const,
    planoDependentes: [{ nome: "Filho", nascimento: "2015-05-01" }],
    odontoVidas: 2,
    transporteTipo: "bilhete" as const,
    transporteOpcao: "Bilhete BH",
    alimentacao: 300,
    homeOffice: 100,
  };
  const c = custoDoColaborador(pessoa({ cadastro }), P, ENC, COMP);
  // Titular de 36 anos em set/2026: faixa "34 a 38" do Ambulatorial.
  assert.equal(c.planoSaude, 96);
  // VT: 21 × R$ 21 = 441, menos 6% de 3.000 = 180.
  assert.equal(c.valeTransporte, 261);
  assert.equal(c.alimentacao, 300);
  assert.equal(c.homeOffice, 100);
  // O odonto é todo descontado do colaborador: não é custo da empresa.
  assert.equal(c.beneficios, 757);
  assert.match(c.memoria.planoSaude ?? "", /descontado do colaborador/);
});

test("estágio: o VT inteiro é da empresa (não há desconto de 6%)", () => {
  const cadastro = { ...CADASTRO_VAZIO, transporteTipo: "bilhete" as const, transporteOpcao: "Bilhete BH" };
  assert.equal(custoDoColaborador(pessoa({ contrato: "estagio", cadastro }), P, ENC, COMP).valeTransporte, 441);
});

test("o variável do mês não entra: faltas, comissão, férias programadas, ajustes, admissão no meio do mês", () => {
  const fixo = custoDoColaborador(pessoa({ cadastro: { ...CADASTRO_VAZIO, alimentacao: 300, transporteTipo: "bilhete", transporteOpcao: "Bilhete BH" } }), P, ENC, COMP);
  const variado = custoDoColaborador(
    pessoa({
      admissao: "2026-09-15",
      cadastro: {
        ...CADASTRO_VAZIO,
        alimentacao: 300,
        transporteTipo: "bilhete",
        transporteOpcao: "Bilhete BH",
        ferias: [{ id: "f", inicio: "2026-09-01", fim: "2026-09-20" }],
      },
      lancamento: {
        ...LANCAMENTO_PADRAO,
        diasTrabalhados: 10,
        comissao: 5000,
        situacao: "afastado",
        ajustes: { alimentacao: { valor: 1, motivo: "teste" } },
      },
    }),
    P,
    ENC,
    COMP,
  );
  assert.deepEqual(variado, { ...fixo, avisos: variado.avisos });
});

test("cada coluna pertence a um grupo, e o total é a soma dos três", () => {
  assert.deepEqual(
    Array.from(new Set(COLUNAS_CUSTO.map((k) => GRUPO_DA_COLUNA[k]))).sort(),
    ["beneficios", "encargos", "salarios"],
  );
  const c = custoDoColaborador(pessoa({ cadastro: { ...CADASTRO_VAZIO, alimentacao: 200 } }), P, ENC, COMP);
  assert.equal(c.total, Math.round((c.salarios + c.encargos + c.beneficios) * 100) / 100);
});

test("cards: soma do recorte, % sobre o custo total da empresa", () => {
  const a = custoDoColaborador(pessoa(), P, ENC, COMP);
  const b = custoDoColaborador(pessoa({ solidesId: 2, nome: "Bia", contrato: "estagio", salario: 1500 }), P, ENC, COMP);
  const empresa = resumirCusto([a, b]);
  assert.equal(empresa.pessoas, 2);
  assert.equal(empresa.total, Math.round((a.total + b.total) * 100) / 100);
  const recorte = resumirCusto([b]);
  assert.equal(participacao(recorte.total, empresa.total), b.total / empresa.total);
  assert.equal(participacao(10, 0), null);
});

test("colunas: só as que têm valor na empresa; salário sempre", () => {
  const est = custoDoColaborador(pessoa({ contrato: "estagio", salario: 0 }), P, ENC, COMP);
  assert.deepEqual(colunasComValor([est]), ["salario"]);
  const clt = custoDoColaborador(pessoa(), P, ENC, COMP);
  assert.deepEqual(colunasComValor([est, clt]), ["salario", "decimo", "ferias", "inssPatronal", "rat", "terceiros", "fgts"]);
});

test("quem sai no mês fica de fora; quem sai depois, entra", () => {
  assert.equal(ativoNoCusto(null, COMP), true);
  assert.equal(ativoNoCusto("2026-09-30", COMP), false);
  assert.equal(ativoNoCusto("2026-09-10", COMP), false);
  assert.equal(ativoNoCusto("2026-10-01", COMP), true);
});
