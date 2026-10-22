import assert from "node:assert/strict";
import { test } from "node:test";

import { linhaEncargosDp, regimeValido } from "@/lib/dp/encargos-config";

test("linha: grava os patronais e preserva o FGTS que já estava (é do Orçamento)", () => {
  assert.deepEqual(linhaEncargosDp({ inss_patronal: 20, rat_fap: 3, terceiros: 5.8 }, 8.5, "lucro_real"), {
    inss_patronal: 20,
    rat_fap: 3,
    terceiros: 5.8,
    fgts: 8.5,
  });
});

test("linha: sem linha anterior, o FGTS é o padrão do regime", () => {
  assert.equal(linhaEncargosDp({ inss_patronal: 0, rat_fap: 0, terceiros: 0 }, null, "simples_nacional").fgts, 8);
});

test("linha: fora de 0 a 100 é recusado, com o nome do encargo", () => {
  assert.throws(() => linhaEncargosDp({ inss_patronal: 200, rat_fap: 2, terceiros: 5.8 }, 8, null), /INSS patronal/);
  assert.throws(() => linhaEncargosDp({ inss_patronal: 20, rat_fap: -1, terceiros: 5.8 }, 8, null), /RAT/);
  assert.throws(() => linhaEncargosDp({ inss_patronal: 20, rat_fap: 2, terceiros: Number.NaN }, 8, null), /Terceiros/);
});

test("regime: só os três do CHECK de companies, ou nulo", () => {
  assert.equal(regimeValido("simples_nacional"), true);
  assert.equal(regimeValido(null), true);
  assert.equal(regimeValido("mei"), false);
  assert.equal(regimeValido(undefined), false);
});
