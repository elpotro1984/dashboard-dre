import assert from "node:assert/strict";
import { test } from "node:test";

import { avulsoNaCompetencia, contratoDaPlanilha, empresasPorRotulo, validarAvulso } from "@/lib/dp/folha/avulsos";
import { ajustesDaPlanilha, casarNome, lerControle, lerData, lerNumero } from "@/lib/dp/folha/importacao";
import { CADASTRO_VAZIO, calcularFolhaPessoa, LANCAMENTO_PADRAO, type DpFolhaEntrada } from "@/lib/dp/folha/motor";
import {
  faixaEtaria,
  idadeNaCompetencia,
  PARAMETROS_PADRAO as P,
  rotuloCompetencia,
  somarMeses,
  validarParametros,
  vigenciaPara,
} from "@/lib/dp/folha/parametros";
import { categoriasDaLinha, SEM_GRUPO, totalizar } from "@/lib/dp/folha/totais";
import { herdarDoMesAnterior, mesclarLancamento, validarCadastro, validarLancamento } from "@/lib/dp/folha/validacao";

// ── parâmetros ────────────────────────────────────────────────────────────
test("vigência: a mais recente que não passa da competência", () => {
  const v = [{ vigencia: "2026-01" }, { vigencia: "2026-06" }, { vigencia: "2027-01" }];
  assert.equal(vigenciaPara(v, "2026-05")?.vigencia, "2026-01");
  assert.equal(vigenciaPara(v, "2026-06")?.vigencia, "2026-06");
  assert.equal(vigenciaPara(v, "2025-12"), null);
});

test("competência: soma de meses e rótulo", () => {
  assert.equal(somarMeses("2026-12", 1), "2027-01");
  assert.equal(somarMeses("2026-01", -1), "2025-12");
  assert.equal(rotuloCompetencia("2026-09"), "set/2026");
});

test("idade no 1º dia da competência e faixa etária da ANS", () => {
  assert.equal(idadeNaCompetencia("1996-09-15", "2026-09"), 29);
  assert.equal(idadeNaCompetencia("1996-09-01", "2026-09"), 30);
  assert.equal(idadeNaCompetencia("1996-10-15", "2026-09"), 29);
  assert.equal(faixaEtaria(18), 0);
  assert.equal(faixaEtaria(19), 1);
  assert.equal(faixaEtaria(58), 8);
  assert.equal(faixaEtaria(80), 9);
});

test("validarParametros: o padrão passa; faixa fora de ordem e percentual > 100% não", () => {
  assert.doesNotThrow(() => validarParametros(P));
  const ruim = structuredClone(P);
  ruim.inss[1].ate = 100;
  assert.throws(() => validarParametros(ruim), /ordem crescente/);
  const ruim2 = structuredClone(P);
  ruim2.fgtsPercentual = 8;
  assert.throws(() => validarParametros(ruim2), /FGTS/);
  const dup = structuredClone(P);
  dup.bilhetes.push({ ...dup.bilhetes[0] });
  assert.throws(() => validarParametros(dup), /duas vezes/);
});

// ── totais ───────────────────────────────────────────────────────────────
function linha(over: Partial<DpFolhaEntrada>, lan: Partial<typeof LANCAMENTO_PADRAO> = {}) {
  return calcularFolhaPessoa(
    {
      solidesId: 1,
      nome: "X",
      setor: null,
      centroCusto: null,
      empresaId: "e",
      contrato: "clt",
      salario: 1800,
      nascimento: null,
      cadastro: { ...CADASTRO_VAZIO, planoDependentes: [], salarioFamiliaCotas: 1 },
      lancamento: { ...LANCAMENTO_PADRAO, ajustes: {}, ...lan },
      ...over,
    },
    P,
    "2026-09",
  );
}

test("INSS da guia: desconto menos salário-família e menos o salário de quem está em licença-maternidade", () => {
  const n = linha({});
  assert.equal(Math.round(categoriasDaLinha(n).inss * 100) / 100, Math.round((n.inss - n.salarioFamilia) * 100) / 100);
  const lm = linha({}, { situacao: "licenca_maternidade" });
  assert.equal(Math.round(categoriasDaLinha(lm).inss * 100) / 100, Math.round((lm.inss - lm.saldo - lm.salarioFamilia) * 100) / 100);
});

test("totalizar: um agrupamento para todas as categorias, 'Sem definição' por último, rescisões em indenizações", () => {
  const a = linha({ setor: "TI" });
  const b = linha({ setor: "ADM" });
  const c = linha({ setor: null });
  const t = totalizar([a, b, c], (l) => l.setor, [{ grupo: "TI", valor: 500 }]);
  assert.deepEqual(t.grupos, ["ADM", "TI", SEM_GRUPO]);
  const sal = t.linhas.find((l) => l.categoria === "salario")!;
  assert.equal(sal.valores.TI, a.saldo);
  assert.equal(sal.total, Math.round((a.saldo + b.saldo + c.saldo) * 100) / 100);
  assert.equal(t.linhas.find((l) => l.categoria === "indenizacoes")!.valores.TI, 500);
  assert.equal(t.pessoas.TI, 1);
});

// ── importação ───────────────────────────────────────────────────────────
const pessoas = [
  { solidesId: 1, nome: "Maria da Silva Souza" },
  { solidesId: 2, nome: "João Pereira" },
  { solidesId: 3, nome: "João Pereira Lima" },
];

test("casarNome: exato sem acento/caixa; parcial só com um candidato; ambíguo nunca casa", () => {
  assert.deepEqual(casarNome("MARIA DA SILVA SOUZA", pessoas), { tipo: "exato", solidesId: 1, nomeSolides: "Maria da Silva Souza" });
  assert.equal(casarNome("Maria Souza", pessoas).tipo, "parcial");
  assert.equal(casarNome("Joao Pereira", pessoas).tipo, "exato");
  assert.equal(casarNome("Pereira", pessoas).tipo, "nenhum"); // uma palavra só não casa por continência
  assert.equal(casarNome("João Lima", [...pessoas, { solidesId: 4, nome: "João Lima Pereira" }]).tipo, "ambiguo");
  assert.equal(casarNome("Fulano de Tal", pessoas).tipo, "nenhum");
});

test("lerData e lerNumero: os formatos que chegam do Excel", () => {
  assert.equal(lerData(new Date(1990, 2, 5)), "1990-03-05");
  assert.equal(lerData("05/03/1990"), "1990-03-05");
  assert.equal(lerData(45000), "2023-03-15");
  assert.equal(lerNumero("1.234,56"), 1234.56);
  assert.equal(lerNumero("R$ 97,50"), 97.5);
  assert.equal(lerNumero(""), 0);
});

test("lerControle: rótulos de categoria viram cadastro; AFASTADO vira situação do mês; DIRETOR fica sem INSS", () => {
  const m = [
    ["FUNCIONÁRIOS", "CENTRO DE CUSTO", "SETOR", "TIPO DE CONTRATO", "DIAS TRABALHADOS ", "PLANO DE SAÚDE", "DN\nDEPENDENTE 1", "PLANO ODONTOLÓGICO", "SALÁRIO FAMÍLIA", "DEPENDENTES IRRF", "ADIANTAMENTO", "ALIMENTAÇÃO", "TRANSPORTE", "DIAS TRAB. P/ SEMANA", "AUXÍLIO HOME OFFICE", "INSS FÉRIAS"],
    ["Maria", "QUOKKA", "DIRETOR", "AFASTADO", 30, "Enfermaria", new Date(2020, 0, 2), "Odonto 3", "Sal. Familia 2", "Dependente 1", "Sim", "Alimentação 525,00", "Bilhete BH", "5 dias BH", 150, -120],
    ["João", "", "TI", "CLT", "", "Nenhum", "", "Nenhum", "Nenhum", "Nenhum", "Não", "Nenhum", "Gasolina 97,50", "6 dias", 0, ""],
    ["", "", "", "", "", "", "", "", "", "", "", "", "", "", "", ""],
  ];
  const r = lerControle(m, P);
  assert.ok("ok" in r);
  if (!("ok" in r)) return;
  assert.equal(r.ok.length, 2);
  const [a, b] = r.ok;
  assert.equal(a.cadastro.planoSaude, "enfermaria");
  assert.deepEqual(a.cadastro.planoDependentes, [{ nome: "Dependente 1", nascimento: "2020-01-02" }]);
  assert.equal(a.cadastro.odontoVidas, 3);
  assert.equal(a.cadastro.salarioFamiliaCotas, 2);
  assert.equal(a.cadastro.dependentesIr, 1);
  assert.equal(a.cadastro.adiantamento, true);
  assert.equal(a.cadastro.alimentacao, 525);
  assert.equal(a.cadastro.transporteTipo, "bilhete");
  assert.equal(a.cadastro.escala, "5 dias BH");
  assert.equal(a.cadastro.homeOffice, 150);
  assert.equal(a.cadastro.semInss, true);
  assert.equal(a.lancamento.situacao, "afastado");
  assert.equal(a.centroPlanilha, "QUOKKA");
  assert.equal(a.setorPlanilha, "DIRETOR");
  assert.equal(a.lancamento.inssFerias, 120);
  assert.equal(b.cadastro.transporteTipo, "gasolina");
  assert.equal(b.cadastro.transporteValor, 97.5);
  assert.equal(b.lancamento.diasTrabalhados, 30); // célula vazia = mês cheio
  assert.ok("erro" in lerControle([["NOME"], ["x"]], P));
});

test("ajustesDaPlanilha: só a célula DIGITADA vira ajuste; fórmula é recalculada pelo sistema", () => {
  const m = ajustesDaPlanilha(
    [{ nome: "Maria", celulas: { "Desconto IRRF": { valor: 123.456, digitado: true }, "Desconto INSS": { valor: 300, digitado: false }, "TOTAL DE DESCONTOS": { valor: 1, digitado: true } } }],
    "set/2026",
  );
  assert.deepEqual(m.get("maria"), { irrf: { valor: 123.46, motivo: "valor digitado na planilha de set/2026" } });
});

// ── validação ────────────────────────────────────────────────────────────
test("validarLancamento: ajuste exige motivo e só em coluna de cálculo", () => {
  const base = { ...LANCAMENTO_PADRAO, ajustes: {} };
  assert.throws(() => validarLancamento({ ...base, ajustes: { irrf: { valor: 1, motivo: " " } } }), /motivo/);
  assert.throws(() => validarLancamento({ ...base, ajustes: { totalGeral: { valor: 1, motivo: "x" } } as never }), /não aceita ajuste/);
  assert.throws(() => validarLancamento({ ...base, diasTrabalhados: 40 }), /Dias trabalhados/);
  assert.deepEqual(validarLancamento({ ...base, ajustes: { irrf: { valor: 10.005, motivo: " ok " } } }).ajustes, { irrf: { valor: 10.01, motivo: "ok" } });
});

test("validarCadastro: bilhete e escala têm de existir nos parâmetros; sem plano não guarda dependente", () => {
  const c = { ...CADASTRO_VAZIO, planoDependentes: [] };
  assert.throws(() => validarCadastro({ ...c, transporteTipo: "bilhete", transporteOpcao: "Metrô" }, P), /bilhete/);
  assert.throws(() => validarCadastro({ ...c, escala: "4 dias" }, P), /escala/);
  const v = validarCadastro({ ...c, planoDependentes: [{ nome: "A", nascimento: "2020-01-01" }] }, P);
  assert.deepEqual(v.planoDependentes, []);
});

test("grade: a edição do mês preserva os ajustes manuais já gravados", () => {
  const gravado = { ...LANCAMENTO_PADRAO, ajustes: { irrf: { valor: 10, motivo: "contabilidade" } } };
  const { ajustes: _a, ...campos } = { ...LANCAMENTO_PADRAO, diasTrabalhados: 20, ajustes: {} };
  void _a;
  assert.deepEqual(mesclarLancamento(gravado, campos).ajustes, gravado.ajustes);
  assert.equal(mesclarLancamento(gravado, campos).diasTrabalhados, 20);
  assert.deepEqual(mesclarLancamento(null, campos).ajustes, {});
});

test("mês novo herda só situação e outros descontos (dias, férias, copart. e ajustes começam do zero)", () => {
  const anterior = {
    ...LANCAMENTO_PADRAO,
    situacao: "afastado" as const,
    outrosDescontos: 250,
    diasFerias: 10,
    coparticipacao: 80,
    ajustes: { irrf: { valor: 1, motivo: "x" } },
  };
  const r = herdarDoMesAnterior(anterior, { ...LANCAMENTO_PADRAO, ajustes: {} });
  assert.equal(r.situacao, "afastado");
  assert.equal(r.outrosDescontos, 250);
  assert.equal(r.diasFerias, 0);
  assert.equal(r.coparticipacao, 0);
  assert.deepEqual(r.ajustes, {});
});

test("setor da folha: texto livre aparado; vazio volta ao da Sólides", () => {
  const c = { ...CADASTRO_VAZIO, planoDependentes: [] };
  assert.equal(validarCadastro({ ...c, setorFolha: "  CASH   OUT " }, P).setorFolha, "CASH OUT");
  assert.equal(validarCadastro({ ...c, setorFolha: "  " }, P).setorFolha, null);
});

// ── pessoas fora da Sólides ──────────────────────────────────────────────
test("avulso entra no mês entre admissão e desligamento; unificado nunca mais entra", () => {
  const base = { admissao: null, desligamento: null, unificadoCom: null };
  assert.equal(avulsoNaCompetencia(base, "2026-09"), true);
  assert.equal(avulsoNaCompetencia({ ...base, admissao: "2026-09-30" }, "2026-09"), true);
  assert.equal(avulsoNaCompetencia({ ...base, admissao: "2026-10-01" }, "2026-09"), false);
  assert.equal(avulsoNaCompetencia({ ...base, desligamento: "2026-09-01" }, "2026-09"), true);
  assert.equal(avulsoNaCompetencia({ ...base, desligamento: "2026-08-31" }, "2026-09"), false);
  assert.equal(avulsoNaCompetencia({ ...base, admissao: "2026-02-01" }, "2026-02"), true);
  assert.equal(avulsoNaCompetencia({ ...base, unificadoCom: 123 }, "2026-09"), false);
});

test("contrato da planilha → vocabulário da Sólides que o motor entende", () => {
  assert.equal(contratoDaPlanilha("PJ"), "Prestador de Serviço");
  assert.equal(contratoDaPlanilha("ESTÁGIO"), "Estagiário");
  assert.equal(contratoDaPlanilha("AFASTADO"), "CLT");
  assert.equal(contratoDaPlanilha("LICENÇA MATERNIDADE"), "CLT");
  assert.equal(contratoDaPlanilha("CLT"), "CLT");
});

test("empresa do rótulo da planilha: a da maioria de quem casou; empate não decide", () => {
  const m = empresasPorRotulo([
    { rotulo: "V EVENTOS", companyId: "ve" },
    { rotulo: "v eventos", companyId: "ve" },
    { rotulo: "V EVENTOS", companyId: "outra" },
    { rotulo: "CUBO", companyId: "feat" },
    { rotulo: "UTB", companyId: "a" },
    { rotulo: "UTB", companyId: "b" },
  ]);
  assert.equal(m.get("v eventos"), "ve");
  assert.equal(m.get("cubo"), "feat");
  assert.equal(m.has("utb"), false);
});

test("validarAvulso: nome obrigatório, CPF de 11 dígitos, desligamento depois da admissão", () => {
  const ok = { nome: "  Fulano  de Tal ", cpf: "123.456.789-01", setor: "", tipoContrato: "CLT", salario: 3000.555, nascimento: null, admissao: "2026-01-01", desligamento: null, observacao: null };
  const v = validarAvulso(ok);
  assert.equal(v.nome, "Fulano de Tal");
  assert.equal(v.cpf, "12345678901");
  assert.equal(v.setor, null);
  assert.equal(v.salario, 3000.56);
  assert.throws(() => validarAvulso({ ...ok, nome: " " }), /nome/);
  assert.throws(() => validarAvulso({ ...ok, cpf: "123" }), /CPF/);
  assert.throws(() => validarAvulso({ ...ok, desligamento: "2025-12-31" }), /antes da admissão/);
});
