import assert from "node:assert/strict";
import { test } from "node:test";

import { CADASTRO_VAZIO, calcularFolhaPessoa, LANCAMENTO_PADRAO } from "@/lib/dp/folha/motor";
import { PARAMETROS_PADRAO as P } from "@/lib/dp/folha/parametros";
import {
  casarPlanilha,
  conferir,
  indiceDaColuna,
  lerPlanilhaGenerica,
  lerValor,
  normalizarCpf,
  planejarValores,
  sugerirMapeamento,
} from "@/lib/dp/folha/planilha-generica";

test("lerValor: formatos de relatório, inclusive negativos com parênteses e sinal no fim", () => {
  assert.equal(lerValor("1.234,56"), 1234.56);
  assert.equal(lerValor("R$ 1.234,56"), 1234.56);
  assert.equal(lerValor("(1.234,56)"), -1234.56);
  assert.equal(lerValor("1.234,56-"), -1234.56);
  assert.equal(lerValor("-10"), -10);
  assert.equal(lerValor(12.5), 12.5);
  assert.equal(lerValor(""), null);
  assert.equal(lerValor("Fulano"), null);
});

test("CPF: só dígitos e recupera os zeros que o Excel come", () => {
  assert.equal(normalizarCpf("012.345.678-90"), "01234567890");
  assert.equal(normalizarCpf(1234567890), "01234567890");
  assert.equal(normalizarCpf("123"), null);
});

test("cabeçalho: a linha com mais textos entre as primeiras (título e CNPJ antes não atrapalham)", () => {
  const m = [["RESUMO DA FOLHA"], ["CNPJ 00.000.000/0001-00"], [], ["Nome", "CPF", "Salário", "INSS", "Líquido"], ["Ana", "11122233344", 3000, 248.6, 2500], []];
  const r = lerPlanilhaGenerica(m);
  assert.ok("cabecalho" in r);
  if (!("cabecalho" in r)) return;
  assert.deepEqual(r.cabecalho, ["Nome", "CPF", "Salário", "INSS", "Líquido"]);
  assert.equal(r.linhas.length, 1);
  assert.equal(indiceDaColuna(r.cabecalho, "líquido"), 4);
  assert.ok("erro" in lerPlanilhaGenerica([[1, 2], [3, 4]]));
});

test("sugestão de colunas pelo nome do cabeçalho; CPF vence nome como identificador", () => {
  const s = sugerirMapeamento(["Funcionário", "CPF", "Salário Base", "INSS", "IRRF", "FGTS", "Total Descontos", "Líquido a Receber"]);
  assert.equal(s.identificador, "CPF");
  assert.equal(s.tipoIdentificador, "cpf");
  assert.equal(s.campos.inssMes, "INSS");
  assert.equal(s.campos.irrf, "IRRF");
  assert.equal(s.campos.quintoDiaUtil, "Líquido a Receber");
  assert.equal(s.campos.totalDescontos, "Total Descontos");
  assert.equal(s.campos.salarioMes, "Salário Base");
});

const pessoas = [
  { solidesId: 1, nome: "Ana Souza", cpf: "11122233344" },
  { solidesId: 2, nome: "Bruno Lima", cpf: null },
];

test("casar por CPF ou nome; linhas repetidas da mesma pessoa somam; total do relatório não é pessoa", () => {
  const p = { cabecalho: ["Nome", "CPF", "Valor"], linhas: [["Ana Souza", "111.222.333-44", "100,00"], ["Ana Souza", "11122233344", "50"], ["Fulano", "99999999999", 10]], linhaCabecalho: 1 };
  const c = casarPlanilha(p, "CPF", "cpf", ["Valor"], pessoas);
  assert.equal(c.casadas.get(1)?.valores.Valor, 150);
  assert.equal(c.repetidas, 1);
  assert.deepEqual(c.naoEncontradas, ["99999999999"]);
  const n = casarPlanilha({ ...p, linhas: [["BRUNO LIMA", "", 20], ["TOTAL GERAL", "", 999]] }, "Nome", "nome", ["Valor"], pessoas);
  assert.equal(n.casadas.get(2)?.valores.Valor, 20);
  assert.deepEqual(n.naoEncontradas, []);
});

test("conferência: lista só o que difere acima da tolerância e quem falta de cada lado", () => {
  const base = {
    setor: null,
    centroCusto: null,
    empresaId: "e",
    contrato: "clt" as const,
    salario: 3000,
    nascimento: null,
    admissao: null,
    desligamento: null,
    cadastro: { ...CADASTRO_VAZIO, planoDependentes: [] },
    lancamento: { ...LANCAMENTO_PADRAO, ajustes: {} },
  };
  const folha = [
    calcularFolhaPessoa({ ...base, solidesId: 1, nome: "Ana Souza" }, P, "2026-09"),
    calcularFolhaPessoa({ ...base, solidesId: 2, nome: "Bruno Lima" }, P, "2026-09"),
  ];
  const casamento = {
    casadas: new Map([[1, { solidesId: 1, valores: { INSS: -248.6, Líquido: 2000 }, linhas: 1 }]]),
    naoEncontradas: ["Carla"],
    ambiguas: [],
    repetidas: 0,
  };
  const r = conferir(folha, casamento, { identificador: "CPF", tipoIdentificador: "cpf", campos: { inssMes: "INSS", saldo: "Líquido" } });
  assert.equal(r.conferidas, 1);
  assert.equal(r.diferencas.length, 1); // INSS bate (o sinal do relatório é ignorado); o líquido não
  assert.equal(r.diferencas[0].campo, "saldo");
  assert.deepEqual(r.soNaFolha, ["Bruno Lima"]);
  assert.deepEqual(r.soNaPlanilha, ["Carla"]);
  assert.equal(r.semDiferenca, 0);
});

test("valores da planilha: substituir × somar; igual ao atual não é mudança; dinheiro sem sinal", () => {
  const casamento = {
    casadas: new Map([
      [1, { solidesId: 1, valores: { Copart: -80 }, linhas: 1 }],
      [2, { solidesId: 2, valores: { Copart: 30 }, linhas: 1 }],
    ]),
    naoEncontradas: [],
    ambiguas: [],
    repetidas: 0,
  };
  const atuais = new Map([[2, { ...LANCAMENTO_PADRAO, ajustes: {}, coparticipacao: 30 }]]);
  // a pessoa 2 já tinha os mesmos 30: não é mudança
  assert.deepEqual(planejarValores(casamento, "Copart", "coparticipacao", "substituir", atuais), [{ solidesId: 1, antes: null, depois: 80 }]);
  assert.deepEqual(planejarValores(casamento, "Copart", "coparticipacao", "somar", atuais).map((x) => x.depois), [80, 60]);
});

test("sugestão com os cabeçalhos reais da planilha de set/2026 (aba SALÁRIO)", () => {
  const s = sugerirMapeamento([
    "FUNCIONÁRIOS",
    "Salário Bruto Carteira",
    "Salário Bruto do Mês",
    "Desconto INSS",
    "Desconto INSS FÉRIAS",
    "Desconto Vale Transporte",
    "Desconto IRRF",
    "TOTAL DE DESCONTOS",
    "SALDO (ENTR. - DESC.)",
    "ADIANTAMENTO",
    "TOTAL 5° DIA UTIL",
    "Vale Transporte",
    "FGTS",
    "TOTAL GERAL (Tot. Extras + Sal. Líquido)",
  ]);
  assert.equal(s.identificador, "FUNCIONÁRIOS");
  assert.equal(s.tipoIdentificador, "nome");
  assert.equal(s.campos.salarioMes, "Salário Bruto do Mês");
  assert.equal(s.campos.quintoDiaUtil, "TOTAL 5° DIA UTIL");
  assert.equal(s.campos.saldo, "SALDO (ENTR. - DESC.)");
  assert.equal(s.campos.inssMes, "Desconto INSS");
  assert.equal(s.campos.vtDesconto, "Desconto Vale Transporte");
});
