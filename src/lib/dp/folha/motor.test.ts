import assert from "node:assert/strict";
import { test } from "node:test";

import {
  CADASTRO_VAZIO,
  calcularFolhaPessoa,
  calcularInss,
  calcularIrrf,
  grupoContratoFolha,
  LANCAMENTO_PADRAO,
  somarFolha,
  type DpFolhaCadastro,
  type DpFolhaEntrada,
  type DpFolhaLancamento,
} from "@/lib/dp/folha/motor";
import { PARAMETROS_PADRAO as P } from "@/lib/dp/folha/parametros";

function pessoa(over: Partial<DpFolhaEntrada> = {}, cad: Partial<DpFolhaCadastro> = {}, lan: Partial<DpFolhaLancamento> = {}): DpFolhaEntrada {
  return {
    solidesId: 1,
    nome: "Fulano",
    setor: "TI",
    centroCusto: "QUOKKA",
    empresaId: "e1",
    contrato: "clt",
    salario: 3000,
    nascimento: "1996-09-15",
    admissao: "2020-01-01",
    desligamento: null,
    cadastro: { ...CADASTRO_VAZIO, planoDependentes: [], ...cad },
    lancamento: { ...LANCAMENTO_PADRAO, ajustes: {}, ...lan },
    ...over,
  };
}

test("INSS 2026 progressivo, faixa a faixa", () => {
  // 7,5% × 1.621 + 9% × 1.281,84 + 12% × 97,16 = 121,58 + 115,37 + 11,66
  assert.equal(calcularInss(3000, P.inss).valor, 248.6);
  // Acima do teto: contribuição máxima
  assert.equal(calcularInss(20000, P.inss).valor, calcularInss(8475.55, P.inss).valor);
  assert.equal(calcularInss(0, P.inss).valor, 0);
});

test("IRRF: até R$ 5.000 o redutor zera; entre 5.000 e 7.350 reduz parcialmente", () => {
  const inss4 = calcularInss(4000, P.inss).valor;
  assert.equal(calcularIrrf(4000, inss4, 0, P.irrf).valor, 0);
  // Sem o redutor, R$ 4.000 pagaria imposto (desconto simplificado > INSS): 15% × 3.392,80 − 394,16
  assert.equal(calcularIrrf(4000, inss4, 0, { ...P.irrf, redutor: null }).valor, 114.76);
  // R$ 6.000: 27,5% × (6.000 − INSS) − 908,73, menos o redutor 978,62 − 0,133145 × 6.000
  const inss6 = calcularInss(6000, P.inss).valor;
  const semRedutor = calcularIrrf(6000, inss6, 0, { ...P.irrf, redutor: null }).valor;
  const comRedutor = calcularIrrf(6000, inss6, 0, P.irrf).valor;
  assert.equal(Math.round((semRedutor - comRedutor) * 100) / 100, 179.75);
});

test("IRRF: dependentes entram na dedução legal", () => {
  const inss = calcularInss(9000, P.inss).valor;
  const sem = calcularIrrf(9000, inss, 0, P.irrf).valor;
  const com = calcularIrrf(9000, inss, 2, P.irrf).valor;
  // 2 × 189,59 × 27,5% = 104,2745 (cada lado arredonda o próprio imposto, então a diferença fica a 1 centavo)
  assert.ok(Math.abs(sem - com - 2 * 189.59 * 0.275) < 0.011);
});

test("salário do mês proporcional aos dias + outros proventos; FGTS sobre salário + férias", () => {
  const r = calcularFolhaPessoa(pessoa({}, {}, { diasTrabalhados: 15, outrosProventos: 100 }), P, "2026-09");
  assert.equal(r.salarioMes, 1600);
  assert.equal(r.fgts, 128);
});

test("1/3 de férias não depende do campo de home office (defeito da planilha)", () => {
  const r = calcularFolhaPessoa(pessoa({}, { homeOffice: 0 }, { diasFerias: 30, diasTrabalhados: 0, inssFerias: 300 }), P, "2026-09");
  assert.equal(r.ferias, 3000);
  assert.equal(r.tercoFerias, 1000);
  assert.equal(r.inssFerias, -300);
});

test("INSS do recibo de férias: vazio = calculado como no recibo (INSS sobre férias + 1/3); zero informado avisa", () => {
  const auto = calcularFolhaPessoa(pessoa({}, {}, { diasFerias: 10 }), P, "2026-09");
  assert.equal(auto.inssFerias, -calcularInss(auto.totalFerias, P.inss).valor);
  assert.equal(auto.automatico.inssFerias, calcularInss(auto.totalFerias, P.inss).valor);
  assert.ok(!auto.avisos.some((a) => a.includes("recibo de férias")));
  const zero = calcularFolhaPessoa(pessoa({}, {}, { diasFerias: 10, inssFerias: 0 }), P, "2026-09");
  assert.equal(zero.inssFerias, 0);
  assert.ok(zero.avisos.some((a) => a.includes("recibo de férias")));
  const informado = calcularFolhaPessoa(pessoa({}, {}, { diasFerias: 10, inssFerias: 123.45 }), P, "2026-09");
  assert.equal(informado.inssFerias, -123.45);
});

test("dias trabalhados automáticos: mês inteiro 30, menos as férias (regra conferida em set/2026)", () => {
  const cheio = calcularFolhaPessoa(pessoa(), P, "2026-09");
  assert.equal(cheio.salarioMes, 3000);
  assert.equal(cheio.automatico.diasTrabalhados, 30);
  const ferias = calcularFolhaPessoa(pessoa({}, {}, { diasFerias: 10 }), P, "2026-09");
  assert.equal(ferias.automatico.diasTrabalhados, 20);
  assert.equal(ferias.salarioMes, 2000);
  // Informado vence o automático
  assert.equal(calcularFolhaPessoa(pessoa({}, {}, { diasTrabalhados: 27 }), P, "2026-09").salarioMes, 2700);
});

test("admissão e desligamento no mês: dias corridos do contrato e VT pelos dias úteis do período", () => {
  const adm = calcularFolhaPessoa(pessoa({ admissao: "2026-09-16" }, { transporteTipo: "bilhete", transporteOpcao: "Bilhete BH" }), P, "2026-09");
  assert.equal(adm.automatico.diasTrabalhados, 15);
  assert.equal(adm.salarioMes, 1500);
  // 16 a 30/09/2026: 11 dias úteis (seg–sex)
  assert.equal(adm.valeTransporte, 21 * 11);
  const desl = calcularFolhaPessoa(pessoa({ desligamento: "2026-09-10" }), P, "2026-09");
  assert.equal(desl.automatico.diasTrabalhados, 10);
  assert.ok(desl.avisos.some((a) => a.includes("rescisão")));
  const estimado = calcularFolhaPessoa(pessoa({ desligamento: "2026-09-10", desligamentoEstimado: true }), P, "2026-09");
  assert.ok(estimado.avisos.some((a) => a.includes("não informou a data")));
  const fora = calcularFolhaPessoa(pessoa({ admissao: "2026-10-05" }), P, "2026-09");
  assert.equal(fora.salarioMes, 0);
  assert.ok(fora.avisos.some((a) => a.includes("Fora do período")));
});

test("VT pelo calendário: dias úteis reais do mês; com férias, estimado proporcional; informado vence", () => {
  const bh = { transporteTipo: "bilhete" as const, transporteOpcao: "Bilhete BH" };
  // nov/2026: 19 dias úteis (02/11 e 20/11 são feriado)
  assert.equal(calcularFolhaPessoa(pessoa({}, bh), P, "2026-11").valeTransporte, 21 * 19);
  // 6 dias por semana em set/2026: 25 (07/09 é feriado)
  assert.equal(calcularFolhaPessoa(pessoa({}, { ...bh, escala: "6 dias" }), P, "2026-09").automatico.vtDias, 25);
  // 10 dias de férias em set: 21 × 20/30 = 14 (estimado)
  const fer = calcularFolhaPessoa(pessoa({}, bh, { diasFerias: 10 }), P, "2026-09");
  assert.equal(fer.automatico.vtDias, 14);
  assert.match(fer.memoria.valeTransporte ?? "", /ESTIMADO/);
  // informado: sobre os dias úteis do mês inteiro (regra da planilha)
  assert.equal(calcularFolhaPessoa(pessoa({}, bh, { diasFerias: 10, vtDiasDesconto: 8 }), P, "2026-09").valeTransporte, 21 * 13);
  // dias fixos quando o calendário está desligado
  assert.equal(calcularFolhaPessoa(pessoa({}, bh), { ...P, vtPeloCalendario: false }, "2026-11").valeTransporte, 21 * 21);
  // feriado municipal da escala
  const comFeriado = { ...P, escalas: P.escalas.map((e) => (e.nome === "5 dias" ? { ...e, feriados: ["2026-11-03"] } : e)) };
  assert.equal(calcularFolhaPessoa(pessoa({}, bh), comFeriado, "2026-11").automatico.vtDias, 18);
});

test("proventos e descontos fixos: entram no período, com a parcela, e somam ao informado", () => {
  const recorrentes = [
    { id: "1", tipo: "desconto" as const, descricao: "Consignado", valor: 200, inicio: "2026-08", fim: "2027-07" },
    { id: "2", tipo: "provento" as const, descricao: "Gratificação", valor: 300, inicio: "2026-10", fim: null },
    { id: "3", tipo: "desconto" as const, descricao: "Antigo", valor: 50, inicio: "2026-01", fim: "2026-03" },
  ];
  const set = calcularFolhaPessoa(pessoa({}, { recorrentes }, { outrosDescontos: 10 }), P, "2026-09");
  assert.equal(set.outrosDescontos, 210);
  assert.equal(set.salarioMes, 3000);
  assert.deepEqual(set.recorrentes.map((x) => x.parcela), ["2/12"]);
  const out = calcularFolhaPessoa(pessoa({}, { recorrentes }), P, "2026-10");
  assert.equal(out.salarioMes, 3300);
  assert.equal(out.outrosDescontos, 200);
});

test("plano: titular + dependente, menos o Ambulatorial do titular pago pela empresa; idade no 1º dia do mês", () => {
  const cad = { planoSaude: "enfermaria" as const, planoDependentes: [{ nome: "Filho", nascimento: "2021-01-10" }] };
  // Nasceu em 15/09/1996: em 01/09/2026 tem 29 (faixa 29 a 33); dependente 5 (00 a 18)
  const r = calcularFolhaPessoa(pessoa({}, cad), P, "2026-09");
  assert.equal(r.planoSaude, Math.round((159.7428 + 111.726 - 83.4785) * 100) / 100);
  // Sem nascimento do titular: não calcula e avisa
  const s = calcularFolhaPessoa(pessoa({ nascimento: null }, cad), P, "2026-09");
  assert.equal(s.planoSaude, 0);
  assert.ok(s.avisos.some((a) => a.includes("nascimento do titular")));
});

test("VT: 6% do salário proporcional, mas nunca mais que o próprio VT", () => {
  const caro = calcularFolhaPessoa(pessoa({}, { transporteTipo: "bilhete", transporteOpcao: "Bilhete BH" }), P, "2026-09");
  assert.equal(caro.valeTransporte, 21 * 21);
  assert.equal(caro.vtDesconto, 180);
  const barato = calcularFolhaPessoa(pessoa({ salario: 10000 }, { transporteTipo: "bilhete", transporteOpcao: "Bilhete Tradicional 2" }), P, "2026-09");
  assert.equal(barato.vtDesconto, barato.valeTransporte);
});

test("gasolina: valor mensal menos os dias descontados; não desconta 6%", () => {
  const r = calcularFolhaPessoa(pessoa({}, { transporteTipo: "gasolina", transporteValor: 210 }, { vtDiasDesconto: 2 }), P, "2026-09");
  assert.equal(r.valeGasolina, 190);
  assert.equal(r.vtDesconto, 0);
});

test("salário-família: só CLT e só até o limite de remuneração", () => {
  assert.equal(calcularFolhaPessoa(pessoa({ salario: 1800 }, { salarioFamiliaCotas: 2 }), P, "2026-09").salarioFamilia, 135.08);
  const acima = calcularFolhaPessoa(pessoa({ salario: 3000 }, { salarioFamiliaCotas: 1 }), P, "2026-09");
  assert.equal(acima.salarioFamilia, 0);
  assert.ok(acima.avisos.length > 0);
});

test("afastado: sem salário, sem benefício e sem desconto de plano (a planilha dava desconto negativo)", () => {
  const r = calcularFolhaPessoa(
    pessoa({}, { planoSaude: "ambulatorial", alimentacao: 500, transporteTipo: "bilhete", transporteOpcao: "Bilhete BH" }, { situacao: "afastado" }),
    P,
    "2026-09",
  );
  assert.equal(r.salarioMes, 0);
  assert.equal(r.planoSaude, 0);
  assert.equal(r.alimentacao, 0);
  assert.equal(r.valeTransporte, 0);
  assert.equal(r.totalGeral, 0);
});

test("estágio: sem INSS, sem FGTS e sem 1/3; sócio e PJ: sem INSS, IRRF e FGTS", () => {
  const e = calcularFolhaPessoa(pessoa({ contrato: "estagio" }, {}, { diasFerias: 10, diasTrabalhados: 20 }), P, "2026-09");
  assert.equal(e.inss, 0);
  assert.equal(e.fgts, 0);
  assert.equal(e.tercoFerias, 0);
  for (const contrato of ["socio", "prestador"] as const) {
    const r = calcularFolhaPessoa(pessoa({ contrato, salario: 20000 }), P, "2026-09");
    assert.equal(r.inss + r.irrf + r.fgts, 0);
  }
});

test("sem INSS (diretor): INSS zero, IRRF e FGTS seguem", () => {
  const r = calcularFolhaPessoa(pessoa({ salario: 10000 }, { semInss: true }), P, "2026-09");
  assert.equal(r.inss, 0);
  assert.ok(r.irrf > 0);
  assert.equal(r.fgts, 800);
});

test("adiantamento: 40% do salário de carteira e sai do 5º dia útil", () => {
  const r = calcularFolhaPessoa(pessoa({}, { adiantamento: true }), P, "2026-09");
  assert.equal(r.adiantamento, 1200);
  assert.equal(r.quintoDiaUtil, Math.round((r.saldo - 1200) * 100) / 100);
});

test("alimentação proporcional a dias trabalhados + férias", () => {
  const r = calcularFolhaPessoa(pessoa({}, { alimentacao: 600 }, { diasTrabalhados: 20, diasFerias: 10, inssFerias: 1 }), P, "2026-09");
  assert.equal(r.alimentacao, 600);
});

test("ajuste manual vence o cálculo, as somas seguem dele e a memória guarda o calculado", () => {
  const base = calcularFolhaPessoa(pessoa({ salario: 9000 }), P, "2026-09");
  const r = calcularFolhaPessoa(pessoa({ salario: 9000 }, {}, { ajustes: { irrf: { valor: 1000, motivo: "valor da contabilidade" } } }), P, "2026-09");
  assert.equal(r.irrf, 1000);
  assert.equal(r.ajustados.irrf, base.irrf);
  assert.equal(r.totalDescontos, Math.round((base.totalDescontos - base.irrf + 1000) * 100) / 100);
  assert.match(r.memoria.irrf ?? "", /contabilidade/);
});

test("ajuste nas férias muda a base do INSS e do FGTS (como na planilha)", () => {
  const r = calcularFolhaPessoa(pessoa({}, {}, { diasFerias: 10, inssFerias: 50, ajustes: { ferias: { valor: 2000, motivo: "média de variáveis" } } }), P, "2026-09");
  assert.equal(r.ferias, 2000);
  assert.equal(r.fgts, Math.round((r.salarioMes + 2000 + r.tercoFerias) * 0.08 * 100) / 100);
});

test("sem tipo de contrato: calculado como CLT, com aviso", () => {
  const r = calcularFolhaPessoa(pessoa({ contrato: "outro" }), P, "2026-09");
  assert.ok(r.inss > 0 && r.fgts > 0);
  assert.ok(r.avisos.some((a) => a.includes("tipo de contrato")));
});

test("somarFolha soma coluna a coluna", () => {
  const a = calcularFolhaPessoa(pessoa(), P, "2026-09");
  const t = somarFolha([a, a]);
  assert.equal(t.totalGeral, Math.round(a.totalGeral * 2 * 100) / 100);
});

test("jovem aprendiz é CLT com FGTS de 2% — não é estágio", () => {
  assert.equal(grupoContratoFolha("Jovem Aprendiz"), "aprendiz");
  assert.equal(grupoContratoFolha("Estagiário"), "estagio");
  assert.equal(grupoContratoFolha("CLT"), "clt");
  assert.equal(grupoContratoFolha(null), "outro");
  const r = calcularFolhaPessoa(pessoa({ contrato: "aprendiz", salario: 1621 }, {}, { diasFerias: 10, inssFerias: 1 }), P, "2026-09");
  assert.ok(r.inss > 0);
  assert.ok(r.tercoFerias > 0);
  assert.equal(r.fgts, Math.round((r.salarioMes + r.totalFerias) * 0.02 * 100) / 100);
});

test("férias programadas: dias do mês, salário e VT EXATOS pelas datas", () => {
  const bh = { transporteTipo: "bilhete" as const, transporteOpcao: "Bilhete BH" };
  // 21/09 a 20/10/2026: em setembro, 10 dias de férias; dias úteis de 21 a 30/09 = 8
  const ferias = [{ id: "1", inicio: "2026-09-21", fim: "2026-10-20" }];
  const set = calcularFolhaPessoa(pessoa({}, { ...bh, ferias }), P, "2026-09");
  assert.equal(set.automatico.diasFerias, 10);
  assert.equal(set.salarioMes, 2000);
  assert.equal(set.ferias, 1000);
  assert.equal(set.automatico.vtDias, 21 - 8);
  assert.doesNotMatch(set.memoria.valeTransporte ?? "", /ESTIMADO/);
  // outubro: 20 dias de férias; úteis de 01 a 20/10 = 13 (12/10 feriado) → 21 − 13 = 8
  const out = calcularFolhaPessoa(pessoa({}, { ...bh, ferias }), P, "2026-10");
  assert.equal(out.automatico.diasFerias, 20);
  assert.equal(out.salarioMes, 1000);
  assert.equal(out.automatico.vtDias, 8);
  // informado vence o programado
  assert.equal(calcularFolhaPessoa(pessoa({}, { ...bh, ferias }, { diasFerias: 5 }), P, "2026-09").ferias, 500);
});
