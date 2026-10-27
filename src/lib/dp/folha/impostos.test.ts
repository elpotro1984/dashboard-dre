import assert from "node:assert/strict";
import { test } from "node:test";

import { baseDe, linhasDoImposto, patronalPorPessoa, resumirImpostos } from "@/lib/dp/folha/impostos";
import { CADASTRO_VAZIO, calcularFolhaPessoa, LANCAMENTO_PADRAO, type DpFolhaEntrada } from "@/lib/dp/folha/motor";
import { PARAMETROS_PADRAO as P } from "@/lib/dp/folha/parametros";
import { categoriasDaLinha } from "@/lib/dp/folha/totais";

const ENC = { inss_patronal: 20, rat_fap: 2, terceiros: 5.8, fgts: 8 };

function pessoa(id: number, nome: string, o: Partial<DpFolhaEntrada> = {}): DpFolhaEntrada {
  return {
    solidesId: id,
    nome,
    setor: "ADM",
    centroCusto: null,
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

const linhas = [
  pessoa(1, "Ana"),
  pessoa(2, "Bruno", { contrato: "estagio", salario: 1500 }),
  pessoa(3, "Carla", { salario: 2000, lancamento: { ...LANCAMENTO_PADRAO, situacao: "licenca_maternidade", ajustes: {} } }),
  pessoa(4, "Davi", { lancamento: { ...LANCAMENTO_PADRAO, ajustes: { irrf: { valor: 50, motivo: "valor da contabilidade" } } } }),
  pessoa(5, "Eva", { salario: 1500, cadastro: { ...CADASTRO_VAZIO, planoDependentes: [], salarioFamiliaCotas: 2 } }),
].map((e) => calcularFolhaPessoa(e, P, "2026-09"));

test("INSS: base salário + férias, só de quem recolhe; estágio fica de fora", () => {
  const inss = linhasDoImposto(linhas, "inss");
  assert.deepEqual(inss.map((l) => l.nome), ["Ana", "Carla", "Davi", "Eva"]);
  const ana = inss.find((l) => l.nome === "Ana")!;
  assert.equal(ana.base, 3000);
  assert.equal(ana.valor, 248.6);
  assert.equal(ana.ajustado, false);
  assert.match(ana.memoria, /Base/);
});

test("IRRF: estágio entra (a bolsa é tributável); ajuste manual mostra o valor e o calculado", () => {
  const irrf = linhasDoImposto(linhas, "irrf");
  assert.ok(irrf.some((l) => l.nome === "Bruno" && l.base === 1500));
  const davi = irrf.find((l) => l.nome === "Davi")!;
  assert.equal(davi.valor, 50);
  assert.equal(davi.calculado, 0);
  assert.equal(davi.ajustado, true);
  assert.match(davi.memoria, /Ajuste manual/);
});

test("salário-família: só quem tem cota", () => {
  const sf = linhasDoImposto(linhas, "salarioFamilia");
  assert.deepEqual(sf.map((l) => [l.nome, l.valor]), [["Eva", 135.08]]);
});

test("patronal: base × (20% + 2% + 5,8%); licença-maternidade e estágio não entram", () => {
  const pat = patronalPorPessoa(linhas, ENC);
  assert.deepEqual(pat.map((p) => p.nome), ["Ana", "Davi", "Eva"]);
  const ana = pat.find((p) => p.nome === "Ana")!;
  assert.deepEqual([ana.inssPatronal, ana.rat, ana.terceiros, ana.total], [600, 60, 174, 834]);
  assert.equal(pat.find((p) => p.nome === "Eva")!.total, 417);
  // Simples Nacional: nada patronal
  assert.equal(patronalPorPessoa(linhas, { inss_patronal: 0, rat_fap: 0, terceiros: 0, fgts: 8 }).every((p) => p.total === 0), true);
});

test("resumo: guia do INSS = a mesma regra dos Totais + o patronal; FGTS e IRRF somam as linhas", () => {
  const r = resumirImpostos(linhas, ENC);
  const empregados = Math.round(linhas.reduce((s, l) => s + categoriasDaLinha(l).inss, 0) * 100) / 100;
  assert.equal(r.inssEmpregadosGuia, empregados);
  assert.equal(r.patronal.total, 2085);
  assert.equal(r.inssGuia, Math.round((empregados + 2085) * 100) / 100);
  assert.equal(r.fgts, Math.round(linhas.reduce((s, l) => s + l.fgts, 0) * 100) / 100);
  assert.equal(r.irrf, 50); // só o ajuste do Davi: os salários deste teste ficam na faixa isenta
  assert.equal(r.comAjuste, 1);
  assert.ok(r.licenca > 0);
});

test("setor e centro de custo da folha chegam a toda linha de imposto (são colunas filtráveis na tela)", () => {
  const comCentro = [
    calcularFolhaPessoa(pessoa(6, "Fábio", { setor: "Comercial", centroCusto: "001 · Comercial" }), P, "2026-09"),
    linhas[0],
  ];
  for (const imposto of ["inss", "irrf", "fgts"] as const) {
    const [ana, fabio] = linhasDoImposto(comCentro, imposto);
    assert.deepEqual([fabio.setor, fabio.centroCusto], ["Comercial", "001 · Comercial"], imposto);
    assert.deepEqual([ana.setor, ana.centroCusto], ["ADM", null], imposto);
  }
  const [, fabio] = patronalPorPessoa(comCentro, ENC);
  assert.deepEqual([fabio.setor, fabio.centroCusto], ["Comercial", "001 · Comercial"]);
  // Retrato de folha fechada sem o campo: sem centro, nunca undefined.
  const antigo = { ...linhas[0], centroCusto: undefined as unknown as null };
  assert.equal(linhasDoImposto([antigo], "inss")[0].centroCusto, null);
});

test("folha fechada antes das bases: a base sai da conta equivalente", () => {
  const ana = { ...linhas[0], bases: undefined };
  assert.equal(baseDe(ana, "inss"), 3000);
  assert.equal(baseDe(ana, "fgts"), 3000);
  assert.equal(baseDe(ana, "patronal"), 3000);
});
