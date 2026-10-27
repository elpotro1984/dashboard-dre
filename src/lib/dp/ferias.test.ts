import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { diasDeFerias, erroDasFerias, feriasQueComecamNoMes, mesesDoPeriodo, reciboDeFerias, valorDasFerias } from "@/lib/dp/ferias";
import { CADASTRO_VAZIO, calcularFolhaPessoa, calcularInss, calcularIrrf, LANCAMENTO_PADRAO, type DpFolhaEntrada } from "@/lib/dp/folha/motor";
import { PARAMETROS_PADRAO as P } from "@/lib/dp/folha/parametros";

test("dias de férias: do início ao término, inclusive; data inválida = 0", () => {
  assert.equal(diasDeFerias("2026-10-05", "2026-10-14"), 10);
  assert.equal(diasDeFerias("2026-09-21", "2026-10-20"), 30);
  assert.equal(diasDeFerias("2026-02-30", "2026-03-05"), 0);
  assert.equal(diasDeFerias("", "2026-03-05"), 0);
});

test("validação: datas, término depois do início, até 30 dias, sem sobreposição com as outras da pessoa", () => {
  assert.equal(erroDasFerias({ inicio: "2026-10-05", fim: "2026-10-14" }, []), null);
  assert.match(erroDasFerias({ inicio: "", fim: "2026-10-14" }, []) ?? "", /Informe as datas/);
  assert.match(erroDasFerias({ inicio: "2026-10-14", fim: "2026-10-05" }, []) ?? "", /antes do início/);
  assert.match(erroDasFerias({ inicio: "2026-10-01", fim: "2026-11-05" }, []) ?? "", /no máximo 30/);
  assert.match(
    erroDasFerias({ inicio: "2026-10-10", fim: "2026-10-20" }, [{ inicio: "2026-10-01", fim: "2026-10-10" }]) ?? "",
    /sobrepõem às de 01\/10\/2026 a 10\/10\/2026/,
  );
  assert.equal(erroDasFerias({ inicio: "2026-10-11", fim: "2026-10-20" }, [{ inicio: "2026-10-01", fim: "2026-10-10" }]), null, "encostar não é sobrepor");
});

const rec = (o: Partial<Parameters<typeof reciboDeFerias>[0]>) =>
  reciboDeFerias({ salario: 3000, contrato: "clt", dias: 30, semInss: false, dependentesIr: 0, ...o }, P);

test("recibo: férias + 1/3 − INSS − IRRF, com as tabelas do salário (o caso da tela de 27/10/2026)", () => {
  const r = rec({ salario: 4069.72, dias: 15 });
  assert.deepEqual([r.ferias, r.terco, r.bruto, r.inss, r.irrf, r.liquido], [2034.86, 678.29, 2713.15, 219.87, 0, 2493.28]);
  assert.equal(valorDasFerias(null, r.liquido), 2493.28, "sem manual, vale o líquido");
  assert.equal(valorDasFerias(2400, r.liquido), 2400, "o informado vence");
});

test("recibo: INSS e IRRF são os do motor da folha, à parte do salário do mês", () => {
  for (const salario of [1800, 4870.55, 9500, 15000]) {
    const r = rec({ salario, dias: 20, dependentesIr: 1 });
    const inss = calcularInss(r.bruto, P.inss).valor;
    assert.equal(r.inss, inss, `INSS ${salario}`);
    assert.equal(r.irrf, calcularIrrf(r.bruto, inss, 1, P.irrf).valor, `IRRF ${salario}`);
    assert.equal(r.liquido, Math.round((r.bruto - r.inss - r.irrf) * 100) / 100);
  }
  assert.ok(rec({ salario: 12000 }).irrf > rec({ salario: 12000, dependentesIr: 3 }).irrf, "dependente reduz o IRRF");
});

test("recibo: o recorte do salário por contrato", () => {
  const est = rec({ contrato: "estagio", salario: 1500, dias: 15 });
  assert.deepEqual([est.terco, est.inss], [0, 0], "estágio: sem o terço e sem INSS");
  for (const contrato of ["prestador", "socio"] as const) {
    const r = rec({ contrato, salario: 10000 });
    assert.deepEqual([r.inss, r.irrf, r.liquido], [0, 0, r.bruto], contrato);
  }
  assert.equal(rec({ semInss: true }).inss, 0, "sem INSS do cadastro (diretor)");
  assert.deepEqual([rec({ salario: null }).bruto, rec({ salario: null }).liquido], [0, 0]);
});

test("a conta é a MESMA do motor da folha (férias, 1/3 e o INSS do recibo de um período dentro do mês)", () => {
  for (const [salario, dias, contrato] of [[4870.55, 12, "clt"], [3000, 30, "clt"], [1999.9, 7, "aprendiz"], [1500, 15, "estagio"]] as const) {
    const e: DpFolhaEntrada = {
      solidesId: 1, nome: "A", setor: null, centroCusto: null, empresaId: "e1", contrato, salario,
      nascimento: "1990-01-01", admissao: "2024-01-01", desligamento: null,
      cadastro: { ...CADASTRO_VAZIO, planoDependentes: [], ferias: [{ id: "f", inicio: "2026-10-01", fim: `2026-10-${String(dias).padStart(2, "0")}` }] },
      lancamento: { ...LANCAMENTO_PADRAO, ajustes: {} },
    };
    const folha = calcularFolhaPessoa(e, P, "2026-10");
    const r = rec({ salario, dias, contrato });
    assert.deepEqual([r.ferias, r.terco, r.inss], [folha.ferias, folha.tercoFerias, folha.automatico.inssFerias], `${contrato} ${salario} × ${dias}`);
  }
});

test("a tela mostra no mês do INÍCIO; o período toca os meses que atravessa", () => {
  const lista = [
    { inicio: "2026-10-21", fim: "2026-11-19" },
    { inicio: "2026-10-01", fim: "2026-10-10" },
    { inicio: "2026-09-25", fim: "2026-10-04" },
  ];
  assert.deepEqual(feriasQueComecamNoMes(lista, "2026-10").map((f) => f.inicio), ["2026-10-01", "2026-10-21"]);
  assert.deepEqual(mesesDoPeriodo("2026-12-20", "2027-01-08"), ["2026-12", "2027-01"]);
  assert.deepEqual(mesesDoPeriodo("2026-10-01", "2026-10-10"), ["2026-10"]);
});

test("fonte ÚNICA: a folha lê as férias do controle, e salvar o cadastro não regrava o campo antigo", () => {
  const ler = (p: string) => readFileSync(join(process.cwd(), p), "utf8");
  const queries = ler("src/lib/dp/folha/queries.ts");
  const montagem = queries.slice(queries.indexOf("export async function listPessoasDaFolha"));
  assert.match(montagem, /lerFeriasDasPessoas\(db, solidesIds\)/, "listPessoasDaFolha precisa ler o controle de férias");
  const validacao = ler("src/lib/dp/folha/validacao.ts");
  const linha = validacao.slice(validacao.indexOf("export function linhaCadastro"), validacao.indexOf("export function linhaLancamento"));
  assert.doesNotMatch(linha.replace(/\/\/[^\n]*/g, ""), /\bferias:/, "linhaCadastro não pode gravar férias");
});
