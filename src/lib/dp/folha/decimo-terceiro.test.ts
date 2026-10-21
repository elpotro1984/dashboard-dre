import assert from "node:assert/strict";
import { test } from "node:test";

import {
  avosNoAno,
  calcular13,
  classificarMeses13,
  dataLimite13,
  descreverAvos,
  somar13,
  validarAjustes13,
  type Dp13Entrada,
} from "@/lib/dp/folha/decimo-terceiro";
import { PARAMETROS_PADRAO, validarParametros, type DpFolhaParametros } from "@/lib/dp/folha/parametros";

const P = PARAMETROS_PADRAO;
const quase = (a: number, b: number, msg?: string) => assert.ok(Math.abs(a - b) <= 0.011, `${msg ?? ""} ${a} ≠ ${b}`);

const base: Dp13Entrada = {
  solidesId: 1,
  nome: "Pessoa",
  setor: null,
  contrato: "clt",
  salario: 3000,
  admissao: "2024-05-10",
  desligamento: null,
  dependentesIr: 0,
  semInss: false,
  afastados: [],
  licenca: [],
  poucosDias: [],
  primeiraNasFerias: null,
  primeiraEstaFechada: false,
  primeiraFechada: null,
  ajustes: {},
};

test("ano inteiro: 1ª = metade do salário; 2ª desconta INSS do 13º à parte", () => {
  const r = calcular13(base, P, 2026);
  assert.equal(r.fora, null);
  assert.equal(r.avosAno, 12);
  assert.equal(r.integral, 3000);
  assert.equal(r.primeira, 1500);
  assert.equal(r.inss, 248.6); // 121,575 + 115,3656 + 11,6592
  assert.equal(r.irrf, 0); // 3.000 − simplificado 607,20 = 2.392,80: faixa isenta
  assert.equal(r.segunda, 1251.4);
  assert.equal(r.fgts, 240);
  assert.equal(r.custo, 3240);
});

test("admissão no ano: mês com 15 dias ou mais conta; 14 não", () => {
  assert.equal(calcular13({ ...base, salario: 2400, admissao: "2026-07-12" }, P, 2026).avosAno, 6); // 20 dias em julho
  assert.equal(calcular13({ ...base, salario: 2400, admissao: "2026-07-18" }, P, 2026).avosAno, 5); // 14 dias
  const r = calcular13({ ...base, salario: 2400, admissao: "2026-07-12" }, P, 2026);
  assert.equal(r.integral, 1200);
  assert.equal(r.primeira, 600);
});

test("avos da 1ª parcela até novembro (parâmetro) pagam menos a quem entrou no ano", () => {
  const p: DpFolhaParametros = { ...P, decimoTerceiro: { avosPrimeiraAte: 11 } };
  const r = calcular13({ ...base, salario: 2400, admissao: "2026-07-12" }, p, 2026);
  assert.equal(r.avosPrimeira, 5);
  assert.equal(r.primeira, 500);
  assert.equal(r.integral, 1200); // o 13º do ano não muda: a diferença vai na 2ª
});

test("salário alto: INSS no teto, IRRF pela dedução legal, sem redutor", () => {
  const r = calcular13({ ...base, salario: 10000 }, P, 2026);
  assert.equal(r.inss, 988.09);
  quase(r.irrf, 1569.55, "irrf");
  quase(r.segunda, 10000 - 5000 - 988.09 - 1569.55, "segunda");
});

test("faixa do redutor: 13º de 6.000 tem o imposto reduzido", () => {
  const r = calcular13({ ...base, salario: 6000 }, P, 2026);
  // INSS 6.000: 121,575 + 115,3656 + 174,1716 + 230,4022 = 641,51
  assert.equal(r.inss, 641.51);
  // base 5.358,49 × 27,5% − 908,73 = 564,8548; redutor 978,62 − 0,133145 × 6.000 = 179,75
  quase(r.irrf, 385.1, "irrf");
});

test("mês afastado não conta avo (o INSS paga o abono)", () => {
  const r = calcular13({ ...base, afastados: ["2026-03", "2026-04"] }, P, 2026);
  assert.equal(r.avosAno, 10);
  assert.match(r.memoria.avos ?? "", /afastado/);
});

test("1ª parcela paga nas férias: nada em novembro, a 2ª desconta", () => {
  const r = calcular13({ ...base, primeiraNasFerias: 1500 }, P, 2026);
  assert.equal(r.primeira, 0);
  assert.equal(r.primeiraConsiderada, 1500);
  assert.equal(r.segunda, 1251.4);
});

test("1ª fechada: a 2ª desconta o RETRATO, não o recálculo", () => {
  const r = calcular13({ ...base, salario: 3200, primeiraEstaFechada: true, primeiraFechada: 1500 }, P, 2026);
  assert.equal(r.integral, 3200);
  assert.equal(r.primeira, 1500);
  assert.equal(r.primeiraConsiderada, 1500);
  assert.match(r.memoria.primeira ?? "", /Recalculada hoje daria/);
  // fora do retrato (entrou depois): tudo na 2ª
  const novo = calcular13({ ...base, admissao: "2026-12-01", primeiraEstaFechada: true, primeiraFechada: null }, P, 2026);
  assert.equal(novo.primeiraConsiderada, 0);
  assert.equal(novo.avosAno, 1);
});

test("fora da tela: estágio, PJ e desligado no ano (com a 1ª a descontar na rescisão)", () => {
  assert.match(calcular13({ ...base, contrato: "estagio" }, P, 2026).fora ?? "", /Estágio/);
  assert.match(calcular13({ ...base, contrato: "prestador" }, P, 2026).fora ?? "", /PJ/);
  const d = calcular13({ ...base, desligamento: "2026-12-05", primeiraEstaFechada: true, primeiraFechada: 1500 }, P, 2026);
  assert.match(d.fora ?? "", /rescisão/);
  assert.match(d.avisos.join(" "), /1ª parcela já paga/);
  assert.equal(somar13([d]).pessoas, 0);
});

test("aprendiz: FGTS de 2%", () => {
  assert.equal(calcular13({ ...base, contrato: "aprendiz" }, P, 2026).fgts, 60);
});

test("ajuste manual vence o cálculo e guarda o calculado", () => {
  const r = calcular13({ ...base, ajustes: { base: { valor: 3600, motivo: "média de horas extras" } } }, P, 2026);
  assert.equal(r.base, 3600);
  assert.equal(r.integral, 3600);
  assert.equal(r.ajustados.base, 3000);
  assert.throws(() => validarAjustes13({ avos: { valor: 13, motivo: "x" } }), /0 a 12/);
  assert.throws(() => validarAjustes13({ irrf: { valor: 10, motivo: " " } }), /motivo/);
  assert.deepEqual(validarAjustes13({ avos: { valor: 11, motivo: " faltas em março " } }), { avos: { valor: 11, motivo: "faltas em março" } });
});

test("prazos: 30/11 e 20/12, antecipados ao último dia útil", () => {
  assert.equal(dataLimite13(2026, 1), "2026-11-30"); // segunda
  assert.equal(dataLimite13(2026, 2), "2026-12-18"); // 20/12 é domingo
  assert.equal(dataLimite13(2025, 1), "2025-11-28"); // 30/11 domingo
  assert.equal(dataLimite13(2025, 2), "2025-12-19"); // 20/12 sábado
});

test("descrição dos avos agrupa meses e explica o que ficou de fora", () => {
  const { meses } = avosNoAno({ admissao: "2026-02-20", desligamento: null, ano: 2026, ateMes: 12, afastados: new Set(["2026-06"]) });
  assert.equal(descreverAvos(meses), "mar a mai, jul a dez; não contam: fev (9 dia(s) de contrato no mês), jun (afastado (o INSS paga o abono do período))");
});

test("parâmetro do 13º: padrão 12, só 10/11/12 aceitos, vigência antiga cai no padrão", () => {
  assert.equal(validarParametros({ ...P, decimoTerceiro: undefined as never }).decimoTerceiro.avosPrimeiraAte, 12);
  assert.throws(() => validarParametros({ ...P, decimoTerceiro: { avosPrimeiraAte: 9 as never } }), /outubro, novembro ou dezembro/);
});

test("meses dos lançamentos: afastado, licença e dias informados abaixo de 15 (férias contam)", () => {
  const pessoa = { admissao: "2025-01-01", desligamento: null, ferias: [{ id: "f", inicio: "2026-05-04", fim: "2026-05-23" }] };
  const r = classificarMeses13(
    [
      { competencia: "2026-04", situacao: "afastado", diasTrabalhados: null, diasFerias: null },
      { competencia: "2026-02", situacao: "licenca_maternidade", diasTrabalhados: null, diasFerias: null },
      { competencia: "2026-03", situacao: "normal", diasTrabalhados: 12, diasFerias: 0 },
      { competencia: "2026-05", situacao: "normal", diasTrabalhados: 8, diasFerias: null }, // 8 + 20 programados
      { competencia: "2026-06", situacao: "normal", diasTrabalhados: null, diasFerias: null },
    ],
    pessoa,
  );
  assert.deepEqual(r, { afastados: ["2026-04"], licenca: ["2026-02"], poucosDias: ["2026-03"] });
  // mês em que o contrato já tinha menos de 15 dias: a regra do contrato decide, sem aviso a mais
  const novo = classificarMeses13([{ competencia: "2026-07", situacao: "normal", diasTrabalhados: 5, diasFerias: 0 }], { ...pessoa, admissao: "2026-07-20" });
  assert.deepEqual(novo.poucosDias, []);
});

test("sem admissão: conta o ano todo, mas avisa", () => {
  const r = calcular13({ ...base, admissao: null }, P, 2026);
  assert.equal(r.avosAno, 12);
  assert.match(r.avisos.join(" "), /Sem data de admissão/);
});
