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

test("férias sem o INSS do recibo informado geram aviso", () => {
  const r = calcularFolhaPessoa(pessoa({}, {}, { diasFerias: 10 }), P, "2026-09");
  assert.ok(r.avisos.some((a) => a.includes("recibo de férias")));
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
