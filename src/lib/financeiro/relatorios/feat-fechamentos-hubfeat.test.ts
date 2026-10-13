import assert from "node:assert/strict";
import { test } from "node:test";
import {
  fetchHubfeatFechamentosAbertos,
  parseHubfeatFechamentos,
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
