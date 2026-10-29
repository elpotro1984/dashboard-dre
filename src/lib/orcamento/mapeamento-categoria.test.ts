// O mapeamento efetivo categoria → conta que o Orçamento enxerga.

import test from "node:test";
import assert from "node:assert/strict";

import {
  resolverMapeamento,
  type LinhaMapeamento,
  type LinhaRoteada,
  type RotaAtiva,
} from "./mapeamento-categoria";

const EMP = "emp-destino";
const OUTRA = "emp-outra";
const MALL = "emp-mall";
const FEAT = "emp-feat";

const cm = (code: string, conta: string | null, company: string | null, nome = code): LinhaMapeamento => ({
  omie_category_code: code,
  omie_category_name: nome,
  dre_account_id: conta,
  company_id: company,
});
const rcm = (origem: string, depto: string, code: string, conta: string, nome = code): LinhaRoteada => ({
  source_company_id: origem,
  omie_department_code: depto,
  omie_category_code: code,
  omie_category_name: nome,
  dre_account_id: conta,
});
const rota = (origem: string, depto: string): RotaAtiva => ({ company_id: origem, omie_code: depto });

test("empresa que vive de departamento roteado enxerga as categorias do de-para roteado", () => {
  // O caso que motivou o módulo (Salvaterra Estacionamento, 29/10/2026): sem
  // Omie própria, a DRE inteira vem do ESTACIONAMENTO da Mall. Antes só as
  // globais apareciam em "Método por categoria".
  const mapa = resolverMapeamento(
    EMP,
    [cm("2.07.01", "g-invest", null)],
    [rcm(MALL, "d-est", "2.01.99", "c-mao-de-obra", "Mão de obra para Estacionamento")],
    [rota(MALL, "d-est")],
  );
  assert.deepEqual(mapa.get("2.01.99"), {
    dreAccountId: "c-mao-de-obra",
    nome: "Mão de obra para Estacionamento",
    origem: "roteado",
  });
  // As globais continuam lá.
  assert.equal(mapa.get("2.07.01")?.origem, "global");
});

test("rota DESFEITA não vale: o de-para fica no banco sem efeito", () => {
  // A DRE só aplica `routed_category_mapping` com a rota ligada. Oferecer método
  // para a categoria de uma rota desfeita seria orçar o que não compõe a DRE.
  const mapa = resolverMapeamento(
    EMP,
    [],
    [rcm(OUTRA, "d-velho", "2.06.05", "c-irpj")],
    [rota(MALL, "d-est")],
  );
  assert.equal(mapa.has("2.06.05"), false);
});

test("rota de OUTRO departamento da mesma origem não liga o de-para", () => {
  const mapa = resolverMapeamento(
    EMP,
    [],
    [rcm(MALL, "d-outro", "2.04.14", "c-limpeza")],
    [rota(MALL, "d-est")],
  );
  assert.equal(mapa.has("2.04.14"), false);
});

test("o mapeamento da própria empresa vence o roteado (a mudança é aditiva)", () => {
  // Nenhuma categoria que a empresa já mapeou muda de conta por causa do roteado.
  const mapa = resolverMapeamento(
    EMP,
    [cm("2.01.99", "c-empresa", EMP)],
    [rcm(MALL, "d-est", "2.01.99", "c-roteado")],
    [rota(MALL, "d-est")],
  );
  assert.deepEqual(mapa.get("2.01.99"), { dreAccountId: "c-empresa", nome: "2.01.99", origem: "empresa" });
});

test("o roteado vence o global", () => {
  // É o que a DRE faz com o lançamento roteado (prio 0 no refresh).
  const mapa = resolverMapeamento(
    EMP,
    [cm("1.01.99", "g-cerimonial", null)],
    [rcm(MALL, "d-est", "1.01.99", "c-receita-est")],
    [rota(MALL, "d-est")],
  );
  assert.equal(mapa.get("1.01.99")?.dreAccountId, "c-receita-est");
  assert.equal(mapa.get("1.01.99")?.origem, "roteado");
});

test("linha da empresa SEM conta esconde a global, como antes — mas não o roteado", () => {
  const semRoteado = resolverMapeamento(EMP, [cm("2.08.95", null, EMP), cm("2.08.95", "g-x", null)], [], []);
  assert.deepEqual(semRoteado.get("2.08.95"), { dreAccountId: null, nome: "2.08.95", origem: "empresa" });

  const comRoteado = resolverMapeamento(
    EMP,
    [cm("2.08.95", null, EMP)],
    [rcm(MALL, "d-est", "2.08.95", "c-rot")],
    [rota(MALL, "d-est")],
  );
  assert.equal(comRoteado.get("2.08.95")?.dreAccountId, "c-rot");
});

test("mapeamento de OUTRA empresa não entra", () => {
  const mapa = resolverMapeamento(EMP, [cm("2.04.14", "c-outra", OUTRA)], [], []);
  assert.equal(mapa.size, 0);
});

test("o mesmo código vindo de duas origens não depende da ordem das linhas", () => {
  const linhas = [
    rcm(MALL, "d-est-mall", "2.06.07", "c-iss-mall"),
    rcm(FEAT, "d-est-feat", "2.06.07", "c-iss-feat"),
  ];
  const rotas = [rota(MALL, "d-est-mall"), rota(FEAT, "d-est-feat")];
  const ida = resolverMapeamento(EMP, [], linhas, rotas).get("2.06.07");
  const volta = resolverMapeamento(EMP, [], [...linhas].reverse(), rotas).get("2.06.07");
  assert.deepEqual(ida, volta);
});

test("as duas origens somam códigos diferentes na mesma lista", () => {
  // Salvaterra Estacionamento: "Outras Despesas Administrativas" é 2.04.97 na
  // Feat e 2.04.92 na Mall. As duas entram; a unificação das gêmeas "(*)" é
  // trabalho de `unificarGemeas`, depois.
  const mapa = resolverMapeamento(
    EMP,
    [],
    [rcm(FEAT, "d-feat", "2.04.97", "c-outras"), rcm(MALL, "d-mall", "2.04.92", "c-outras")],
    [rota(FEAT, "d-feat"), rota(MALL, "d-mall")],
  );
  assert.deepEqual(Array.from(mapa.keys()).sort(), ["2.04.92", "2.04.97"]);
});
