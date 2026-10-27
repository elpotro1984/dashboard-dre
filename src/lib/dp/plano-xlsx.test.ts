import assert from "node:assert/strict";
import { test } from "node:test";

import * as XLSX from "xlsx";

import { CABECALHO_PLANO, planilhaDoPlano, type LinhaDoPlano } from "@/lib/dp/plano-xlsx";
import { parseTabelaPlanilha, planejarImportacao } from "@/lib/dp/tabela-salarial";

const plano: LinhaDoPlano[] = [
  { setor: "Comercial", cargo: "Analista de Relacionamento", senioridade: "Júnior", step: "I", salario: 3500.5, centroCusto: "001 · Comercial", pessoas: 3 },
  { setor: "Comercial", cargo: "Assistente de Relacionamento", senioridade: "", step: "II", salario: 2800, centroCusto: "", pessoas: 0 },
  { setor: "", cargo: "Estagiário(a)", senioridade: "", step: "", salario: 1500, centroCusto: "", pessoas: 1 },
];

function abrir(buffer: Buffer) {
  // cellNF: traz o formato numérico gravado em cada célula (sem ele, `z` vem vazio na leitura).
  const wb = XLSX.read(buffer, { type: "buffer", cellNF: true });
  return { wb, linhas: XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[wb.SheetNames[0]], { header: 1, defval: "" }) };
}

test("o plano sai como está na tela: todas as colunas, na ordem da tabela", () => {
  const { buffer, vazia } = planilhaDoPlano(plano);
  assert.equal(vazia, false);
  const { wb, linhas } = abrir(buffer);
  assert.deepEqual(wb.SheetNames, ["Plano de cargos e salários", "Como preencher"]);
  assert.deepEqual(linhas[0], [...CABECALHO_PLANO]);
  assert.deepEqual(linhas[1], ["Comercial", "Analista de Relacionamento", "Júnior", "I", 3500.5, "001 · Comercial", 3]);
  assert.deepEqual(linhas[3], ["", "Estagiário(a)", "", "", 1500, "", 1]);
  // Salário é número formatado, não texto: soma no Excel.
  const cel = wb.Sheets[wb.SheetNames[0]].E2;
  assert.equal(cel.t, "n");
  assert.equal(cel.z, "#,##0.00");
});

test("baixar e reimportar o plano não muda nada (Centro de custo e Pessoas são ignorados)", () => {
  const { linhas } = abrir(planilhaDoPlano(plano).buffer);
  const lido = parseTabelaPlanilha(linhas);
  assert.ok("ok" in lido);
  if (!("ok" in lido)) return;
  assert.deepEqual(lido.ok.problemas, []);
  const existentes = plano.map((l, i) => ({ id: `l${i}`, setor: l.setor, cargo: l.cargo, senioridade: l.senioridade, step: l.step, salario: l.salario }));
  const p = planejarImportacao(lido.ok.linhas, existentes);
  assert.deepEqual({ inserir: p.inserir.length, atualizar: p.atualizar.length, iguais: p.iguais, fora: p.foraDaPlanilha }, { inserir: 0, atualizar: 0, iguais: 3, fora: 0 });
});

test("linha antiga, ainda com tudo no nome, sai separada", () => {
  const { linhas } = abrir(planilhaDoPlano([{ ...plano[0], cargo: "Consultor PLENO II", senioridade: "", step: "" }]).buffer);
  assert.deepEqual(linhas[1].slice(0, 4), ["Comercial", "Consultor", "Pleno", "II"]);
});

test("sem plano: sai o ponto de partida com os cargos da Sólides, já separados e sem salário", () => {
  const { buffer, vazia } = planilhaDoPlano([], [{ cargo: "Analista de Relacionamento JÚNIOR I", departamento: "COMERCIAL - VIVA BH" }]);
  assert.equal(vazia, true);
  const { wb, linhas } = abrir(buffer);
  assert.equal(wb.SheetNames[0], "Cargos da Sólides");
  assert.deepEqual(linhas[1], ["COMERCIAL", "Analista de Relacionamento", "Júnior", "I", "", "", ""]);
});
