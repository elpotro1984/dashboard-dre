import assert from "node:assert/strict";
import { test } from "node:test";
import {
  comEventosPreHubfeat,
  EVENTOS_NAO_OFICIAIS,
  EVENTOS_PRE_HUBFEAT_EM_ABERTO,
  fetchHubfeatFechamentosAbertos,
  parseHubfeatFechamentos,
  semEventosNaoOficiais,
} from "./feat-fechamentos-hubfeat";
import { fechamentosSubtitulo, fechamentosVisiveis } from "./feat-fechamentos-texto";

const RESPOSTA = {
  consultado_em: "2026-10-13T13:05:00.000Z",
  quantidade: 2,
  total: 999, // ignorado: o total é a soma das linhas listadas
  eventos: [
    { nome: "FESTIVAL ", resultado_projetado: 300000.456, imposto_lancado: true },
    { nome: "", resultado_projetado: -1000, imposto_lancado: false },
  ],
};

test("lê eventos, arredonda e soma o total a partir das linhas", () => {
  const r = parseHubfeatFechamentos(RESPOSTA);
  assert.ok(r);
  assert.deepEqual(r.eventos, [
    { projeto: "FESTIVAL", resultadoPrevisto: 300000.46, impostoLancado: true },
    { projeto: "(sem nome)", resultadoPrevisto: -1000, impostoLancado: false },
  ]);
  assert.equal(r.total, 299000.46);
  assert.equal(r.consultadoEm, "2026-10-13T13:05:00.000Z");
});

test("lista vazia é resposta válida (nenhum fechamento em aberto)", () => {
  const r = parseHubfeatFechamentos({ eventos: [] });
  assert.ok(r);
  assert.equal(r.total, 0);
  assert.equal(r.eventos.length, 0);
});

test("formato inesperado → null (seção omitida)", () => {
  assert.equal(parseHubfeatFechamentos(null), null);
  assert.equal(parseHubfeatFechamentos({ error: "x" }), null);
  assert.equal(parseHubfeatFechamentos({ eventos: [{ nome: "A", resultado_projetado: "abc" }] }), null);
  // HTML da tela de login (rota não publicada) chega como texto, não objeto.
  assert.equal(parseHubfeatFechamentos("<html>"), null);
});

test("sem configuração não chama a rede e devolve null", async () => {
  assert.equal(await fetchHubfeatFechamentosAbertos({}), null);
  assert.equal(await fetchHubfeatFechamentosAbertos({ HUBFEAT_API_URL: "https://x" }), null);
});

test("subtítulo em horário de Brasília; relatório antigo mantém o texto antigo", () => {
  assert.equal(
    fechamentosSubtitulo({
      referenciaLabel: "set/2026",
      fechamentosFonte: "hubfeat",
      fechamentosConsultadoEm: "2026-10-13T13:05:00.000Z",
    }),
    "Situação atual no Hub Feat (Tabulação), consultada em 13/10/2026 às 10:05.",
  );
  assert.equal(
    fechamentosSubtitulo({ referenciaLabel: "set/2026" }),
    "Eventos realizados sem fechamento concluído até set/2026.",
  );
  assert.equal(fechamentosVisiveis({ referenciaLabel: "x" }), true);
  assert.equal(fechamentosVisiveis({ referenciaLabel: "x", fechamentosDisponivel: false }), false);
});

test("evento pré-hubfeat entra na lista e no total", () => {
  const r = comEventosPreHubfeat(
    { eventos: [{ projeto: "SHOW X", resultadoPrevisto: 100, impostoLancado: true }], total: 100, consultadoEm: "t" },
    [{ projeto: "FESTIVAL DE VERÃO", resultadoPrevisto: 733034.16, impostoLancado: true }],
  );
  assert.deepEqual(r.eventos.map((e) => e.projeto), ["SHOW X", "FESTIVAL DE VERÃO"]);
  assert.equal(r.total, 733134.16);
});

test("se o hubfeat já listar o evento (sem acento/caixa diferente), não duplica", () => {
  const r = comEventosPreHubfeat(
    { eventos: [{ projeto: "Festival de Verao", resultadoPrevisto: 5, impostoLancado: true }], total: 5, consultadoEm: "t" },
    [{ projeto: "FESTIVAL DE VERÃO", resultadoPrevisto: 733034.16, impostoLancado: true }],
  );
  assert.equal(r.eventos.length, 1);
  assert.equal(r.total, 5);
});

test("lista fixa atual: FESTIVAL DE VERÃO com R$ 733.034,16", () => {
  assert.deepEqual(EVENTOS_PRE_HUBFEAT_EM_ABERTO, [
    { projeto: "FESTIVAL DE VERÃO", resultadoPrevisto: 733034.16, impostoLancado: true },
  ]);
});

test("evento não oficial sai da lista e do total (nome com sufixo, sem acento/caixa)", () => {
  const r = semEventosNaoOficiais(
    {
      eventos: [
        { projeto: "Xique Xique 2026 - Expominas", resultadoPrevisto: 50000, impostoLancado: true },
        { projeto: "SHOW X", resultadoPrevisto: 100, impostoLancado: true },
      ],
      total: 50100,
      consultadoEm: "t",
    },
    ["XIQUE XIQUE 2026"],
  );
  assert.deepEqual(r.eventos.map((e) => e.projeto), ["SHOW X"]);
  assert.equal(r.total, 100);
});

test("lista de não oficiais atual: XIQUE XIQUE 2026", () => {
  assert.deepEqual(EVENTOS_NAO_OFICIAIS, ["XIQUE XIQUE 2026"]);
});
