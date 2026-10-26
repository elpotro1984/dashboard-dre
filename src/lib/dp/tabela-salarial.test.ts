import assert from "node:assert/strict";
import { test } from "node:test";

import {
  lerPercentual,
  lerSalario,
  ordemEntre,
  parseTabelaPlanilha,
  planejarCopia,
  planejarImportacao,
  previaReajuste,
  reajustar,
} from "@/lib/dp/tabela-salarial";

/** Linha de tabela sem senioridade nem step, para os testes que não tratam disso. */
const l = (setor: string, cargo: string, salario: number, extra: { senioridade?: string; step?: string } = {}) => ({
  setor,
  cargo,
  senioridade: extra.senioridade ?? "",
  step: extra.step ?? "",
  salario,
});

test("lerSalario: número do Excel, texto BR e texto com ponto decimal", () => {
  assert.equal(lerSalario(3500), 3500);
  assert.equal(lerSalario("R$ 3.500,00"), 3500);
  assert.equal(lerSalario("3500,5"), 3500.5);
  assert.equal(lerSalario("3500.50"), 3500.5);
  assert.equal(lerSalario(""), null);
  assert.equal(lerSalario("a combinar"), null);
});

const partes = (r: ReturnType<typeof parseTabelaPlanilha>) => {
  assert.ok("ok" in r);
  return "ok" in r ? r.ok.linhas.map((x) => [x.linha, x.setor, x.cargo, x.senioridade, x.step, x.salario]) : [];
};

test("parse: o modelo novo, com as cinco colunas — o cargo é lido como está", () => {
  const r = parseTabelaPlanilha([
    ["Tabela salarial — Spot"],
    [],
    ["Salário", "Step", "Senioridade", "Cargo", "Setor"],
    [4000, "I", "Júnior", "Analista de Relacionamento", "Comercial"],
    ["", "", "", "", ""],
    ["R$ 2.500,00", "", "", "Técnico em Raio X", "Operacional"],
    [5000, "2", "pleno", "Analista de Relacionamento", "Comercial"],
  ]);
  assert.deepEqual(partes(r), [
    [4, "Comercial", "Analista de Relacionamento", "Júnior", "I", 4000],
    [6, "Operacional", "Técnico em Raio X", "", "", 2500], // o X não vira step
    [7, "Comercial", "Analista de Relacionamento", "Pleno", "II", 5000],
  ]);
  assert.ok("ok" in r && r.ok.problemas.length === 0);
});

test("parse: planilha antiga, só com Cargo — senioridade e step saem do nome", () => {
  const r = parseTabelaPlanilha([
    ["Setor", "Cargo", "Salário"],
    ["Comercial", "Analista de Relacionamento JÚNIOR I", 4000],
    ["Comercial", "Assistente de Relacionamento I", 3000],
    ["Adm", "Estagiário(a)", 1500],
  ]);
  assert.deepEqual(partes(r), [
    [2, "Comercial", "Analista de Relacionamento", "Júnior", "I", 4000],
    [3, "Comercial", "Assistente de Relacionamento", "", "I", 3000],
    [4, "Adm", "Estagiário(a)", "", "", 1500],
  ]);
});

test("parse: planilha de 02/10 com coluna Step em número — vira romano; step sem cargo é linha sem cargo", () => {
  const r = parseTabelaPlanilha([
    ["Setor", "Cargo", "Step", "Salário"],
    ["Adm", "Auxiliar Administrativo", "1", 2000],
    ["Adm", "Auxiliar Administrativo", 2, 2200],
    ["Adm", "Motorista", "", 2500],
    ["Adm", "", "3", 2400],
    ["Adm", "Analista PLENO", "1", 4000], // sem coluna Senioridade: ela sai do nome
    ["Adm", "Analista", "A", 4000],
  ]);
  assert.deepEqual(partes(r), [
    [2, "Adm", "Auxiliar Administrativo", "", "I", 2000],
    [3, "Adm", "Auxiliar Administrativo", "", "II", 2200],
    [4, "Adm", "Motorista", "", "", 2500],
    [6, "Adm", "Analista", "Pleno", "I", 4000],
  ]);
  assert.ok("ok" in r);
  if (!("ok" in r)) return;
  assert.equal(r.ok.problemas[0], "Linha 5: sem cargo.");
  assert.match(r.ok.problemas[1], /^Linha 7 \(Analista\): Step "A" não é um algarismo romano/);
});

test("parse: a mesma linha escrita nos dois formatos é repetida", () => {
  const r = parseTabelaPlanilha([
    ["Setor", "Cargo", "Step", "Salário"],
    ["Adm", "Analista Júnior", "I", 4000],
    ["adm", "ANALISTA JUNIOR", "1", 4100],
  ]);
  assert.ok("ok" in r);
  if (!("ok" in r)) return;
  assert.equal(r.ok.linhas.length, 1);
  assert.match(r.ok.problemas[0], /repete a linha 2/);
});

test("parse: falha por LINHA, nunca pelo arquivo", () => {
  const r = parseTabelaPlanilha([
    ["Setor", "Cargo", "Salário"],
    ["TI", "", 3000],
    ["TI", "Dev 1", ""],
    ["TI", "Dev 1", 3000],
    ["ti", "DEV 1", 3200],
  ]);
  assert.ok("ok" in r);
  if (!("ok" in r)) return;
  assert.equal(r.ok.linhas.length, 1);
  assert.equal(r.ok.problemas.length, 3);
  assert.match(r.ok.problemas[2], /repete a linha 4/);
});

test("parse: sem Cargo/Salário no cabeçalho é erro do arquivo", () => {
  // "Valor" é aceito como Salário, mas falta Cargo.
  assert.ok("erro" in parseTabelaPlanilha([["Nome", "Valor"]]));
  assert.ok("erro" in parseTabelaPlanilha([["Setor", "Cargo"]]));
  assert.ok("ok" in parseTabelaPlanilha([["Função", "Valor"]]));
});

test("importação: atualiza, insere e MANTÉM o que ficou fora da planilha", () => {
  const plano = planejarImportacao(
    [
      { linha: 2, ...l("Comercial", "Analista", 4200, { step: "I" }) },
      { linha: 3, ...l("Comercial", "Analista", 5000, { step: "II" }) },
      { linha: 4, ...l("comercial", "ANALISTA", 6000, { step: "III" }) },
      // Mesma linha que a "d" abaixo, que ainda está com tudo no nome: atualiza, não duplica.
      { linha: 5, ...l("Comercial", "Consultor", 8000, { senioridade: "Pleno", step: "II" }) },
    ],
    [
      { id: "a", ...l("Comercial", "Analista", 4000, { step: "I" }) },
      { id: "b", ...l("Comercial", "Analista", 5000, { step: "II" }) },
      { id: "c", ...l("TI", "Dev", 7000) },
      { id: "d", ...l("Comercial", "Consultor PLENO II", 7500) },
    ],
  );
  assert.deepEqual(plano.atualizar, [
    { id: "a", salario: 4200, de: 4000 },
    { id: "d", salario: 8000, de: 7500 },
  ]);
  assert.deepEqual(plano.inserir.map((x) => [x.cargo, x.step]), [["ANALISTA", "III"]]);
  assert.equal(plano.iguais, 1);
  assert.equal(plano.foraDaPlanilha, 1);
});

test("cópia de outra empresa: insere o novo, não apaga nada e só troca salário quando pedido", () => {
  const origem = [
    { ...l("Comercial", "Analista", 4200, { step: "I" }), centroNome: "Comercial" },
    { ...l("Comercial", "Analista", 5000, { step: "II" }), centroNome: null },
    { ...l("Financeiro", "Assistente", 3000, { senioridade: "Júnior", step: "I" }), centroNome: "ADM" },
    { ...l("Financeiro", "Assistente", 3300, { senioridade: "Júnior", step: "II" }), centroNome: "comercial" },
  ];
  const existentes = [
    { id: "a", ...l("comercial", "ANALISTA", 4000, { step: "I" }) }, // mesmo cargo, salário diferente
    { id: "b", ...l("Comercial", "Analista", 5000, { step: "II" }) }, // igual
    { id: "c", ...l("TI", "Dev", 7000) }, // só existe aqui
  ];
  const centros = [{ id: "cc-1", nome: "Comercial" }];
  const sem = planejarCopia(origem, existentes, centros, false);
  assert.deepEqual(sem.atualizar, []); // sem pedir, o salário daqui fica
  assert.equal(sem.diferentes, 1);
  assert.equal(sem.iguais, 1);
  assert.equal(sem.soNoDestino, 1);
  assert.deepEqual(
    sem.inserir,
    [
      { setor: "Financeiro", cargo: "Assistente", senioridade: "Júnior", step: "I", salario: 3000, centroCustoId: null }, // "ADM" não existe aqui
      { setor: "Financeiro", cargo: "Assistente", senioridade: "Júnior", step: "II", salario: 3300, centroCustoId: "cc-1" }, // casa sem caixa/acento
    ],
  );
  assert.equal(sem.comCentro, 1);
  assert.deepEqual(sem.centrosSemPar, ["ADM"]);
  const com = planejarCopia(origem, existentes, centros, true);
  assert.deepEqual(com.atualizar, [{ id: "a", salario: 4200, de: 4000 }]);
  // Destino vazio: copia tudo
  assert.equal(planejarCopia(origem, [], [], false).inserir.length, 4);
});

test("reajuste: >= 0, teto de sanidade e arredondamento igual ao do banco", () => {
  assert.deepEqual(lerPercentual("5,5"), { ok: 5.5 });
  assert.deepEqual(lerPercentual("0"), { ok: 0 });
  assert.ok("erro" in lerPercentual("-2"));
  assert.ok("erro" in lerPercentual(""));
  assert.ok("erro" in lerPercentual("150"));
  assert.equal(reajustar(3333.33, 5), 3500);
  assert.deepEqual(previaReajuste([1000, 2000], 10), { linhas: 2, antes: 3000, depois: 3300 });
});

test("ordemEntre: pontas e meio", () => {
  assert.equal(ordemEntre(null, null), 1);
  assert.equal(ordemEntre(3, null), 4);
  assert.equal(ordemEntre(null, 3), 2);
  assert.equal(ordemEntre(1, 2), 1.5);
});
