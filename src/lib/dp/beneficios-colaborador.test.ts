import assert from "node:assert/strict";
import { test } from "node:test";

import {
  avaliarFilhos,
  BENEFICIOS_COLABORADOR_VAZIO,
  conferirComEmpresa,
  ehFilho,
  lerBeneficiosColaborador,
  resolverBeneficios,
  unidadeDoDestino,
  validarBeneficiosColaborador,
  type DpBeneficiosColaborador,
} from "@/lib/dp/beneficios-colaborador";
import { BENEFICIOS_VAZIOS, type DpBeneficiosDados } from "@/lib/dp/beneficios-config";

const HOJE = "2026-10-28";

const CFG: DpBeneficiosDados = {
  alimentacao: { regra: "diario", faixas: [{ id: "va1", nome: "Operacional", valor: 20.85 }] },
  transporte: { descontar6: true, bilhetes: [{ id: "vt1", nome: "Bilhete BH", valor: 11 }] },
  gasolina: { faixas: [{ id: "g1", de: 0, ate: 10, valor: 150 }, { id: "g2", de: 10.01, ate: null, valor: 300 }] },
  carona: { faixas: [{ id: "c1", de: 0, ate: 20, valor: 80 }] },
  home_office: { porDias: [{ id: "h1", dias: 1, valor: 20 }, { id: "h2", dias: 3, valor: 10 }] },
  sesi: { modalidades: [{ id: "s1", nome: "Individual", valor: 45 }] },
  salario_familia: { cota: 67.54, limite: 1980.38, vigencia: "2026", fonte: null },
  assiduidade: { valor: 100 },
};

const ok = <T,>(r: { ok: T } | { erro: string }): T => {
  if ("erro" in r) throw new Error(r.erro);
  return r.ok;
};
const erro = (r: { ok: unknown } | { erro: string }) => ("erro" in r ? r.erro : null);

const escolhas = (p: Partial<DpBeneficiosColaborador>): DpBeneficiosColaborador => ({ ...BENEFICIOS_COLABORADOR_VAZIO, ...p });
const PESSOA = { tipoContrato: "CLT", salario: 1800, dependentes: [] };

test("validação: escolhas por id, home office por dias, filhos e outros", () => {
  const v = ok(
    validarBeneficiosColaborador(
      {
        alimentacao: { id: "va1", nome: "Operacional" },
        transporte: { id: "" },
        homeOfficeDias: "3",
        assiduidade: true,
        filhos: [{ id: "f", nome: "  Ana  Souza ", nascimento: "2015-03-12", invalido: false }],
        outros: [{ id: "o", rotulo: "Complemento", valor: "5.5", destino: "alimentacao" }],
      },
      HOJE,
    ),
  );
  assert.deepEqual(v.alimentacao, { id: "va1", nome: "Operacional" });
  assert.equal(v.transporte, null, "id vazio = sem escolha");
  assert.equal(v.homeOfficeDias, 3);
  assert.equal(v.filhos[0].nome, "Ana Souza");
  assert.deepEqual(v.outros[0], { id: "o", rotulo: "Complemento", valor: 5.5, destino: "alimentacao" });

  assert.match(erro(validarBeneficiosColaborador({ homeOfficeDias: 8 }, HOJE)) ?? "", /0 a 7/);
  assert.match(erro(validarBeneficiosColaborador({ filhos: [{ nome: "A" }] }, HOJE)) ?? "", /informe o nascimento/);
  assert.match(erro(validarBeneficiosColaborador({ filhos: [{ nome: "A", nascimento: "2015-02-30" }] }, HOJE)) ?? "", /inválida/);
  assert.match(erro(validarBeneficiosColaborador({ filhos: [{ nome: "A", nascimento: "2027-01-01" }] }, HOJE)) ?? "", /futuro/);
  assert.match(
    erro(validarBeneficiosColaborador({ filhos: [{ nome: "Ana", nascimento: "2015-01-01" }, { nome: "ANA", nascimento: "2016-01-01" }] }, HOJE)) ?? "",
    /duas vezes/,
  );
  assert.match(erro(validarBeneficiosColaborador({ outros: [{ rotulo: "X", valor: 0, destino: "separado" }] }, HOJE)) ?? "", /maior que zero/);
  assert.match(erro(validarBeneficiosColaborador({ outros: [{ rotulo: "X", valor: 10, destino: "qualquer" }] }, HOJE)) ?? "", /para onde vai/);
  assert.match(erro(validarBeneficiosColaborador({ outros: [{ rotulo: "", valor: 10, destino: "separado" }] }, HOJE)) ?? "", /rótulo/);
});

test("leitura do banco: o que não passa na validação vira o vazio, sem derrubar a ficha", () => {
  assert.deepEqual(lerBeneficiosColaborador({ homeOfficeDias: 99 }), BENEFICIOS_COLABORADOR_VAZIO);
  assert.deepEqual(lerBeneficiosColaborador(null), BENEFICIOS_COLABORADOR_VAZIO);
});

test("conferência: toda escolha tem de existir no cadastro ATUAL da empresa", () => {
  assert.equal(conferirComEmpresa(escolhas({ alimentacao: { id: "va1", nome: "Operacional" }, homeOfficeDias: 1, assiduidade: true }), CFG), null);
  assert.match(conferirComEmpresa(escolhas({ alimentacao: { id: "sumiu", nome: "Antiga" } }), CFG) ?? "", /“Antiga” não existe mais/);
  assert.match(conferirComEmpresa(escolhas({ gasolina: { id: "x", nome: "" } }), CFG) ?? "", /Auxílio gasolina/);
  assert.match(conferirComEmpresa(escolhas({ homeOfficeDias: 2 }), CFG) ?? "", /2 dias presenciais/);
  assert.match(conferirComEmpresa(escolhas({ assiduidade: true }), BENEFICIOS_VAZIOS) ?? "", /Assiduidade/);
});

test("o valor vem da EMPRESA na leitura: reajustar o bloco muda o benefício de quem o escolheu", () => {
  const e = escolhas({ sesi: { id: "s1", nome: "Individual" } });
  assert.equal(resolverBeneficios({ cfg: CFG, escolhas: e, pessoa: PESSOA, hoje: HOJE }).linhas.find((l) => l.bloco === "sesi")!.base, 45);
  const reajustado = { ...CFG, sesi: { modalidades: [{ id: "s1", nome: "Individual (2027)", valor: 49.5 }] } };
  const l = resolverBeneficios({ cfg: reajustado, escolhas: e, pessoa: PESSOA, hoje: HOJE }).linhas.find((x) => x.bloco === "sesi")!;
  assert.equal(l.base, 49.5);
  assert.equal(l.escolha, "Individual (2027)", "o nome também é o de hoje");
});

test("opção removida da empresa: valor zero com aviso, nomeando qual era", () => {
  const r = resolverBeneficios({ cfg: CFG, escolhas: escolhas({ alimentacao: { id: "sumiu", nome: "Antiga" } }), pessoa: PESSOA, hoje: HOJE });
  const va = r.linhas.find((l) => l.bloco === "alimentacao")!;
  assert.equal(va.base, 0);
  assert.match(va.aviso ?? "", /“Antiga” não existe mais/);
});

test("unidades: VT por dia, VA pela regra da empresa, o resto no mês — e NENHUM total (é da tela de gestão)", () => {
  assert.equal(unidadeDoDestino(CFG, "transporte"), "dia");
  assert.equal(unidadeDoDestino(CFG, "alimentacao"), "dia");
  assert.equal(unidadeDoDestino({ ...CFG, alimentacao: { ...CFG.alimentacao, regra: "fixo" } }, "alimentacao"), "mes");
  assert.equal(unidadeDoDestino(CFG, "separado"), "mes");

  const r = resolverBeneficios({
    cfg: CFG,
    escolhas: escolhas({
      alimentacao: { id: "va1", nome: "" },
      transporte: { id: "vt1", nome: "" },
      gasolina: { id: "g2", nome: "" },
      homeOfficeDias: 1,
      sesi: { id: "s1", nome: "" },
      assiduidade: true,
    }),
    pessoa: PESSOA,
    hoje: HOJE,
  });
  assert.deepEqual(Object.keys(r).sort(), ["filhos", "linhas", "separados"], "sem total: quanto a pessoa recebe é conta da tela de gestão");
  const val = (b: string) => r.linhas.find((l) => l.bloco === b)!;
  assert.deepEqual([val("alimentacao").valor, val("alimentacao").unidade], [20.85, "dia"]);
  assert.deepEqual([val("transporte").valor, val("transporte").unidade], [11, "dia"]);
  assert.deepEqual([val("gasolina").valor, val("gasolina").unidade], [300, "mes"]);
  assert.deepEqual([val("home_office").valor, val("home_office").unidade], [20, "mes"]);
  assert.deepEqual([val("assiduidade").valor, val("assiduidade").unidade], [100, "mes"]);
  assert.equal(r.linhas.length, 8, "as oito linhas, sempre");
  assert.equal(r.linhas.find((l) => l.bloco === "gasolina")!.escolha, "acima de 10,01 km");
  assert.equal(r.linhas.find((l) => l.bloco === "home_office")!.escolha, "1 dia presencial");
});

test("outros benefícios: somam no destino, na unidade dele; 'Separado' não soma a nenhum", () => {
  const r = resolverBeneficios({
    cfg: CFG,
    escolhas: escolhas({
      alimentacao: { id: "va1", nome: "" },
      outros: [
        { id: "1", rotulo: "Complemento VA", valor: 4.15, destino: "alimentacao" },
        { id: "2", rotulo: "Bônus gasolina", valor: 50, destino: "gasolina" },
        { id: "3", rotulo: "Auxílio creche", valor: 300, destino: "separado" },
      ],
    }),
    pessoa: PESSOA,
    hoje: HOJE,
  });
  const va = r.linhas.find((l) => l.bloco === "alimentacao")!;
  assert.equal(va.valor, 25, "20,85 + 4,15 por dia");
  assert.deepEqual(va.outros, [{ rotulo: "Complemento VA", valor: 4.15 }]);
  const g = r.linhas.find((l) => l.bloco === "gasolina")!;
  assert.equal(g.base, 0, "sem faixa escolhida, a linha leva só o 'outro'");
  assert.equal(g.valor, 50);
  assert.deepEqual(r.separados, [{ rotulo: "Auxílio creche", valor: 300 }]);
  assert.equal(r.linhas.reduce((s, l) => s + l.outros.length, 0), 2, "o separado não entrou em linha nenhuma");
});

test("salário-família: filhos da Sólides até 14 anos; o mês do aniversário de 14 ainda conta", () => {
  assert.equal(ehFilho("Filho/Enteado"), true);
  assert.equal(ehFilho("Conjuge"), false);
  const f = avaliarFilhos(
    [
      { nome: "Bia", nascimento: "2012-10-05", parentesco: "Filho/Enteado" }, // faz 14 em out/2026: ainda conta
      { nome: "Caio", nascimento: "2012-09-30", parentesco: "Filho/Enteado" }, // fez 14 em set/2026: não conta mais
      { nome: "Rui", nascimento: "1990-01-01", parentesco: "Conjuge" },
    ],
    [],
    HOJE,
  );
  assert.deepEqual(f.map((x) => [x.nome, x.conta]), [["Bia", true], ["Caio", false]]);
  assert.match(f[1].motivo, /completou 14 anos em 09\/2026/);
});

test("salário-família: o filho cadastrado aqui vence o da Sólides de mesmo nome (corrige data, marca inválido)", () => {
  const f = avaliarFilhos(
    [{ nome: "Caio Lima", nascimento: "2000-01-01", parentesco: "Filho/Enteado" }],
    [
      { id: "1", nome: "caio  lima", nascimento: "2000-01-01", invalido: true },
      { id: "2", nome: "Duda", nascimento: "2020-05-05", invalido: false },
    ],
    HOJE,
  );
  assert.deepEqual(f.map((x) => [x.nome, x.origem, x.conta]), [["caio  lima", "ficha", true], ["Duda", "ficha", true]]);
});

test("salário-família: cota × filhos para CLT dentro do limite; nada acima do limite ou fora da CLT", () => {
  const dois = escolhas({ filhos: [{ id: "1", nome: "A", nascimento: "2018-01-01", invalido: false }, { id: "2", nome: "B", nascimento: "2020-01-01", invalido: false }] });
  const sf = (pessoa: { tipoContrato: string | null; salario: number | null }) =>
    resolverBeneficios({ cfg: CFG, escolhas: dois, pessoa: { ...pessoa, dependentes: [] }, hoje: HOJE }).linhas.find((l) => l.bloco === "salario_familia")!;

  const clt = sf({ tipoContrato: "CLT", salario: 1800 });
  assert.equal(clt.base, 135.08);
  assert.equal(clt.escolha, "2 filhos");
  assert.equal(clt.unidade, "mes");

  assert.equal(sf({ tipoContrato: "Jovem Aprendiz", salario: 900 }).base, 135.08, "aprendiz é empregado");
  assert.match(sf({ tipoContrato: "CLT", salario: 2500 }).detalhe ?? "", /acima do limite/);
  assert.equal(sf({ tipoContrato: "CLT", salario: 2500 }).base, 0);
  assert.equal(sf({ tipoContrato: "Prestador de Serviço", salario: 1000 }).base, 0);
  assert.equal(sf({ tipoContrato: "Estagiário", salario: 1000 }).base, 0);

  const semTipo = sf({ tipoContrato: null, salario: 1800 });
  assert.equal(semTipo.base, 135.08, "sem tipo = CLT, como no motor da folha");
  assert.match(semTipo.aviso ?? "", /considerado CLT/);

  const semSalario = sf({ tipoContrato: "CLT", salario: null });
  assert.equal(semSalario.base, 135.08, "sem salário o limite não é conferido, como no motor");
  assert.match(semSalario.aviso ?? "", /não foi conferido/);

  const semCota = resolverBeneficios({
    cfg: { ...CFG, salario_familia: { ...CFG.salario_familia, cota: null } },
    escolhas: dois,
    pessoa: PESSOA,
    hoje: HOJE,
  }).linhas.find((l) => l.bloco === "salario_familia")!;
  assert.equal(semCota.base, 0);
  assert.match(semCota.aviso ?? "", /cota/);
});
