import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import {
  BENEFICIOS_VAZIOS,
  BLOCOS_BENEFICIO,
  erroDoPercentual,
  lerBloco,
  mesmoBloco,
  reajustarBloco,
  rotuloFaixa,
  sanearSalarioFamilia,
  validarBloco,
  valoresDoBloco,
} from "@/lib/dp/beneficios-config";

const ok = <T,>(r: { ok: T } | { erro: string }): T => {
  if ("erro" in r) throw new Error(r.erro);
  return r.ok;
};
const erro = (r: { ok: unknown } | { erro: string }) => ("erro" in r ? r.erro : null);

test("vale-alimentação: regra diária ou fixa, faixas com nome e valor", () => {
  const va = ok(validarBloco("alimentacao", { regra: "fixo", faixas: [{ id: "a", nome: " Operacional ", valor: "450.5" }] }));
  assert.deepEqual(va, { regra: "fixo", faixas: [{ id: "a", nome: "Operacional", valor: 450.5 }] });
  assert.equal(ok(validarBloco("alimentacao", { regra: "qualquer", faixas: [] })).regra, "diario", "regra desconhecida cai no diário");
  assert.match(erro(validarBloco("alimentacao", { faixas: [{ nome: "", valor: 10 }] })) ?? "", /dê um nome à faixa 1/);
  assert.match(erro(validarBloco("alimentacao", { faixas: [{ nome: "A", valor: 1 }, { nome: "a", valor: 2 }] })) ?? "", /aparece duas vezes/);
  assert.match(erro(validarBloco("alimentacao", { faixas: [{ nome: "A", valor: -1 }] })) ?? "", /valor inválido/);
  assert.match(erro(validarBloco("alimentacao", { faixas: [{ nome: "A" }] })) ?? "", /informe o valor/);
});

test("vale-transporte: desconto de 6% ligado por padrão (é a regra da lei); bilhetes com nome e valor", () => {
  assert.equal(BENEFICIOS_VAZIOS.transporte.descontar6, true);
  assert.equal(ok(validarBloco("transporte", {})).descontar6, true);
  const vt = ok(validarBloco("transporte", { descontar6: false, bilhetes: [{ id: "b", nome: "Bilhete BH", valor: 21 }] }));
  assert.deepEqual(vt, { descontar6: false, bilhetes: [{ id: "b", nome: "Bilhete BH", valor: 21 }] });
});

test("faixas de km e de dias: em ordem, sem sobreposição, só a última 'em diante'", () => {
  const g = ok(
    validarBloco("gasolina", {
      faixas: [
        { id: "2", de: 10.01, ate: 20, valor: 300 },
        { id: "1", de: 0, ate: 10, valor: 150 },
        { id: "3", de: 20.01, ate: null, valor: 450 },
      ],
    }),
  );
  assert.deepEqual(g.faixas.map((f) => f.id), ["1", "2", "3"], "ordena pelo início");
  assert.match(erro(validarBloco("carona", { faixas: [{ de: 0, ate: 10, valor: 1 }, { de: 10, ate: 20, valor: 2 }] })) ?? "", /se sobrepõem/);
  assert.match(erro(validarBloco("carona", { faixas: [{ de: 0, ate: null, valor: 1 }, { de: 10, ate: 20, valor: 2 }] })) ?? "", /só a última/);
  assert.match(erro(validarBloco("gasolina", { faixas: [{ de: 10, ate: 5, valor: 1 }] })) ?? "", /fim é menor/);
  // Dias presenciais: inteiros de 0 a 7.
  assert.match(erro(validarBloco("home_office", { faixas: [{ de: 0, ate: 1.5, valor: 1 }] })) ?? "", /inteiro/);
  assert.match(erro(validarBloco("home_office", { faixas: [{ de: 0, ate: 8, valor: 1 }] })) ?? "", /no máximo 7/);
  assert.ok(ok(validarBloco("home_office", { faixas: [{ de: 0, ate: 0, valor: 200 }, { de: 1, ate: 2, valor: 100 }] })));
});

test("rótulo da faixa", () => {
  assert.equal(rotuloFaixa("gasolina", { de: 0, ate: 10 }), "de 0 a 10 km");
  assert.equal(rotuloFaixa("gasolina", { de: 20.01, ate: null }), "acima de 20,01 km");
  assert.equal(rotuloFaixa("home_office", { de: 1, ate: 1 }), "1 dia");
  assert.equal(rotuloFaixa("home_office", { de: 0, ate: 0 }), "0 dias");
  assert.equal(rotuloFaixa("home_office", { de: 3, ate: null }), "3 dias ou mais");
});

test("salário-família e assiduidade: valores opcionais (vazio = não cadastrado)", () => {
  assert.deepEqual(ok(validarBloco("salario_familia", {})), { cota: null, limite: null, vigencia: null, fonte: null });
  assert.deepEqual(ok(validarBloco("assiduidade", { valor: "" })), { valor: null });
  assert.deepEqual(ok(validarBloco("assiduidade", { valor: 150 })), { valor: 150 });
});

test("reajuste: só o dinheiro muda, ao centavo; faixa de km, nome e regra ficam", () => {
  const g = ok(validarBloco("gasolina", { faixas: [{ id: "1", de: 0, ate: 10, valor: 150 }, { id: "2", de: 10.01, ate: null, valor: 333.33 }] }));
  const r = reajustarBloco("gasolina", g, 5);
  assert.deepEqual(r.faixas.map((f) => [f.de, f.ate, f.valor]), [[0, 10, 157.5], [10.01, null, 350]]);
  const sf = reajustarBloco("salario_familia", { cota: 67.54, limite: 1980.38, vigencia: "2026", fonte: "x" }, 4.5);
  assert.deepEqual([sf.cota, sf.limite, sf.vigencia], [70.58, 2069.5, "2026"]);
  assert.deepEqual(reajustarBloco("assiduidade", { valor: null }, 10), { valor: null }, "vazio continua vazio");
  const vt = reajustarBloco("transporte", { descontar6: false, bilhetes: [{ id: "b", nome: "BH", valor: 21 }] }, 10);
  assert.deepEqual(vt, { descontar6: false, bilhetes: [{ id: "b", nome: "BH", valor: 23.1 }] });
});

test("reajuste: maior que zero e até 100%", () => {
  assert.match(erroDoPercentual(0) ?? "", /maior que zero/);
  assert.match(erroDoPercentual(-3) ?? "", /maior que zero/);
  assert.match(erroDoPercentual(150) ?? "", /passa de 100%/);
  assert.equal(erroDoPercentual(5.5), null);
});

test("prévia: os valores em dinheiro de cada bloco, com rótulo", () => {
  assert.deepEqual(valoresDoBloco("sesi", { modalidades: [{ id: "m", nome: "Família", valor: 90 }] }), [{ rotulo: "Família", valor: 90 }]);
  assert.deepEqual(valoresDoBloco("home_office", { faixas: [{ id: "f", de: 0, ate: 0, valor: 200 }] }), [{ rotulo: "0 dias", valor: 200 }]);
  assert.deepEqual(valoresDoBloco("salario_familia", { cota: 67.54, limite: null, vigencia: null, fonte: null }), [{ rotulo: "Cota por filho", valor: 67.54 }]);
  assert.deepEqual(valoresDoBloco("assiduidade", { valor: null }), [], "sem valor, nada a reajustar");
});

test("leitura do banco: o que não passa na validação vira o bloco vazio, e prévia velha é percebida", () => {
  assert.deepEqual(lerBloco("carona", { faixas: [{ de: 10, ate: 5, valor: 1 }] }), BENEFICIOS_VAZIOS.carona);
  const a = { faixas: [{ id: "1", de: 0, ate: 10, valor: 150 }] };
  assert.equal(mesmoBloco("gasolina", a, { faixas: [{ id: "1", de: 0, ate: 10, valor: 150 }] }), true);
  assert.equal(mesmoBloco("gasolina", a, { faixas: [{ id: "1", de: 0, ate: 10, valor: 151 }] }), false);
});

test("salário-família da busca: número fora da grandeza vira vazio", () => {
  assert.deepEqual(sanearSalarioFamilia({ cota: 67.54, limite: 1980.38 }), { cota: 67.54, limite: 1980.38 });
  assert.deepEqual(sanearSalarioFamilia({ cota: 1518, limite: 3 }), { cota: null, limite: null }, "salário mínimo lido como cota");
});

test("o CHECK do banco conhece os mesmos blocos do código (bloco novo sem migration quebra aqui)", () => {
  const dir = join(process.cwd(), "supabase/migrations");
  const sql = readdirSync(dir)
    .filter((f) => f.endsWith(".sql"))
    .sort()
    .map((f) => readFileSync(join(dir, f), "utf8"))
    .join("\n")
    .replace(/--[^\n]*/g, "");
  for (const tabela of ["dp_beneficios_config", "dp_beneficios_reajustes"]) {
    const m = Array.from(sql.matchAll(new RegExp(String.raw`${tabela}_bloco_chk CHECK \(bloco IN \(([^)]*)\)\)`, "g"))).at(-1);
    assert.ok(m, `CHECK de ${tabela} não encontrado`);
    const lista = m[1].split(",").map((s: string) => s.trim().replace(/'/g, ""));
    assert.deepEqual(lista.sort(), [...BLOCOS_BENEFICIO].sort(), tabela);
  }
});
