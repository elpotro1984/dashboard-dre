import { NO_VIVA_CAPABILITIES, type ReportTemplate } from "./report-template-types";

// ============================================================================
// Template Real Estate — SGX (locações + projetos imobiliários)
// ============================================================================

const SGX_SYSTEM_CONTEXT = `CONTEXTO DA EMPRESA — SGX (Real Estate):
A SGX possui ativos imobiliários geradores de receita por LOCAÇÕES e, em paralelo, PROJETOS imobiliários em desenvolvimento (terrenos, obras, canteiros, despesas pré-operacionais).

A separação por frente JÁ ESTÁ MAPEADA e os números oficiais de cada frente chegam no input (campo "indicadores_relatorio"): Resultado com Locações, Resultado Operacional, Resultado Projetos e Resultado Final. Analise SEMPRE as duas frentes usando esses números:
- Resultado — Locações: receitas de aluguel menos despesas dos imóveis locados.
- Resultado — Projetos: receitas e despesas vinculadas a projetos, terrenos, obras e desenvolvimento.
- Resultado Final (consolidado) = Locações + Operacional + Projetos.

O relatório deve responder:
- A operação de locações está se sustentando? Os imóveis alugados geram resultado positivo?
- Qual é o RESULTADO DOS PROJETOS no período e como ele se comporta?
- O resultado final está pressionado pela operação recorrente (locações) ou pelos projetos em desenvolvimento?

REGRAS:
- NÃO use conceitos de Franquias Viva (VVR, FEE disponível, margem média de eventos, sobrevivência de caixa) — eles não se aplicam à SGX.
- Fale do RESULTADO DOS PROJETOS diretamente, como um número do período (o valor está no input). É PROIBIDO dizer que a separação por frente, o resultado dos projetos ou o consolidado "depende de mapeamento de contas", "está a confirmar" ou "ainda precisa ser detalhado" — o mapeamento está CONFIRMADO. Nunca inclua ressalva desse tipo no diagnóstico nem em nenhum outro campo.
- NÃO invente números: use os valores do input exatamente como vierem.`;

export const realEstateSgxTemplate: ReportTemplate = {
  id: "real-estate-sgx",
  name: "Real Estate — SGX",
  segment: "real-estate",
  description: "SGX: locações recorrentes + projetos imobiliários em desenvolvimento.",
  priority: 100,
  matches: (ctx) =>
    ctx.companyNameLower === "sgx" ||
    (ctx.segmentSlug === "real-estate" && ctx.companyNameLower.includes("sgx")),

  capabilities: { ...NO_VIVA_CAPABILITIES },
  prompt: { kind: "custom", systemContext: SGX_SYSTEM_CONTEXT },

  expectedKpis: [
    { key: "receita_locacoes", label: "Receita de Locações", source: "todo" },
    { key: "resultado_locacoes", label: "Resultado Locações", source: "todo" },
    { key: "despesas_projetos", label: "Despesas com Projetos", source: "todo" },
    { key: "resultado_projetos", label: "Resultado Projetos", source: "todo" },
    { key: "resultado_consolidado", label: "Resultado Consolidado", source: "core-resultado" },
  ],
  expectedCharts: [
    { key: "resultado_por_frente", title: "Resultado por frente (Locações, Projetos, Administrativo, Consolidado)", note: "TODO: depende do mapeamento por frente" },
    { key: "composicao", title: "Composição do Resultado SGX", note: "Receita de Locações (-) Despesas dos Imóveis (=) Resultado Locações (-) Despesas de Projetos (=) Resultado Consolidado" },
    { key: "historico_locacoes", title: "Histórico do Resultado das Locações", note: "TODO" },
    { key: "despesas_projetos_categoria", title: "Despesas de Projetos por categoria", note: "TODO: se as contas permitirem" },
  ],
  semaforoIndicators: ["Resultado Locações", "Resultado Projetos", "Resultado Consolidado"],
  alertHints: [
    "Resultado das locações negativo.",
    "Despesas de projetos acima do previsto.",
    "Receita de locações abaixo do orçamento.",
    "Projetos consumindo caixa acima do planejado.",
    "Resultado consolidado pressionado por despesas não recorrentes.",
  ],
  actionHints: [
    "Revisar despesas dos imóveis locados.",
    "Separar custos recorrentes de custos de desenvolvimento.",
    "Avaliar orçamento dos projetos em andamento.",
    "Monitorar consumo de caixa dos projetos.",
    "Revisar contratos de locação com baixa rentabilidade.",
  ],
  // Mapeamento CONFIRMADO pela auditoria de contas (plano custom da SGX).
  dreAccountMapping: {
    receita_locacoes: { label: "Receita com locação de imóvel", codes: ["1"], status: "confirmed" },
    despesas_imoveis: { label: "Despesas com Imóveis Locados", codes: ["2"], status: "confirmed" },
    resultado_locacoes: { label: "Resultado 1 - Locações", codes: ["3"], status: "confirmed", note: "calculado f=1-2" },
    receitas_projetos: { label: "Receitas Projetos", codes: ["12"], status: "confirmed" },
    despesas_projetos: { label: "Despesas Projetos", codes: ["13"], status: "confirmed" },
    resultado_projetos: { label: "Resultado 3 - Projetos", codes: ["14"], status: "confirmed", note: "calculado f=12-13" },
    resultado_consolidado: { label: "Resultado 4 - Locação + Operacional + Projetos", codes: ["15"], status: "confirmed", note: "calculado f=11+14" },
  },

  // ── Fase 2: relatório real da SGX por conta DRE (codes confirmados) ────────
  // Sinais: despesas chegam como magnitude POSITIVA (fórmulas usam 1-2, 12-13).
  // Reutilizamos os helpers do payload (Math.abs p/ exibir, statusDespesas...).
  report: {
    // Cards: 3 resultados (1ª linha) + Margem Líquida (2ª linha) → grade 3 cols.
    kpiCards: [
      { label: "Resultado Locações", code: "3", kind: "resultado" },
      { label: "Resultado Projetos", code: "14", kind: "resultado" },
      { label: "Resultado Final", code: "15", kind: "resultado" },
      // Margem Líquida = Resultado Final (15) / (Locações + Outras + Projetos).
      { label: "Margem Líquida", kind: "margem", ratio: { numerator: ["15"], denominator: ["1", "4", "12"] } },
    ],
    // 4 cards numa única linha (grade de 4 colunas — default).
    kpiColumns: 4,
    // A IA lê as MESMAS linhas do quadro (campo `indicadores_relatorio` do input)
    // como leitura oficial do período — é o que a deixa falar do Resultado dos
    // Projetos (e das demais frentes) com o número real, sem ressalva de
    // "mapeamento a confirmar". O mapeamento por frente está confirmado.
    sendPrevistoRealizadoToAi: true,
    // Ordem por frente (Locações → Operacional → Projetos → Final). Despesas
    // entram como magnitude positiva (padrão do gráfico). Resultados derivados
    // via `minus`: "Resultado com Locações" = Receita (1) − Despesas (2);
    // "Resultado Operacional" = Receitas Operacionais (4) − Despesas
    // Operacionais (Deduções 5 + Desp. Op. 7 + IRPJ 9 + Contrib. Social 10).
    previstoRealizado: [
      { label: "Receita com Locações", code: "1", unidade: "currency" },
      { label: "Despesas com Locações", code: "2", unidade: "currency" },
      { label: "Resultado com Locações", codes: ["1"], minus: ["2"], unidade: "currency" },
      { label: "Receitas Operacionais", code: "4", unidade: "currency" },
      { label: "Despesas Operacionais", codes: ["5", "7", "9", "10"], unidade: "currency" },
      { label: "Resultado Operacional", codes: ["4"], minus: ["5", "7", "9", "10"], unidade: "currency" },
      { label: "Receitas Projetos", code: "12", unidade: "currency" },
      { label: "Despesas Projetos", code: "13", unidade: "currency" },
      { label: "Resultado Projetos", code: "14", unidade: "currency" },
      { label: "Resultado Final", code: "15", unidade: "currency" },
    ],
    // Composição do Resultado e Semáforo removidos a pedido (não habilitados).
    // Histórico acompanha o Resultado Final (code 15).
    historicoAccountCode: "15",
    historicoTitle: "Histórico do Resultado Final",
    historicoKLabels: true,
    enabledBlocks: ["diagnostico", "previstoRealizado", "historico", "alertas", "acoes"],
    // Abaixo do histórico: dois gráficos de colunas Previsto × Realizado mensais
    // (acumulado do ano: Jan→mês de análise), por frente. Receitas − Despesas:
    //   Locações = Receita locação (1) − Despesas imóveis locados (2);
    //   Projetos = Receitas Projetos (12) − Despesas Projetos (13).
    // Cada um traz o previsto/realizado acumulado do ano + variação.
    prevRealCharts: [
      { title: "Previsto × Realizado — Locações", codes: ["1"], minus: ["2"] },
      { title: "Previsto × Realizado — Projetos", codes: ["12"], minus: ["13"] },
    ],
  },
};
