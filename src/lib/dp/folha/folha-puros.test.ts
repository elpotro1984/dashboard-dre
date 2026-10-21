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
import { herdarDoMesAnterior, mesclarLancamento, validarCadastro, validarFerias, validarLancamento, validarRecorrentes } from "@/lib/dp/folha/validacao";
import { colaboradorNoMes, diasComerciais, diasUteis, feriadosNacionais, feriasDoMes, intervaloNoMes } from "@/lib/dp/folha/calendario";
import { rescisoesSugeridas, variacoesContraAnterior } from "@/lib/dp/folha/conferencia";
import { lerParametros } from "@/lib/dp/folha/parametros";

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
      admissao: null,
      desligamento: null,
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
  assert.equal(b.lancamento.diasTrabalhados, null); // célula vazia = automático
  assert.equal(a.lancamento.inssFerias, 120);
  assert.equal(b.lancamento.inssFerias, null); // vazio = calculado como no recibo
  assert.equal(b.lancamento.vtDiasDesconto, 0); // vazio na planilha = VT do mês cheio
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

test("mês novo herda só a SITUAÇÃO (o que se repete com valor é fixo do cadastro)", () => {
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
  assert.equal(r.outrosDescontos, 0);
  assert.equal(r.diasFerias, null); // automático: pelas férias programadas
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

// ── calendário ────────────────────────────────────────────────────────────
test("feriados nacionais de trabalho: fixos + Sexta-feira Santa; Carnaval e Corpus Christi não", () => {
  const f = feriadosNacionais(2026);
  assert.ok(f.has("2026-09-07"));
  assert.ok(f.has("2026-11-20"));
  assert.ok(f.has("2026-04-03")); // Páscoa 2026 = 05/04
  assert.ok(!f.has("2026-02-17")); // terça de Carnaval
  assert.ok(!f.has("2026-06-04")); // Corpus Christi
});

test("dias úteis do mês: set/2026 21 (seg–sex) e 25 (seg–sáb); nov/2026 19; feriado extra desconta", () => {
  assert.equal(diasUteis("2026-09-01", "2026-09-30", 5), 21);
  assert.equal(diasUteis("2026-09-01", "2026-09-30", 6), 25);
  assert.equal(diasUteis("2026-11-01", "2026-11-30", 5), 19);
  assert.equal(diasUteis("2026-09-01", "2026-09-30", 5, new Set(["2026-09-08"])), 20);
  assert.equal(diasUteis("2026-09-30", "2026-09-01", 5), 0);
});

test("dias comerciais do contrato no mês: inteiro = 30 (até em fevereiro); pedaço = dias corridos", () => {
  assert.equal(diasComerciais(intervaloNoMes(null, null, "2026-02")), 30);
  assert.equal(diasComerciais(intervaloNoMes("2026-09-16", null, "2026-09")), 15);
  assert.equal(diasComerciais(intervaloNoMes(null, "2026-09-10", "2026-09")), 10);
  assert.equal(diasComerciais(intervaloNoMes("2026-10-31", null, "2026-10")), 1);
  assert.equal(diasComerciais(intervaloNoMes("2026-11-01", null, "2026-10")), 0);
  assert.equal(intervaloNoMes(null, "2026-08-31", "2026-09"), null);
});

test("quem entra na folha do mês: ativo sim, contratação futura não, desligado só no mês da saída", () => {
  const base = { ativo: true, admissao: "2020-01-01", desligamento: null, desligadoDetectadoEm: null, temLancamento: false };
  assert.equal(colaboradorNoMes(base, "2026-09"), true);
  assert.equal(colaboradorNoMes({ ...base, admissao: "2026-10-01" }, "2026-09"), false);
  assert.equal(colaboradorNoMes({ ...base, ativo: false, desligamento: "2026-09-12" }, "2026-09"), true);
  assert.equal(colaboradorNoMes({ ...base, ativo: false, desligamento: "2026-08-12" }, "2026-09"), false);
  assert.equal(colaboradorNoMes({ ...base, ativo: false, desligadoDetectadoEm: "2026-09-20T08:00:00Z" }, "2026-09"), true);
  assert.equal(colaboradorNoMes({ ...base, ativo: false, desligamento: "2026-08-12", temLancamento: true }, "2026-09"), true);
});

// ── conferências ─────────────────────────────────────────────────────────
test("rescisão sugerida: desligado no mês e sem rescisão lançada", () => {
  const pessoas = [
    { solidesId: 1, nome: "A", setor: null, desligamento: "2026-09-12" },
    { solidesId: 2, nome: "B", setor: null, desligamento: "2026-09-20" },
    { solidesId: 3, nome: "C", setor: null, desligamento: "2026-08-30" },
    { solidesId: 4, nome: "D", setor: null, desligamento: null },
  ];
  assert.deepEqual(rescisoesSugeridas(pessoas, [{ solidesId: 2 }], "2026-09").map((x) => x.solidesId), [1]);
});

test("variação contra o mês anterior: só acima do limite, só quem tinha valor antes", () => {
  const v = variacoesContraAnterior(
    [{ solidesId: 1, valor: 1300 }, { solidesId: 2, valor: 1100 }, { solidesId: 3, valor: 500 }, { solidesId: 4, valor: 900 }],
    [{ solidesId: 1, valor: 1000 }, { solidesId: 2, valor: 1000 }, { solidesId: 3, valor: 0 }, { solidesId: 5, valor: 1000 }],
    0.2,
  );
  assert.deepEqual(Array.from(v.keys()), [1]);
  assert.ok(Math.abs(v.get(1)!.variacao - 0.3) < 1e-9);
  assert.equal(variacoesContraAnterior([{ solidesId: 1, valor: 5000 }], [{ solidesId: 1, valor: 1000 }], 0).size, 0);
});

// ── validação dos fixos e dos automáticos ────────────────────────────────
test("fixos: descrição, valor > 0 e fim depois do início", () => {
  const ok = { id: "x", tipo: "desconto" as const, descricao: " Consignado ", valor: 200, inicio: "2026-09", fim: "2027-08" };
  assert.deepEqual(validarRecorrentes([ok])[0].descricao, "Consignado");
  assert.throws(() => validarRecorrentes([{ ...ok, descricao: "" }]), /descrição/);
  assert.throws(() => validarRecorrentes([{ ...ok, valor: 0 }]), /valor inválido/);
  assert.throws(() => validarRecorrentes([{ ...ok, fim: "2026-08" }]), /antes do início/);
  assert.throws(() => validarRecorrentes([{ ...ok, inicio: "2026-13" }]), /início/);
});

test("lançamento: dias, INSS das férias e dias de VT aceitam vazio (= automático)", () => {
  const l = validarLancamento({ ...LANCAMENTO_PADRAO, ajustes: {} });
  assert.equal(l.diasTrabalhados, null);
  assert.equal(l.inssFerias, null);
  assert.equal(l.vtDiasDesconto, null);
  assert.equal(validarLancamento({ ...LANCAMENTO_PADRAO, ajustes: {}, diasTrabalhados: 0 }).diasTrabalhados, 0);
});

test("parâmetros de vigência antiga: escala sem dias/semana é deduzida do nome", () => {
  const p = lerParametros({ escalas: [{ nome: "6 dias", diasMes: 25 }, { nome: "5 dias BH", diasMes: 21 }] });
  assert.deepEqual(p.escalas.map((e) => e.diasSemana), [6, 5]);
  assert.deepEqual(p.escalas[0].feriados, []);
  assert.equal(p.vtPeloCalendario, true);
});

// ── férias programadas ───────────────────────────────────────────────────
test("férias do mês: só a parte de cada período dentro do mês; atravessar a virada divide", () => {
  const periodos = [{ id: "1", inicio: "2026-09-21", fim: "2026-10-20" }];
  assert.equal(feriasDoMes(periodos, "2026-09").dias, 10);
  assert.equal(feriasDoMes(periodos, "2026-10").dias, 20);
  assert.equal(feriasDoMes(periodos, "2026-11").dias, 0);
  // mês de 31 dias inteiro de férias é 30 (mês comercial)
  assert.equal(feriasDoMes([{ id: "x", inicio: "2026-08-01", fim: "2026-08-31" }], "2026-08").dias, 30);
});

test("validarFerias: até 30 dias por período e sem sobreposição", () => {
  assert.equal(validarFerias([{ id: "a", inicio: "2026-09-01", fim: "2026-09-30" }]).length, 1);
  assert.throws(() => validarFerias([{ id: "a", inicio: "2026-09-01", fim: "2026-10-05" }]), /mais de 30/);
  assert.throws(() => validarFerias([{ id: "a", inicio: "2026-09-10", fim: "2026-09-01" }]), /antes do início/);
  assert.throws(
    () => validarFerias([{ id: "a", inicio: "2026-09-01", fim: "2026-09-10" }, { id: "b", inicio: "2026-09-10", fim: "2026-09-15" }]),
    /sobrepostos/,
  );
});
