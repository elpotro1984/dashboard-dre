import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { diasDeFerias, erroDasFerias, feriasQueComecamNoMes, mesesDoPeriodo, valorCalculadoFerias, valorDasFerias } from "@/lib/dp/ferias";
import { CADASTRO_VAZIO, calcularFolhaPessoa, LANCAMENTO_PADRAO, type DpFolhaEntrada } from "@/lib/dp/folha/motor";
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

test("valor calculado = salário ÷ 30 × dias + 1/3; estágio sem o terço", () => {
  assert.deepEqual(valorCalculadoFerias(3000, "clt", 30), { ferias: 3000, terco: 1000, total: 4000 });
  assert.deepEqual(valorCalculadoFerias(3000, "clt", 10), { ferias: 1000, terco: 333.33, total: 1333.33 });
  assert.deepEqual(valorCalculadoFerias(1500, "estagio", 15), { ferias: 750, terco: 0, total: 750 });
  assert.deepEqual(valorCalculadoFerias(null, "clt", 10), { ferias: 0, terco: 0, total: 0 });
  assert.equal(valorDasFerias(null, 1333.33), 1333.33);
  assert.equal(valorDasFerias(1200, 1333.33), 1200, "o informado vence");
});

test("a conta é a MESMA do motor da folha (férias e 1/3 de um período dentro do mês)", () => {
  for (const [salario, dias, contrato] of [[4870.55, 12, "clt"], [3000, 30, "clt"], [1999.9, 7, "aprendiz"], [1500, 15, "estagio"]] as const) {
    const e: DpFolhaEntrada = {
      solidesId: 1, nome: "A", setor: null, centroCusto: null, empresaId: "e1", contrato, salario,
      nascimento: "1990-01-01", admissao: "2024-01-01", desligamento: null,
      cadastro: { ...CADASTRO_VAZIO, planoDependentes: [], ferias: [{ id: "f", inicio: "2026-10-01", fim: `2026-10-${String(dias).padStart(2, "0")}` }] },
      lancamento: { ...LANCAMENTO_PADRAO, ajustes: {} },
    };
    const folha = calcularFolhaPessoa(e, P, "2026-10");
    const v = valorCalculadoFerias(salario, contrato, dias);
    assert.deepEqual([v.ferias, v.terco], [folha.ferias, folha.tercoFerias], `${contrato} ${salario} × ${dias}`);
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
