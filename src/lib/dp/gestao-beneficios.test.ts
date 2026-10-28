import assert from "node:assert/strict";
import { test } from "node:test";

import { BENEFICIOS_COLABORADOR_VAZIO, type DpBeneficiosColaborador } from "@/lib/dp/beneficios-colaborador";
import type { DpBeneficiosDados } from "@/lib/dp/beneficios-config";
import {
  aplicarDias,
  beneficiosDoMes,
  colunasCadastradas,
  colunasComValorGestao,
  diasDoMes,
  regraDoBeneficio,
  resumirGestao,
  totalDasCelulas,
  type DpLinhaGestao,
} from "@/lib/dp/gestao-beneficios";

// Novembro/2026, seg–sex: 21 dias de semana − Finados (seg 02) − Consciência Negra (sex 20) = 19.
const NOV = "2026-11";
const ESCALA = { nome: "5 dias", diasSemana: 5 as const, feriados: [] };

const CFG = (regraVa: "diario" | "fixo" = "diario"): DpBeneficiosDados => ({
  alimentacao: { regra: regraVa, faixas: [{ id: "va", nome: "Faixa 1", valor: regraVa === "diario" ? 20 : 450 }] },
  transporte: { descontar6: true, bilhetes: [{ id: "vt", nome: "Bilhete BH", valor: 11 }] },
  gasolina: { faixas: [{ id: "g", de: 0, ate: null, valor: 300 }] },
  carona: { faixas: [{ id: "c", de: 0, ate: null, valor: 95 }] },
  home_office: { porDias: [{ id: "h", dias: 2, valor: 60 }] },
  sesi: { modalidades: [{ id: "s", nome: "Individual", valor: 45 }] },
  salario_familia: { cota: 67.54, limite: 1980.38, vigencia: null, fonte: null },
  assiduidade: { valor: 100 },
});

const TUDO: DpBeneficiosColaborador = {
  ...BENEFICIOS_COLABORADOR_VAZIO,
  alimentacao: { id: "va", nome: "Faixa 1" },
  transporte: { id: "vt", nome: "Bilhete BH" },
  gasolina: { id: "g", nome: "" },
  carona: { id: "c", nome: "" },
  homeOfficeDias: 2,
  sesi: { id: "s", nome: "Individual" },
  assiduidade: true,
};
const PESSOA = { tipoContrato: "CLT", salario: 1800, dependentes: [] };

/** O toLocaleString põe espaço não separável entre "R$" e o número. */
const sp = <T,>(v: T): T => JSON.parse(JSON.stringify(v).replace(/ /g, " "));

const dias = (o: Partial<Parameters<typeof diasDoMes>[0]> = {}) =>
  diasDoMes({ competencia: NOV, admissao: "2020-01-01", desligamento: null, ferias: [], escala: ESCALA, ...o });

test("dias: mês cheio = os dias úteis do calendário de trabalho", () => {
  const d = dias();
  assert.deepEqual([d.uteisMes, d.uteisVinculo, d.trabalhados], [19, 19, 19]);
  assert.equal(d.admissaoNoMes, null);
  assert.equal(diasDoMes({ competencia: NOV, admissao: null, desligamento: null, ferias: [], escala: { ...ESCALA, diasSemana: 6 } }).uteisMes, 23, "seg–sáb soma os 4 sábados");
  assert.equal(dias({ escala: { ...ESCALA, feriados: ["2026-11-10"] } }).uteisMes, 18, "feriado da escala sai");
  assert.match(dias({ escala: null }).memoria[0], /não está nos Parâmetros/);
});

test("dias: admissão recente ou futura dentro do mês conta só dali em diante", () => {
  const d = dias({ admissao: "2026-11-16" });
  // 16–19 (o 20 é feriado), 23–27 e 30.
  assert.deepEqual([d.uteisVinculo, d.trabalhados], [10, 10]);
  assert.equal(d.admissaoNoMes, "2026-11-16");
  assert.match(d.memoria.join(" "), /Admissão em 16\/11\/2026: 10 dias úteis/);
  assert.equal(dias({ admissao: "2026-11-01" }).admissaoNoMes, null, "admitido no dia 1 tem o mês cheio");
  assert.equal(dias({ desligamento: "2026-11-06" }).uteisVinculo, 4, "desligamento: até ele (03–06)");
});

test("dias: férias verdadeiras tiram dias; FK marcado não tira", () => {
  const d = dias({ ferias: [{ inicio: "2026-11-03", fim: "2026-11-12", fk: false }] });
  assert.deepEqual([d.uteisFerias, d.trabalhados], [8, 11]);
  assert.equal(d.temFerias, true);
  const fk = dias({ ferias: [{ inicio: "2026-11-03", fim: "2026-11-12", fk: true }] });
  assert.deepEqual([fk.uteisFerias, fk.trabalhados, fk.temFeriasFk], [0, 19, true]);
  assert.match(fk.memoria.join(" "), /marcadas FK: não tiram dias/);
  // Atravessando a virada: só a parte de novembro (03 e 04; o 02 é feriado).
  const virada = dias({ ferias: [{ inicio: "2026-10-26", fim: "2026-11-04", fk: false }] });
  assert.deepEqual([virada.uteisFerias, virada.trabalhados], [2, 17]);
  assert.match(virada.memoria.join(" "), /só a parte deste mês/);
});

test("dias: férias antes da admissão não tiram o que já não contava", () => {
  const d = dias({ admissao: "2026-11-16", ferias: [{ inicio: "2026-11-03", fim: "2026-11-20", fk: false }] });
  // Vínculo 16–30 = 10; férias dentro do vínculo: 16–19 = 4.
  assert.deepEqual([d.uteisVinculo, d.uteisFerias, d.trabalhados], [10, 4, 6]);
});

test("regra de cada benefício: por dia, proporcional aos trabalhados ou ao vínculo", () => {
  assert.equal(regraDoBeneficio("transporte", "dia"), "por_dia");
  assert.equal(regraDoBeneficio("alimentacao", "dia"), "por_dia");
  assert.equal(regraDoBeneficio("alimentacao", "mes"), "vinculo");
  assert.equal(regraDoBeneficio("gasolina", "mes"), "trabalhados");
  assert.equal(regraDoBeneficio("carona", "mes"), "trabalhados");
  for (const b of ["sesi", "home_office", "assiduidade", "salario_familia", "separado"] as const) assert.equal(regraDoBeneficio(b, "mes"), "vinculo");
  assert.deepEqual(sp(aplicarDias(300, "trabalhados", { uteisMes: 19, uteisVinculo: 19, trabalhados: 19 })), { valor: 300, conta: "R$ 300,00 no mês" });
  assert.deepEqual(sp(aplicarDias(300, "trabalhados", { uteisMes: 19, uteisVinculo: 19, trabalhados: 11 })), {
    valor: 173.68,
    conta: "R$ 300,00 × 11/19 dias úteis",
  });
});

test("FÉRIAS: reduzem VT, gasolina, carona e o VA por dia — o resto vem cheio", () => {
  const d = dias({ ferias: [{ inicio: "2026-11-03", fim: "2026-11-12", fk: false }] }); // 11 trabalhados
  const c = beneficiosDoMes({ cfg: CFG("diario"), escolhas: TUDO, pessoa: PESSOA, dias: d, competencia: NOV });
  assert.equal(c.transporte.valor, 121, "R$ 11 × 11");
  assert.equal(c.alimentacao.valor, 220, "VA diário: R$ 20 × 11");
  assert.equal(c.gasolina.valor, 173.68);
  assert.equal(c.carona.valor, 55, "95 × 11/19");
  assert.equal(c.sesi.valor, 45, "SESI não muda com férias");
  assert.equal(c.home_office.valor, 60);
  assert.equal(c.assiduidade.valor, 100);
  const fixo = beneficiosDoMes({ cfg: CFG("fixo"), escolhas: TUDO, pessoa: PESSOA, dias: d, competencia: NOV });
  assert.equal(fixo.alimentacao.valor, 450, "VA fixo no mês não muda com férias");
});

test("ADMISSÃO: reduz tudo, inclusive o que é mensal", () => {
  const d = dias({ admissao: "2026-11-16" }); // 10 de 19
  const c = beneficiosDoMes({ cfg: CFG("fixo"), escolhas: TUDO, pessoa: PESSOA, dias: d, competencia: NOV });
  assert.equal(c.transporte.valor, 110);
  assert.equal(c.gasolina.valor, 157.89, "300 × 10/19");
  assert.equal(c.alimentacao.valor, 236.84, "VA fixo: 450 × 10/19");
  assert.equal(c.sesi.valor, 23.68, "45 × 10/19");
  assert.equal(c.assiduidade.valor, 52.63);
  assert.equal(sp(c.home_office.itens[0].conta), "R$ 60,00 × 10/19 dias úteis");
});

test("outros benefícios: seguem a regra do benefício em que somam; o Separado vai para Outros", () => {
  const d = dias({ ferias: [{ inicio: "2026-11-03", fim: "2026-11-12", fk: false }] }); // 11 trabalhados
  const c = beneficiosDoMes({
    cfg: CFG(),
    escolhas: {
      ...BENEFICIOS_COLABORADOR_VAZIO,
      transporte: { id: "vt", nome: "Bilhete BH" },
      outros: [
        { id: "1", rotulo: "Integração metrô", valor: 4, destino: "transporte" },
        { id: "2", rotulo: "Bônus SESI", valor: 10, destino: "sesi" },
        { id: "3", rotulo: "Auxílio creche", valor: 300, destino: "separado" },
      ],
    },
    pessoa: PESSOA,
    dias: d,
    competencia: NOV,
  });
  assert.equal(c.transporte.valor, 165, "(11 + 4) × 11 dias");
  assert.deepEqual(
    c.transporte.itens.map((i) => [i.rotulo, i.origem, i.valor]),
    [
      ["Bilhete BH", "cadastro da empresa", 121],
      ["Integração metrô", "outro benefício", 44],
    ],
  );
  assert.equal(c.sesi.valor, 10, "só o outro, cheio: férias não reduzem o SESI");
  assert.equal(c.outros.valor, 300, "separado: regra do vínculo — férias não reduzem");
  assert.equal(c.outros.itens[0].rotulo, "Auxílio creche");
  const admitido = beneficiosDoMes({
    cfg: CFG(),
    escolhas: { ...BENEFICIOS_COLABORADOR_VAZIO, outros: [{ id: "3", rotulo: "Auxílio creche", valor: 300, destino: "separado" }] },
    pessoa: PESSOA,
    dias: dias({ admissao: "2026-11-16" }),
    competencia: NOV,
  });
  assert.equal(admitido.outros.valor, 157.89, "na admissão, até o separado é proporcional");
});

test("salário-família: pelas regras do card, proporcional na admissão; o aviso só acende com filho", () => {
  const comFilho = { ...BENEFICIOS_COLABORADOR_VAZIO, filhos: [{ id: "f", nome: "Ana", nascimento: "2018-05-05", invalido: false }] };
  const cheio = beneficiosDoMes({ cfg: CFG(), escolhas: comFilho, pessoa: PESSOA, dias: dias(), competencia: NOV });
  assert.equal(cheio.salario_familia.valor, 67.54);
  assert.equal(beneficiosDoMes({ cfg: CFG(), escolhas: comFilho, pessoa: PESSOA, dias: dias({ admissao: "2026-11-16" }), competencia: NOV }).salario_familia.valor, 35.55);
  const semTipoSemFilho = beneficiosDoMes({ cfg: CFG(), escolhas: BENEFICIOS_COLABORADOR_VAZIO, pessoa: { ...PESSOA, tipoContrato: null }, dias: dias(), competencia: NOV });
  assert.deepEqual(semTipoSemFilho.salario_familia.avisos, []);
});

test("cards e colunas: somam o que está na tela; coluna só com valor (ou aviso) na empresa", () => {
  const linha = (nome: string, escolhas: DpBeneficiosColaborador): DpLinhaGestao => {
    const d = dias();
    const celulas = beneficiosDoMes({ cfg: CFG(), escolhas, pessoa: PESSOA, dias: d, competencia: NOV });
    return { solidesId: nome.length, colaboradorId: nome, nome, setor: null, dias: d, celulas, total: totalDasCelulas(celulas), semCadastro: false, avisos: [] };
  };
  const a = linha("A", TUDO);
  const b = linha("B", { ...BENEFICIOS_COLABORADOR_VAZIO, transporte: { id: "vt", nome: "" } });
  const r = resumirGestao([a, b]);
  assert.equal(r.alimentacao, 380, "VA diário 20 × 19");
  assert.equal(r.mobilidade, r.total - r.alimentacao - r.demais);
  assert.equal(r.mobilidade, 209 + 300 + 95 + 209);
  assert.equal(r.demais, 60 + 45 + 100);
  assert.equal(r.comBeneficio, 2);
  assert.deepEqual(colunasComValorGestao([b]), ["transporte"]);
  // A empresa com todos os benefícios cadastrados mostra todas as colunas, mesmo zeradas — menos Outros, que não tem cadastro.
  assert.deepEqual(colunasCadastradas(CFG()), ["alimentacao", "gasolina", "carona", "transporte", "sesi", "assiduidade", "home_office", "salario_familia"]);
  assert.deepEqual(colunasComValorGestao([b], ["sesi"]), ["transporte", "sesi"], "cadastrada aparece zerada; ordem da tabela");
});
