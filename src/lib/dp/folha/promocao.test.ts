import assert from "node:assert/strict";
import { test } from "node:test";

import { aplicarPromocao, estadoPromocao, promocaoVigente, validarPromocao, type DpPromocao } from "@/lib/dp/folha/promocao";

const promo = (o: Partial<DpPromocao> = {}): DpPromocao => ({
  id: "p1",
  solidesId: 10,
  vigencia: "2026-11",
  linhaId: "l1",
  setor: "Comercial",
  cargo: "Analista 2",
  salario: 4500,
  cargoAnterior: "Analista 1",
  salarioAnterior: 4000,
  salarioSolidesNoRegistro: 4000,
  motivo: null,
  criadaEm: "2026-10-22T10:00:00Z",
  ...o,
});

test("vigente: a de início mais recente que não passa do mês", () => {
  const a = promo({ id: "a", vigencia: "2026-03" });
  const b = promo({ id: "b", vigencia: "2026-11" });
  assert.equal(promocaoVigente([a, b], "2026-10")?.id, "a");
  assert.equal(promocaoVigente([a, b], "2026-11")?.id, "b");
  assert.equal(promocaoVigente([a, b], "2026-02"), null);
});

test("estado: o salário da Sólides desde o registro decide", () => {
  const p = promo();
  assert.equal(estadoPromocao(p, { salarioSolides: 4000, avulso: false }), "pendente");
  assert.equal(estadoPromocao(p, { salarioSolides: 4500, avulso: false }), "refletida");
  assert.equal(estadoPromocao(p, { salarioSolides: 4700, avulso: false }), "divergente");
  assert.equal(estadoPromocao(p, { salarioSolides: null, avulso: true }), "fora_da_solides");
});

test("aplicar: pendente usa a promoção e avisa para atualizar a Sólides", () => {
  const r = aplicarPromocao({ salario: 4000, cargo: "Analista 1", avulso: false }, [promo()], "2026-11");
  assert.equal(r.salario, 4500);
  assert.equal(r.cargo, "Analista 2");
  assert.equal(r.estado, "pendente");
  assert.match(r.aviso ?? "", /atualize cargo e salário na Sólides/);
  assert.match(r.origem ?? "", /a partir de nov\/2026/);
});

test("aplicar: antes do mês de início, nada muda", () => {
  const r = aplicarPromocao({ salario: 4000, cargo: "Analista 1", avulso: false }, [promo()], "2026-10");
  assert.deepEqual([r.salario, r.cargo, r.estado], [4000, "Analista 1", null]);
});

test("aplicar: refletida e divergente seguem a Sólides; só a divergente avisa", () => {
  const ref = aplicarPromocao({ salario: 4500, cargo: "ANALISTA II", avulso: false }, [promo()], "2026-12");
  assert.deepEqual([ref.salario, ref.cargo, ref.estado, ref.aviso], [4500, "ANALISTA II", "refletida", null]);
  const div = aplicarPromocao({ salario: 4700, cargo: "Analista 2", avulso: false }, [promo()], "2026-12");
  assert.equal(div.salario, 4700);
  assert.match(div.aviso ?? "", /a folha usa a Sólides/);
});

test("estado: promoção sem aumento (só cargo) já conta como refletida", () => {
  assert.equal(estadoPromocao(promo({ salario: 4000 }), { salarioSolides: 4000, avulso: false }), "refletida");
});

test("aplicar: a Sólides atualizada ANTES do início não muda os meses anteriores", () => {
  // Registrada em outubro (Sólides em 4.000), valendo em novembro; o DP já atualizou a Sólides para 4.500.
  const out = aplicarPromocao({ salario: 4500, cargo: "Analista 2", avulso: false }, [promo()], "2026-10");
  assert.deepEqual([out.salario, out.cargo, out.estado], [4000, "Analista 1", null]);
  assert.match(out.origem ?? "", /anterior à promoção de nov\/2026/);
  const nov = aplicarPromocao({ salario: 4500, cargo: "Analista 2", avulso: false }, [promo()], "2026-11");
  assert.deepEqual([nov.salario, nov.estado, nov.origem], [4500, "refletida", null]);
  // Sem a Sólides atualizada, o mês anterior segue igual.
  const semMudar = aplicarPromocao({ salario: 4000, cargo: "Analista 1", avulso: false }, [promo()], "2026-10");
  assert.deepEqual([semMudar.salario, semMudar.origem], [4000, null]);
});

test("aplicar: a anterior de uma promoção futura é o que a folha usava no registro", () => {
  const a = promo({ id: "a", vigencia: "2026-08", salario: 4500, salarioSolidesNoRegistro: 4000 });
  const b = promo({ id: "b", vigencia: "2026-12", cargo: "Analista 3", salario: 5000, salarioAnterior: 4500, salarioSolidesNoRegistro: 4000 });
  // A Sólides foi direto para o valor de dezembro: em outubro vale a promoção de agosto.
  const out = aplicarPromocao({ salario: 5000, cargo: "Analista 3", avulso: false }, [a, b], "2026-10");
  assert.equal(out.salario, 4500);
});

test("aplicar: pessoa fora da Sólides fica com a promoção sem prazo", () => {
  const r = aplicarPromocao({ salario: 2000, cargo: null, avulso: true }, [promo({ salarioSolidesNoRegistro: null })], "2027-03");
  assert.deepEqual([r.salario, r.estado, r.aviso], [4500, "fora_da_solides", null]);
});

test("validar: mês, cargo e salário obrigatórios", () => {
  assert.throws(() => validarPromocao({ vigencia: "2026-13", cargo: "x", salario: 1, motivo: null }), /Mês/);
  assert.throws(() => validarPromocao({ vigencia: "2026-11", cargo: " ", salario: 1, motivo: null }), /cargo/);
  assert.throws(() => validarPromocao({ vigencia: "2026-11", cargo: "x", salario: 0, motivo: null }), /salário/);
  assert.deepEqual(validarPromocao({ vigencia: "2026-11", cargo: " Analista  2 ", salario: 4500.004, motivo: " " }), {
    vigencia: "2026-11",
    cargo: "Analista 2",
    salario: 4500,
    motivo: null,
  });
});
