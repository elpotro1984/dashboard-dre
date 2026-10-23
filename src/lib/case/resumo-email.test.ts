import test from "node:test";
import assert from "node:assert/strict";

import type { ContractDetail, ContractTitleRow } from "./queries";
import type { Signatario } from "./signatarios";
import {
  limitarAnexos,
  linhaDoFuturo,
  linhaDoPassado,
  montarResumoContrato,
  pendencias,
  planoDeAnexos,
  situacaoTitulo,
  tituloDoContrato,
  totaisDoLado,
} from "./resumo-email";

function titulo(p: Partial<ContractTitleRow>): ContractTitleRow {
  return {
    id: "t",
    leg: "receber_custodia",
    title_item: null,
    parcela_numero: 1,
    parcela_total: 1,
    vencimento: "2026-11-10",
    valor: 1000,
    status: "lancado",
    omie_codigo: 1,
    pago: false,
    omie_status: null,
    pago_em: null,
    atracao_id: null,
    atracao_nome: null,
    fornecedor_id: null,
    fornecedor_nome: null,
    fornecedor_tipo: null,
    ...p,
  };
}

function contrato(p: Partial<ContractDetail> = {}): ContractDetail {
  return {
    id: "c1",
    contract_number: 20,
    status: "lancado",
    contratante: { fundo: "Medicina UFV", respLegal: "Ana", cpfResp: null, email: "ana@x.com", proprio: false },
    event_name: "BAILE - MED 11 UFV",
    event_date: "2027-02-06",
    show_time: "23h",
    passagem_som: null,
    local_name: "Clube",
    local_city: "Viçosa/MG",
    valor_atracao_cliente: 20000,
    valor_rider: 0,
    valor_camarim: 0,
    valor_extras: 0,
    valor_artista: 0,
    valor_custodia: 0,
    valor_margem: 0,
    valor_servicos: 0,
    total_venda: 20000,
    receber_schedule: [],
    attachment_path: null,
    sale_contract_path: "x/sale.pdf",
    sign_url: null,
    signed_at: "2026-10-21T22:20:27Z",
    bv_lancado_valor: null,
    bv_lancado_at: null,
    sent_for_signature_at: "2026-10-16T14:57:35Z",
    clicksign_status: "auto_close",
    approval_requested_at: null,
    approval_requested_by_name: null,
    approved_at: null,
    client: {
      id: "cl",
      name: "Medicina UFV <T11>",
      cnpj_cpf: "12345678000190",
      pessoa_fisica: false,
      email: "ana@x.com",
      phone: null,
      resp_legal: "Ana",
      cpf_resp_legal: "12345678901",
      endereco: null,
      cidade_estado: null,
      cep: null,
    },
    band_id: null,
    band: { name: "—", cnpj_cpf: null },
    atracoes: [],
    valor_rider_camarim: 0,
    fornecedores: [],
    titles: [],
    ...p,
  };
}

const atracao = (p: Partial<ContractDetail["atracoes"][number]> = {}): ContractDetail["atracoes"][number] => ({
  id: "a1",
  band_id: "b1",
  band_name: "FORMULA 7 LTDA",
  nome_atracao: "Banda Lucky",
  band_cnpj_cpf: null,
  attachment_path: "x/artista.pdf",
  valor_artista: 12000,
  pagar_schedule: [],
  ...p,
});

test("título é o da tela: atrações quando houver, senão o evento", () => {
  assert.equal(tituloDoContrato(contrato()), "Contrato #20 — BAILE - MED 11 UFV");
  assert.equal(
    tituloDoContrato(contrato({ atracoes: [atracao(), atracao({ id: "a2", nome_atracao: null, band_name: "DJ Y" })] })),
    "Contrato #20 — Banda Lucky, DJ Y",
  );
});

test("o assunto do e-mail é exatamente o título", () => {
  const { subject } = montarResumoContrato({
    detail: contrato(),
    historico: [],
    signatarios: null,
    hoje: "2026-10-23",
    appUrl: "https://app",
    enviadoPor: "Marcelo",
    enviadoEm: "2026-10-23T13:00:00Z",
    anexos: [],
  });
  assert.equal(subject, tituloDoContrato(contrato()));
});

test("anexos: o mesmo arquivo não vai duas vezes e o nome não leva barra", () => {
  const plano = planoDeAnexos(
    contrato({ attachment_path: "x/artista.pdf", atracoes: [atracao({ nome_atracao: "AC/DC" })] }),
  );
  assert.equal(plano.length, 1);
  assert.equal(plano[0].nome, "Contrato atração - AC DC.pdf");
});

test("anexos: o que estoura o teto fica de fora, mas um menor depois ainda entra", () => {
  const { dentro, fora } = limitarAnexos(
    [
      { n: "a", tamanho: 6 },
      { n: "b", tamanho: 6 },
      { n: "c", tamanho: 3 },
    ],
    10,
  );
  assert.deepEqual(dentro.map((x) => x.n), ["a", "c"]);
  assert.deepEqual(fora.map((x) => x.n), ["b"]);
});

test("situação do título: pago, vencido, a vencer e não lançado", () => {
  const hoje = "2026-10-23";
  assert.equal(situacaoTitulo(titulo({ pago: true, vencimento: "2026-01-01" }), hoje), "pago");
  assert.equal(situacaoTitulo(titulo({ vencimento: "2026-10-22" }), hoje), "vencido");
  assert.equal(situacaoTitulo(titulo({ vencimento: "2026-10-23" }), hoje), "a_vencer");
  assert.equal(situacaoTitulo(titulo({ status: "pendente", vencimento: "2026-01-01" }), hoje), "nao_lancado");
});

test("totais separam pago, em aberto e vencido", () => {
  const t = totaisDoLado(
    [
      titulo({ valor: 100, pago: true }),
      titulo({ valor: 200, vencimento: "2026-10-01" }),
      titulo({ valor: 300, vencimento: "2026-12-01" }),
    ],
    "2026-10-23",
  );
  assert.deepEqual(t, { total: 600, pago: 100, emAberto: 500, vencido: 200 });
});

test("pendências: sem atração, pede o Contrato Atração e não sugere BV", () => {
  const p = pendencias(contrato({ titles: [titulo({})] }), null);
  assert.ok(p.some((x) => /Contrato Atração/.test(x)));
  assert.ok(!p.some((x) => /BV/.test(x)));
});

test("pendências: aguardando assinatura nomeia quem falta", () => {
  const sig: Signatario[] = [
    { nome: "Ana", email: "a", papel: "Contratante", grupo: 1, assinadoEm: "2026-10-20T10:00:00-03:00", situacao: "assinou" },
    { nome: "Pedro", email: "p", papel: "Contratado", grupo: 2, assinadoEm: null, situacao: "na_fila" },
  ];
  const p = pendencias(contrato({ status: "aguardando_assinatura", signed_at: null, atracoes: [atracao()] }), sig);
  assert.ok(p.some((x) => x === "Assinatura na ClickSign — falta: Pedro (Contratado)."));
});

test("pendências: tudo lançado e BV positivo ainda não lançado → lançar BV", () => {
  const p = pendencias(
    contrato({
      atracoes: [atracao()],
      titles: [titulo({ valor: 20000 }), titulo({ leg: "pagar_custodia", valor: 12000 })],
    }),
    null,
  );
  assert.deepEqual(p, ["Apurar e lançar o BV no Omie (R$ 8.000,00)."]);
});

test("passado: repetição do webhook em minutos vira um evento só, e o pagamento entra no dia certo", () => {
  const eventos = linhaDoPassado(
    contrato({ titles: [titulo({ pago: true, pago_em: "2026-10-22T00:00:00Z" })] }),
    [
      { action: "assinado", comment: "Contrato assinado pelo cliente (ClickSign).", created_at: "2026-10-21T22:19:34Z", user_name: null },
      { action: "erro", comment: "Falha Omie", created_at: "2026-10-21T22:19:35Z", user_name: null },
      { action: "assinado", comment: "Contrato assinado pelo cliente (ClickSign).", created_at: "2026-10-21T22:20:04Z", user_name: null },
    ],
    null,
  );
  assert.equal(eventos.filter((e) => /assinado pelo cliente/.test(e.texto)).length, 1);
  const pagamento = eventos.find((e) => e.texto.startsWith("Recebido"));
  // pago_em é meia-noite UTC: em Brasília seria 21h do dia anterior se lido como instante.
  assert.equal(pagamento?.data, "22/10/2026");
  assert.equal(eventos[eventos.length - 1], pagamento);
});

test("futuro: vencido aparece como alerta, pago some, evento entra na data", () => {
  const f = linhaDoFuturo(
    contrato({
      titles: [
        titulo({ id: "1", vencimento: "2026-10-01" }),
        titulo({ id: "2", vencimento: "2026-11-01", pago: true }),
        titulo({ id: "3", vencimento: "2026-12-01" }),
      ],
    }),
    "2026-10-23",
  );
  assert.equal(f.length, 3);
  assert.match(f[0].texto, /^VENCIDO/);
  assert.equal(f[0].tom, "alerta");
  assert.match(f[2].texto, /^Evento: BAILE/);
});

test("HTML escapa o que vem do cadastro e lista o anexo que ficou de fora", () => {
  const { html } = montarResumoContrato({
    detail: contrato(),
    historico: [],
    signatarios: null,
    hoje: "2026-10-23",
    appUrl: "https://app",
    enviadoPor: "Marcelo",
    enviadoEm: "2026-10-23T13:00:00Z",
    anexos: [{ nome: "grande.pdf", anexado: false, motivo: "e-mail ficaria grande demais" }],
  });
  assert.ok(html.includes("Medicina UFV &lt;T11&gt;"));
  assert.ok(!html.includes("<T11>"));
  assert.match(html, /grande\.pdf<span[^>]*> — não anexado \(e-mail ficaria grande demais\)/);
  assert.ok(html.includes("https://app/case/contratos/c1"));
});
