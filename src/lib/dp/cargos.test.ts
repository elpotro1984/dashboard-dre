import assert from "node:assert/strict";
import { test } from "node:test";

import { chaveNome, enquadrar, rotuloLinha, salarioForaDaTabela, sugerirLinha, textoAlertaTabela, type DpLinhaSalarial } from "@/lib/dp/cargos";

test("chaveNome: caixa, acento, (a) e espaços não importam", () => {
  assert.equal(chaveNome("Consultor(a) de  Relacionamento Sênior II"), "consultor de relacionamento senior ii");
  assert.equal(chaveNome(" Analista  Comercial "), chaveNome("analista comercial"));
});

const linhas: DpLinhaSalarial[] = [
  { id: "n1", setor: "Comercial", cargo: "Analista Comercial 1", salario: 4000 },
  { id: "n2", setor: "Comercial", cargo: "Analista Comercial 3", salario: 5000 },
  { id: "n3", setor: "Operacional", cargo: "Motorista", salario: 2500 },
  { id: "n4", setor: "Marketing", cargo: "Designer 1", salario: 3000 },
  { id: "n5", setor: "Eventos", cargo: "Designer 1", salario: 3200 },
];

test("sugerirLinha: o nome da Sólides é o nome do cargo (step dentro)", () => {
  assert.equal(sugerirLinha("Analista Comercial 3", linhas), "n2");
  assert.equal(sugerirLinha("analista  comercial 1", linhas), "n1");
  assert.equal(sugerirLinha("Motorista", linhas), "n3");
});

test("sugerirLinha: o mesmo cargo em dois setores não sugere nada", () => {
  assert.equal(sugerirLinha("Designer 1", linhas), null);
  assert.equal(sugerirLinha("Analista Comercial", linhas), null);
  assert.equal(sugerirLinha("Gerente Geral", linhas), null);
});

test("rotuloLinha: setor · cargo, ou só o cargo", () => {
  assert.equal(rotuloLinha(linhas[0]), "Comercial · Analista Comercial 1");
  assert.equal(rotuloLinha({ setor: "", cargo: "Motorista" }), "Motorista");
});

test("enquadrar: tolerância de arredondamento, abaixo/acima e os casos sem dado", () => {
  assert.equal(enquadrar({ temEmpresa: true, salario: 5000.4, salarioNivel: 5000 }).status, "no_nivel");
  const abaixo = enquadrar({ temEmpresa: true, salario: 4500, salarioNivel: 5000 });
  assert.deepEqual(abaixo, { status: "abaixo", diferenca: -500, percentual: -10 });
  assert.equal(enquadrar({ temEmpresa: true, salario: 6000, salarioNivel: 5000 }).percentual, 20);
  assert.equal(enquadrar({ temEmpresa: true, salario: null, salarioNivel: 5000 }).status, "sem_salario");
  assert.equal(enquadrar({ temEmpresa: true, salario: 5000, salarioNivel: null }).status, "sem_vinculo");
  assert.equal(enquadrar({ temEmpresa: false, salario: 5000, salarioNivel: 5000 }).status, "sem_empresa");
});

test("alerta da tabela: só acima/abaixo; sem tabela, sem linha ou sem salário não alertam", () => {
  const base = { temEmpresa: true, salario: 5000, salarioNivel: 5000 };
  assert.equal(salarioForaDaTabela(enquadrar({ ...base, salario: 5000.5 })), false); // arredondamento
  assert.equal(salarioForaDaTabela(enquadrar({ ...base, salario: 4500 })), true);
  assert.equal(salarioForaDaTabela(enquadrar({ ...base, salario: 5600 })), true);
  assert.equal(salarioForaDaTabela(enquadrar({ ...base, salarioNivel: null })), false); // empresa sem tabela / cargo sem linha
  assert.equal(salarioForaDaTabela(enquadrar({ ...base, salario: null })), false);
  const t = textoAlertaTabela({
    salario: 4500,
    salarioTabela: 5000,
    linhaRotulo: "ADM · Analista 2",
    enquadramento: enquadrar({ ...base, salario: 4500 }),
  });
  assert.match(t ?? "", /abaixo da tabela \(ADM · Analista 2: R\$\s5\.000,00; −R\$\s500,00, −10%\)/);
  assert.match(t ?? "", /A folha segue o valor da Sólides/);
  assert.equal(textoAlertaTabela({ salario: 5000, salarioTabela: 5000, linhaRotulo: null, enquadramento: enquadrar(base) }), null);
});
