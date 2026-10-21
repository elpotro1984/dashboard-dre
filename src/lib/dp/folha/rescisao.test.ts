import assert from "node:assert/strict";
import { test } from "node:test";

import { PARAMETROS_PADRAO } from "@/lib/dp/folha/parametros";
import {
  anosCompletos,
  avosFeriasProporcionais,
  calcularRescisao,
  diasAvisoProporcional,
  somarMesesData,
  validarEntradaRescisao,
  type DpRescisaoEntrada,
} from "@/lib/dp/folha/rescisao";

const P = PARAMETROS_PADRAO;
const quase = (a: number, b: number, msg?: string) => assert.ok(Math.abs(a - b) <= 0.011, `${msg ?? ""} ${a} ≠ ${b}`);
const valor = (r: ReturnType<typeof calcularRescisao>, chave: string) => r.verbas.find((v) => v.chave === chave)?.valor ?? 0;

const base: DpRescisaoEntrada = {
  tipo: "sem_justa_causa",
  aviso: "indenizado",
  contrato: "clt",
  salario: 3000,
  admissao: "2023-03-01",
  desligamento: "2026-10-15",
  fimContrato: null,
  dependentesIr: 0,
  semInss: false,
  saldoNaFolha: false,
  diasSaldo: null,
  diasFeriasVencidas: 0,
  primeira13Paga: 0,
  saldoFgts: 10000,
  outrosProventos: 0,
  outrosDescontos: 0,
  descontarArt480: false,
};

test("datas: aniversário, 29/02, aviso proporcional com teto de 90", () => {
  assert.equal(somarMesesData("2024-01-31", 1), "2024-02-29");
  assert.equal(anosCompletos("2024-02-29", "2025-02-28"), 1);
  assert.equal(anosCompletos("2023-03-01", "2026-02-28"), 2);
  assert.equal(anosCompletos("2023-03-01", "2026-03-01"), 3);
  assert.equal(diasAvisoProporcional("2023-03-01", "2026-10-15"), 39);
  assert.equal(diasAvisoProporcional("2026-01-05", "2026-10-15"), 30);
  assert.equal(diasAvisoProporcional("2000-01-01", "2026-10-15"), 90);
});

test("férias proporcionais: mês do período aquisitivo e fração acima de 14 dias", () => {
  assert.deepEqual(avosFeriasProporcionais("2026-02-10", "2026-09-20"), { avos: 7, inicioPeriodo: "2026-02-10" }); // 11 dias sobram
  assert.deepEqual(avosFeriasProporcionais("2026-09-01", "2026-10-15"), { avos: 2, inicioPeriodo: "2026-09-01" }); // 15 dias sobram
  assert.deepEqual(avosFeriasProporcionais("2023-03-01", "2026-11-23"), { avos: 9, inicioPeriodo: "2026-03-01" });
});

test("sem justa causa, aviso indenizado: projeção rende avo de 13º e de férias, multa 40%", () => {
  const r = calcularRescisao(base, P);
  assert.equal(r.anosCompletos, 3);
  assert.equal(r.avisoIndenizadoDias, 39);
  assert.equal(r.dataProjetada, "2026-11-23");
  assert.equal(valor(r, "saldo"), 1500);
  assert.equal(valor(r, "inss_saldo"), 112.5);
  assert.equal(valor(r, "irrf_saldo"), 0);
  assert.equal(valor(r, "aviso"), 3900);
  assert.equal(valor(r, "13"), 2500); // 10 avos: outubro tem 15 dias
  assert.equal(valor(r, "13_aviso"), 250); // novembro pela projeção
  quase(valor(r, "inss_13"), 223.19, "inss 13");
  assert.equal(valor(r, "ferias_prop"), 2250); // 9/12
  assert.equal(valor(r, "terco_prop"), 750);
  assert.equal(r.proventos, 11150);
  quase(r.liquido, 11150 - 112.5 - 223.19, "líquido");
  assert.equal(r.fgtsMes, 652); // 8% × (1.500 + 3.900 + 2.750)
  assert.equal(r.multa, 4260.8); // 40% × (10.000 + 652)
  assert.equal(r.saldoFgtsEstimado, false);
  assert.equal(r.prazoPagamento, "2026-10-25");
  // Aviso indenizado: FGTS sim, INSS e IRRF não
  assert.deepEqual(r.verbas.find((v) => v.chave === "aviso")?.incide, { inss: false, irrf: false, fgts: true });
});

test("saldo pago na folha: aparece para conferência e não entra no total nem no FGTS do mês", () => {
  const r = calcularRescisao({ ...base, saldoNaFolha: true }, P);
  assert.equal(r.verbas.find((v) => v.chave === "saldo")?.natureza, "informativo");
  assert.equal(r.proventos, 11150 - 1500);
  assert.equal(r.verbas.some((v) => v.chave === "inss_saldo"), false);
  assert.equal(r.fgtsMes, 532); // 8% × (3.900 + 2.750)
  assert.equal(r.multa, 4260.8); // a base da multa leva o FGTS do saldo pago na folha: 10.000 + 532 + 120
});

test("aviso trabalhado: 30 dias cumpridos, os 9 proporcionais são indenizados", () => {
  const r = calcularRescisao({ ...base, aviso: "trabalhado" }, P);
  assert.equal(r.avisoIndenizadoDias, 9);
  assert.equal(valor(r, "aviso"), 900);
  assert.equal(r.dataProjetada, "2026-10-24");
});

test("pedido de demissão sem cumprir o aviso: desconta 30 dias; férias proporcionais mesmo com menos de 1 ano", () => {
  const r = calcularRescisao(
    { ...base, tipo: "pedido_demissao", aviso: "descontado", salario: 2000, admissao: "2026-02-10", desligamento: "2026-09-20", saldoNaFolha: true },
    P,
  );
  assert.equal(r.avisoIndenizadoDias, 0);
  assert.equal(valor(r, "aviso_desc"), 2000);
  assert.equal(valor(r, "13"), 1333.33); // 8 avos: fevereiro tem 19 dias, setembro 20
  assert.equal(valor(r, "ferias_prop"), 1166.67); // 7/12
  assert.equal(valor(r, "terco_prop"), 388.89);
  assert.equal(r.multa, 0);
  assert.equal(r.fgtsMes, 106.67);
});

test("justa causa: só saldo e férias vencidas + 1/3", () => {
  const r = calcularRescisao({ ...base, tipo: "justa_causa", aviso: "nao_se_aplica", diasFeriasVencidas: 30 }, P);
  assert.deepEqual(
    r.verbas.filter((v) => v.natureza === "provento").map((v) => v.chave),
    ["saldo", "ferias_venc", "terco_venc"],
  );
  assert.equal(valor(r, "ferias_venc"), 3000);
  assert.equal(valor(r, "terco_venc"), 1000);
  assert.equal(r.multa, 0);
});

test("acordo (484-A): metade do aviso e multa de 20%", () => {
  const r = calcularRescisao({ ...base, tipo: "acordo" }, P);
  assert.equal(valor(r, "aviso"), 1950);
  assert.equal(r.multaPercentual, 0.2);
  assert.equal(r.dataProjetada, "2026-11-23");
});

test("término da experiência: sem aviso e sem multa", () => {
  const r = calcularRescisao(
    { ...base, tipo: "termino_contrato", aviso: "nao_se_aplica", salario: 1800, admissao: "2026-09-01", desligamento: "2026-10-15" },
    P,
  );
  assert.equal(valor(r, "aviso"), 0);
  assert.equal(valor(r, "13"), 300); // setembro + 15 dias de outubro
  assert.equal(valor(r, "ferias_prop"), 300);
  assert.equal(r.multa, 0);
});

test("contrato a prazo encerrado antes pela empresa: art. 479 = metade dos dias que faltavam", () => {
  const r = calcularRescisao(
    { ...base, tipo: "antecipada_empregador", aviso: "nao_se_aplica", admissao: "2026-09-01", desligamento: "2026-09-30", fimContrato: "2026-10-15", saldoFgts: null },
    P,
  );
  assert.equal(valor(r, "art479"), 750); // 15 dias ÷ 2
  assert.equal(r.multaPercentual, 0.4);
  assert.equal(r.saldoFgtsEstimado, true);
  // Pelo empregado: só desconta se marcado
  const e = calcularRescisao({ ...base, tipo: "antecipada_empregado", aviso: "nao_se_aplica", admissao: "2026-09-01", desligamento: "2026-09-30", fimContrato: "2026-10-15" }, P);
  assert.equal(valor(e, "art480"), 0);
  assert.match(e.avisos.join(" "), /art\. 480/);
});

test("projeção que atravessa o ano soma o avo de janeiro do ano seguinte", () => {
  const r = calcularRescisao({ ...base, admissao: "2021-06-01", desligamento: "2026-12-10" }, P);
  assert.equal(r.avisoIndenizadoDias, 45);
  assert.equal(r.dataProjetada, "2027-01-24");
  assert.equal(r.avos13, 13); // 11 até o desligamento (dez/2026 tem 10 dias) + dez e jan pela projeção
  assert.equal(valor(r, "13_aviso"), 500);
});

test("1ª parcela do 13º já paga entra como desconto", () => {
  const r = calcularRescisao({ ...base, primeira13Paga: 1200 }, P);
  assert.equal(valor(r, "13_adiant"), 1200);
});

test("estágio: saldo e recesso proporcional, sem 1/3, sem 13º e sem FGTS", () => {
  const r = calcularRescisao({ ...base, contrato: "estagio", tipo: "termino_contrato", aviso: "nao_se_aplica", admissao: "2026-02-10", desligamento: "2026-09-20" }, P);
  assert.equal(valor(r, "13"), 0);
  assert.equal(valor(r, "terco_prop"), 0);
  assert.ok(valor(r, "ferias_prop") > 0);
  assert.equal(r.fgtsMes, 0);
  assert.equal(r.verbas.some((v) => v.chave === "inss_saldo"), false);
});

test("PJ e sócio não têm rescisão trabalhista; entrada inválida é recusada", () => {
  assert.throws(() => calcularRescisao({ ...base, contrato: "prestador" }, P), /PJ/);
  assert.throws(() => validarEntradaRescisao({ ...base, desligamento: "15/10/2026" }), /data inválida/);
  assert.throws(() => validarEntradaRescisao({ ...base, admissao: "2027-01-01" }), /anterior à admissão/);
  // aviso que não cabe no tipo cai no 1º possível
  assert.equal(validarEntradaRescisao({ ...base, tipo: "justa_causa", aviso: "indenizado" }).aviso, "nao_se_aplica");
});
