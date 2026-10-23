// Resumo do contrato Case por e-mail (botão "Enviar e-mail" da tela do contrato).
// Puro e testado: recebe o detalhe já carregado, o histórico, os signatários da
// ClickSign e a lista de anexos, e devolve assunto + HTML. Quem lê o banco, baixa
// os PDFs e envia é a action (actions/resumo-email.ts).
//
// HTML só com estilo inline e tabelas: cliente de e-mail ignora <style> e CSS
// moderno.

import { fmtBRL, fmtDate, fmtDoc } from "@/lib/case/format";
import type { ContractDetail, ContractTitleRow } from "@/lib/case/queries";
import type { Signatario } from "@/lib/case/signatarios";

/**
 * Título do contrato — o mesmo da tela e do assunto do e-mail. Atrações quando
 * houver; senão o nome do evento (o contrato vai para assinatura antes de a
 * atração ser cadastrada).
 */
export function tituloDoContrato(
  c: Pick<ContractDetail, "contract_number" | "atracoes" | "event_name" | "band">,
): string {
  const nome =
    c.atracoes.length > 0
      ? c.atracoes.map((a) => a.nome_atracao || a.band_name).join(", ")
      : c.event_name ?? c.band.name;
  return `Contrato #${c.contract_number} — ${nome}`;
}

export interface HistoricoItem {
  action: string;
  comment: string | null;
  created_at: string;
  user_name: string | null;
}

export interface AnexoResumo {
  nome: string;
  anexado: boolean;
  /** Por que ficou de fora (tamanho, arquivo não encontrado…). */
  motivo?: string;
}

export interface ResumoInput {
  detail: ContractDetail;
  historico: HistoricoItem[];
  /** null = contrato sem documento na ClickSign ou consulta falhou. */
  signatarios: Signatario[] | null;
  /** YYYY-MM-DD em Brasília — decide o que está vencido. */
  hoje: string;
  appUrl: string;
  enviadoPor: string;
  /** Instante do envio (ISO). */
  enviadoEm: string;
  anexos: AnexoResumo[];
}

// ── Anexos ─────────────────────────────────────────────────────────────────

export interface AnexoPlanejado {
  path: string;
  nome: string;
}

const extensao = (path: string) => {
  const m = /\.([a-z0-9]{2,5})$/i.exec(path);
  return m ? m[1].toLowerCase() : "pdf";
};

/** Nome de arquivo seguro para anexo (sem barra, dois-pontos etc.). */
export function nomeDeArquivo(base: string, path: string): string {
  const limpo = base.replace(/[\\/:*?"<>|]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 120);
  return `${limpo || "arquivo"}.${extensao(path)}`;
}

const FORNECEDOR_TIPO: Record<string, string> = {
  rider_camarim: "Rider-Camarim",
  comissao_externa: "Comissão Externa",
  comissao_rider: "Comissão Rider",
};

/**
 * Contratos do bucket que vão anexados: o do artista (legado, no contrato), o
 * de cada atração e o de cada fornecedor. O mesmo arquivo nunca vai duas vezes
 * — a 1ª atração costuma repetir o anexo legado do contrato.
 */
export function planoDeAnexos(
  d: Pick<ContractDetail, "contract_number" | "attachment_path" | "atracoes" | "fornecedores">,
): AnexoPlanejado[] {
  const vistos = new Set<string>();
  const out: AnexoPlanejado[] = [];
  const add = (path: string | null, base: string) => {
    if (!path || vistos.has(path)) return;
    vistos.add(path);
    out.push({ path, nome: nomeDeArquivo(base, path) });
  };
  for (const a of d.atracoes) add(a.attachment_path, `Contrato atração - ${a.nome_atracao || a.band_name}`);
  add(d.attachment_path, `Contrato ${d.contract_number} - artista`);
  for (const f of d.fornecedores) add(f.attachment_path, `${FORNECEDOR_TIPO[f.tipo] ?? "Fornecedor"} - ${f.band_name}`);
  return out;
}

/**
 * Corta os anexos no teto do e-mail, na ordem recebida (o contrato do cliente
 * vem primeiro e é o que mais importa). O Resend limita a mensagem a 40 MB já
 * em base64 (+33%), então o teto em bytes crus fica abaixo disso.
 */
export function limitarAnexos<T extends { tamanho: number }>(
  arquivos: T[],
  tetoBytes: number,
): { dentro: T[]; fora: T[] } {
  const dentro: T[] = [];
  const fora: T[] = [];
  let total = 0;
  for (const a of arquivos) {
    if (total + a.tamanho <= tetoBytes) {
      dentro.push(a);
      total += a.tamanho;
    } else {
      fora.push(a);
    }
  }
  return { dentro, fora };
}

// ── Leituras do contrato ───────────────────────────────────────────────────

const STATUS_LABEL: Record<string, string> = {
  rascunho: "Rascunho",
  aguardando_aprovacao: "Aguardando aprovação",
  aguardando_assinatura: "Aguardando assinatura na ClickSign",
  assinado: "Assinado",
  lancado: "Assinado e lançado no Omie",
  parcial: "Assinado, lançado parcialmente no Omie",
  erro: "Erro no lançamento no Omie",
  cancelado: "Cancelado",
};

const LEG_LABEL: Record<string, string> = {
  receber_custodia: "Recebimento do cliente - Custódia",
  receber_servicos: "Recebimento do cliente - Serviços/BV",
  pagar_custodia: "Pagamento à atração",
};

const ITEM_LABEL: Record<string, string> = { margem: "Comissão/BV", rider: "Rider", camarim: "Camarim", extras: "Extras" };

const round2 = (n: number) => Math.round(n * 100) / 100;
const ehPagar = (t: ContractTitleRow) => t.leg === "pagar_custodia";

export function descricaoTitulo(t: ContractTitleRow): string {
  const base = t.fornecedor_tipo
    ? `Pagamento - ${FORNECEDOR_TIPO[t.fornecedor_tipo] ?? "Fornecedor"}`
    : LEG_LABEL[t.leg] ?? t.leg;
  const quem = t.atracao_nome ?? t.fornecedor_nome;
  const item = t.title_item ? ITEM_LABEL[t.title_item] ?? t.title_item : null;
  return `${base}${quem ? ` · ${quem}` : ""}${item ? ` · ${item}` : ""} (${t.parcela_numero}/${t.parcela_total})`;
}

/** Data do pagamento. `pago_em` é gravado como meia-noite UTC: só a data vale. */
const dataPagamento = (t: ContractTitleRow) => (t.pago_em ? t.pago_em.slice(0, 10) : null);

export type SituacaoTitulo = "pago" | "vencido" | "a_vencer" | "nao_lancado" | "erro";

export function situacaoTitulo(t: ContractTitleRow, hoje: string): SituacaoTitulo {
  if (t.pago) return "pago";
  if (t.status === "erro") return "erro";
  if (t.status !== "lancado") return "nao_lancado";
  return t.vencimento.slice(0, 10) < hoje ? "vencido" : "a_vencer";
}

export interface TotaisLado {
  total: number;
  pago: number;
  emAberto: number;
  vencido: number;
}

export function totaisDoLado(titulos: ContractTitleRow[], hoje: string): TotaisLado {
  const t: TotaisLado = { total: 0, pago: 0, emAberto: 0, vencido: 0 };
  for (const x of titulos) {
    t.total += x.valor;
    const s = situacaoTitulo(x, hoje);
    if (s === "pago") t.pago += x.valor;
    else {
      t.emAberto += x.valor;
      if (s === "vencido") t.vencido += x.valor;
    }
  }
  return { total: round2(t.total), pago: round2(t.pago), emAberto: round2(t.emAberto), vencido: round2(t.vencido) };
}

/** BV como o painel Financeiro apura: tudo que entra menos todas as saídas. */
export function bvApurado(titulos: ContractTitleRow[]): number {
  const receber = titulos.filter((t) => !ehPagar(t)).reduce((a, t) => a + t.valor, 0);
  const pagar = titulos.filter(ehPagar).reduce((a, t) => a + t.valor, 0);
  return round2(receber - pagar);
}

/** Passos do processo que ainda faltam (sem data). */
export function pendencias(d: ContractDetail, signatarios: Signatario[] | null): string[] {
  if (d.status === "cancelado") return [];
  const out: string[] = [];
  const assinado = Boolean(d.signed_at);

  if (d.status === "rascunho") out.push("Enviar para aprovação — depois de aprovado, o contrato segue para a ClickSign.");
  if (d.status === "aguardando_aprovacao") out.push("Aprovação do contrato, antes de seguir para a ClickSign.");
  if (!assinado && d.status === "aguardando_assinatura") {
    const faltam = (signatarios ?? []).filter((s) => s.situacao !== "assinou").map((s) => `${s.nome} (${s.papel})`);
    out.push(faltam.length > 0 ? `Assinatura na ClickSign — falta: ${faltam.join(", ")}.` : "Assinatura na ClickSign.");
  }
  if (d.atracoes.length === 0) out.push("Cadastrar o Contrato Atração (quem se apresenta e quanto recebe).");

  const pendentes = d.titles.filter((t) => t.status !== "lancado" && t.status !== "erro").length;
  const comErro = d.titles.filter((t) => t.status === "erro").length;
  if (pendentes > 0) {
    out.push(
      assinado
        ? `Lançar ${pendentes} título(s) no Omie.`
        : `Lançar ${pendentes} título(s) no Omie depois da assinatura.`,
    );
  }
  if (comErro > 0) out.push(`Corrigir ${comErro} título(s) com erro no lançamento no Omie.`);

  const bv = bvApurado(d.titles);
  if (assinado && d.atracoes.length > 0 && d.titles.length > 0 && pendentes === 0 && comErro === 0 && bv > 0 && !d.bv_lancado_at) {
    out.push(`Apurar e lançar o BV no Omie (${fmtBRL(bv)}).`);
  }
  return out;
}

// ── Linha do tempo ─────────────────────────────────────────────────────────

export interface EventoTempo {
  /** Para ordenar (ms). */
  quando: number;
  /** Já formatado: "16/10/2026 11:43" ou só "21/10/2026". */
  data: string;
  texto: string;
  quem?: string | null;
  tom?: "alerta";
}

const fmtDataHora = (iso: string) =>
  new Date(iso)
    .toLocaleString("pt-BR", {
      timeZone: "America/Sao_Paulo",
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    })
    .replace(", ", " ");

/** Data sem hora ordenada ao meio-dia de Brasília (não cai no dia anterior). */
const msDoDia = (ymd: string) => new Date(`${ymd.slice(0, 10)}T12:00:00-03:00`).getTime();

const ACAO_LABEL: Record<string, string> = {
  criado: "Contrato salvo",
  editado: "Contrato editado",
  lancado: "Lançado no Omie",
  relancado: "Relançado no Omie",
  erro: "Erro",
  cancelado: "Contrato cancelado",
  enviado_assinatura: "Enviado para assinatura",
  assinado: "Contrato assinado",
  aprovacao_solicitada: "Enviado para aprovação",
  aprovado: "Contrato aprovado",
  devolvido: "Devolvido para ajuste",
};

/** Janela em que a mesma ação com o mesmo texto conta como repetição (webhook reentregue, duplo clique). */
const JANELA_REPETICAO_MS = 10 * 60 * 1000;

/** O que já aconteceu: histórico + assinaturas na ClickSign + pagamentos, em ordem. */
export function linhaDoPassado(
  d: ContractDetail,
  historico: HistoricoItem[],
  signatarios: Signatario[] | null,
): EventoTempo[] {
  const out: EventoTempo[] = [];

  const ultimos = new Map<string, number>();
  for (const h of [...historico].sort((a, b) => a.created_at.localeCompare(b.created_at))) {
    const ms = new Date(h.created_at).getTime();
    const chave = `${h.action}|${h.comment ?? ""}`;
    const anterior = ultimos.get(chave);
    ultimos.set(chave, ms);
    if (anterior !== undefined && ms - anterior < JANELA_REPETICAO_MS) continue;
    out.push({
      quando: ms,
      data: fmtDataHora(h.created_at),
      texto: h.comment?.trim() || ACAO_LABEL[h.action] || h.action,
      quem: h.user_name,
      tom: h.action === "erro" ? "alerta" : undefined,
    });
  }

  for (const s of signatarios ?? []) {
    if (!s.assinadoEm) continue;
    out.push({ quando: new Date(s.assinadoEm).getTime(), data: fmtDataHora(s.assinadoEm), texto: `Assinou na ClickSign: ${s.nome} (${s.papel})` });
  }

  for (const t of d.titles) {
    const dia = dataPagamento(t);
    if (!t.pago || !dia) continue;
    out.push({
      quando: msDoDia(dia),
      data: fmtDate(dia),
      texto: `${ehPagar(t) ? "Pago" : "Recebido"}: ${descricaoTitulo(t)} — ${fmtBRL(t.valor)}`,
    });
  }

  return out.sort((a, b) => a.quando - b.quando);
}

/** O que tem data marcada pela frente: vencimentos em aberto (inclusive atrasados) e o evento. */
export function linhaDoFuturo(d: ContractDetail, hoje: string): EventoTempo[] {
  const out: EventoTempo[] = [];
  for (const t of d.titles) {
    if (t.pago) continue;
    const dia = t.vencimento.slice(0, 10);
    const atrasado = dia < hoje;
    out.push({
      quando: msDoDia(dia),
      data: fmtDate(dia),
      texto: `${atrasado ? "VENCIDO — " : "Vence — "}${descricaoTitulo(t)} — ${fmtBRL(t.valor)}`,
      tom: atrasado ? "alerta" : undefined,
    });
  }
  if (d.event_date && d.event_date.slice(0, 10) >= hoje) {
    const onde = [d.local_name, d.local_city].filter(Boolean).join(", ");
    out.push({
      quando: msDoDia(d.event_date),
      data: fmtDate(d.event_date),
      texto: `Evento${d.event_name ? `: ${d.event_name}` : ""}${onde ? ` — ${onde}` : ""}${d.show_time ? ` — ${d.show_time}` : ""}`,
    });
  }
  return out.sort((a, b) => a.quando - b.quando);
}

// ── HTML ───────────────────────────────────────────────────────────────────

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const COR = {
  tinta: "#111827",
  suave: "#6b7280",
  linha: "#e7e5e4",
  fundo: "#fafaf9",
  ambar: "#b45309",
  verde: "#047857",
  vermelho: "#b91c1c",
};

const secao = (titulo: string, corpo: string) =>
  `<tr><td style="padding:18px 28px 0"><div style="font-size:12px;font-weight:bold;letter-spacing:.06em;color:${COR.ambar};text-transform:uppercase;border-bottom:1px solid ${COR.linha};padding-bottom:6px;margin-bottom:8px">${esc(titulo)}</div>${corpo}</td></tr>`;

const pares = (linhas: Array<[string, string] | null>) =>
  `<table role="presentation" width="100%" cellpadding="0" cellspacing="0">${linhas
    .filter((l): l is [string, string] => l !== null)
    .map(
      ([k, v]) =>
        `<tr><td style="padding:4px 0;color:${COR.suave};font-size:13px;width:170px;vertical-align:top">${esc(k)}</td><td style="padding:4px 0;color:${COR.tinta};font-size:14px">${esc(v)}</td></tr>`,
    )
    .join("")}</table>`;

const th = (s: string, direita = false) =>
  `<th align="${direita ? "right" : "left"}" style="padding:6px 8px;font-size:11px;color:${COR.suave};text-transform:uppercase;letter-spacing:.04em;border-bottom:1px solid ${COR.linha};background:${COR.fundo}">${esc(s)}</th>`;
const td = (s: string, opts: { direita?: boolean; cor?: string; negrito?: boolean; semQuebra?: boolean } = {}) =>
  `<td align="${opts.direita ? "right" : "left"}" style="padding:6px 8px;font-size:13px;color:${opts.cor ?? COR.tinta};border-bottom:1px solid ${COR.linha};vertical-align:top${opts.negrito ? ";font-weight:bold" : ""}${opts.direita || opts.semQuebra ? ";white-space:nowrap" : ""}">${s}</td>`;
const tabela = (cabecalho: string, linhas: string) =>
  `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid ${COR.linha};border-collapse:collapse">${cabecalho}${linhas}</table>`;

const parcelasTexto = (ps: Array<{ vencimento: string; valor: number }>) =>
  ps.length === 0 ? "—" : ps.map((p) => `${fmtDate(p.vencimento)} ${fmtBRL(p.valor)}`).join("<br>");

function htmlLinhaDoTempo(eventos: EventoTempo[], vazio: string): string {
  if (eventos.length === 0) return `<div style="font-size:13px;color:${COR.suave}">${esc(vazio)}</div>`;
  return tabela(
    "",
    eventos
      .map(
        (e) =>
          `<tr>${td(esc(e.data), { cor: COR.suave, semQuebra: true })}${td(
            `${esc(e.texto)}${e.quem ? `<span style="color:${COR.suave}"> · ${esc(e.quem)}</span>` : ""}`,
            { cor: e.tom === "alerta" ? COR.vermelho : COR.tinta },
          )}</tr>`,
      )
      .join(""),
  );
}

const SITUACAO_TEXTO: Record<SituacaoTitulo, { texto: string; cor: string }> = {
  pago: { texto: "Pago", cor: COR.verde },
  vencido: { texto: "Vencido", cor: COR.vermelho },
  a_vencer: { texto: "A vencer", cor: COR.tinta },
  nao_lancado: { texto: "Não lançado no Omie", cor: COR.suave },
  erro: { texto: "Erro no lançamento", cor: COR.vermelho },
};

function htmlTitulos(rotulo: string, titulos: ContractTitleRow[], hoje: string): string {
  if (titulos.length === 0) return "";
  const ordenados = [...titulos].sort((a, b) => a.vencimento.localeCompare(b.vencimento) || a.parcela_numero - b.parcela_numero);
  const tot = totaisDoLado(titulos, hoje);
  const linhas = ordenados
    .map((t) => {
      const s = situacaoTitulo(t, hoje);
      const pagoEm = dataPagamento(t);
      return `<tr>${td(esc(descricaoTitulo(t)))}${td(esc(fmtDate(t.vencimento)))}${td(esc(fmtBRL(t.valor)), { direita: true })}${td(esc(SITUACAO_TEXTO[s].texto), { cor: SITUACAO_TEXTO[s].cor })}${td(esc(pagoEm ? fmtDate(pagoEm) : "—"))}</tr>`;
    })
    .join("");
  const resumo = [
    `Total ${fmtBRL(tot.total)}`,
    `${rotulo === "receber" ? "Recebido" : "Pago"} ${fmtBRL(tot.pago)}`,
    `Em aberto ${fmtBRL(tot.emAberto)}`,
    tot.vencido > 0 ? `<span style="color:${COR.vermelho}">Vencido ${fmtBRL(tot.vencido)}</span>` : null,
  ]
    .filter(Boolean)
    .join(" · ");
  return `<div style="font-size:13px;font-weight:bold;color:${COR.tinta};margin:10px 0 6px">${rotulo === "receber" ? "A receber do cliente" : "A pagar (atrações e fornecedores)"}</div>${tabela(
    `<tr>${th("Lançamento")}${th("Vencimento")}${th("Valor", true)}${th("Situação")}${th("Pago em")}</tr>`,
    linhas,
  )}<div style="font-size:12px;color:${COR.suave};margin-top:6px">${resumo}</div>`;
}

export function montarResumoContrato(input: ResumoInput): { subject: string; html: string } {
  const { detail: d, hoje } = input;
  const titulo = tituloDoContrato(d);
  const url = `${input.appUrl}/case/contratos/${d.id}`;
  const c = d.client;

  const situacao = pendencias(d, input.signatarios);
  const blocoSituacao = `<div style="font-size:15px;color:${COR.tinta};font-weight:bold">${esc(STATUS_LABEL[d.status] ?? d.status)}${
    d.signed_at ? `<span style="font-weight:normal;color:${COR.suave}"> · assinado em ${esc(fmtDataHora(d.signed_at))}</span>` : ""
  }</div>${
    situacao.length > 0
      ? `<div style="font-size:13px;color:${COR.suave};margin-top:8px">Falta:</div><ul style="margin:4px 0 0;padding-left:18px;font-size:14px;color:${COR.tinta}">${situacao
          .map((p) => `<li style="margin:2px 0">${esc(p)}</li>`)
          .join("")}</ul>`
      : ""
  }`;

  const blocoCliente = pares([
    ["Cliente (fundo)", c.name],
    c.cnpj_cpf ? ["CNPJ/CPF", fmtDoc(c.cnpj_cpf)] : null,
    c.resp_legal ? ["Responsável legal", `${c.resp_legal}${c.cpf_resp_legal ? ` · CPF ${fmtDoc(c.cpf_resp_legal)}` : ""}`] : null,
    c.email ? ["E-mail", c.email] : null,
    c.phone ? ["Telefone", c.phone] : null,
    c.endereco || c.cidade_estado
      ? ["Endereço", [c.endereco, c.cidade_estado, c.cep ? `CEP ${c.cep}` : null].filter(Boolean).join(" · ")]
      : null,
    d.contratante.proprio
      ? ["Contratante no PDF", [d.contratante.fundo, d.contratante.respLegal, d.contratante.email].filter(Boolean).join(" · ")]
      : null,
  ]);

  const blocoEvento = pares([
    ["Evento", d.event_name ?? "—"],
    ["Data", d.event_date ? fmtDate(d.event_date) : "—"],
    d.show_time ? ["Horário", d.show_time] : null,
    d.passagem_som ? ["Passagem de som", d.passagem_som] : null,
    ["Local", [d.local_name, d.local_city].filter(Boolean).join(", ") || "—"],
  ]);

  const saidasAtracoes = round2(d.atracoes.reduce((a, x) => a + x.valor_artista, 0));
  const saidasFornecedores = round2(d.fornecedores.reduce((a, x) => a + x.valor, 0));
  const blocoValores = pares([
    ["Contrato (atração)", fmtBRL(d.valor_atracao_cliente)],
    d.valor_rider > 0 ? ["Rider", fmtBRL(d.valor_rider)] : null,
    d.valor_camarim > 0 ? ["Camarim", fmtBRL(d.valor_camarim)] : null,
    d.valor_extras > 0 ? ["Extras", fmtBRL(d.valor_extras)] : null,
    ["Total da venda", fmtBRL(d.total_venda)],
    d.atracoes.length > 0 ? ["Pago às atrações", fmtBRL(saidasAtracoes)] : null,
    d.valor_rider_camarim > 0 ? ["Verba Rider/Camarim", fmtBRL(d.valor_rider_camarim)] : null,
    d.fornecedores.length > 0 ? ["Fornecedores e comissões", fmtBRL(saidasFornecedores)] : null,
    // Sem atração ainda não há saída: o "BV" seria a venda inteira.
    d.titles.length > 0 && d.atracoes.length > 0 ? ["BV apurado", `${fmtBRL(bvApurado(d.titles))} (a receber − saídas)`] : null,
    d.bv_lancado_at ? ["BV lançado no Omie", `${fmtBRL(d.bv_lancado_valor ?? 0)} em ${fmtDate(d.bv_lancado_at)}`] : null,
  ]);

  const blocoAtracoes =
    d.atracoes.length === 0
      ? `<div style="font-size:13px;color:${COR.suave}">Nenhuma atração cadastrada ainda.</div>`
      : tabela(
          `<tr>${th("Atração")}${th("Favorecido")}${th("Valor", true)}${th("Parcelas")}</tr>`,
          d.atracoes
            .map(
              (a) =>
                `<tr>${td(esc(a.nome_atracao || a.band_name), { negrito: true })}${td(
                  `${esc(a.band_name)}${a.band_cnpj_cpf ? `<br><span style="color:${COR.suave}">${esc(fmtDoc(a.band_cnpj_cpf))}</span>` : ""}`,
                )}${td(esc(fmtBRL(a.valor_artista)), { direita: true })}${td(parcelasTexto(a.pagar_schedule))}</tr>`,
            )
            .join(""),
        );

  const blocoFornecedores =
    d.fornecedores.length === 0
      ? ""
      : `<div style="font-size:13px;font-weight:bold;color:${COR.tinta};margin:12px 0 6px">Fornecedores e comissões</div>${tabela(
          `<tr>${th("Tipo")}${th("Fornecedor")}${th("Valor", true)}${th("Parcelas")}</tr>`,
          d.fornecedores
            .map(
              (f) =>
                `<tr>${td(esc(FORNECEDOR_TIPO[f.tipo] ?? f.tipo))}${td(
                  `${esc(f.band_name)}${f.descricao ? `<br><span style="color:${COR.suave}">${esc(f.descricao)}</span>` : ""}`,
                )}${td(esc(fmtBRL(f.valor)), { direita: true })}${td(parcelasTexto(f.pagar_schedule))}</tr>`,
            )
            .join(""),
        )}`;

  const blocoAssinaturas =
    input.signatarios && input.signatarios.length > 0
      ? tabela(
          `<tr>${th("Quem")}${th("Papel")}${th("Situação")}</tr>`,
          input.signatarios
            .map(
              (s) =>
                `<tr>${td(esc(s.nome))}${td(esc(s.papel))}${td(
                  esc(s.situacao === "assinou" ? `Assinou${s.assinadoEm ? ` em ${fmtDataHora(s.assinadoEm)}` : ""}` : s.situacao === "aguardando" ? "Aguardando" : "Na fila"),
                  { cor: s.situacao === "assinou" ? COR.verde : COR.suave },
                )}</tr>`,
            )
            .join(""),
        )
      : "";

  const receber = d.titles.filter((t) => !ehPagar(t));
  const pagar = d.titles.filter(ehPagar);
  const blocoFinanceiro =
    d.titles.length === 0
      ? `<div style="font-size:13px;color:${COR.suave}">Títulos ainda não gerados. Cronograma combinado com o cliente:</div>${
          d.receber_schedule.length > 0
            ? tabela(
                `<tr>${th("Vencimento")}${th("Valor", true)}</tr>`,
                d.receber_schedule.map((p) => `<tr>${td(esc(fmtDate(p.vencimento)))}${td(esc(fmtBRL(p.valor)), { direita: true })}</tr>`).join(""),
              )
            : `<div style="font-size:13px;color:${COR.suave}">—</div>`
        }`
      : `${htmlTitulos("receber", receber, hoje)}${htmlTitulos("pagar", pagar, hoje)}<div style="font-size:12px;color:${COR.suave};margin-top:10px">Situação de pagamento conforme a Omie na última sincronização (diária, às 03h).</div>`;

  const blocoAnexos =
    input.anexos.length === 0
      ? `<div style="font-size:13px;color:${COR.suave}">Nenhum contrato em PDF disponível.</div>`
      : `<ul style="margin:0;padding-left:18px;font-size:14px;color:${COR.tinta}">${input.anexos
          .map(
            (a) =>
              `<li style="margin:2px 0">${esc(a.nome)}${a.anexado ? "" : `<span style="color:${COR.vermelho}"> — não anexado${a.motivo ? ` (${esc(a.motivo)})` : ""}; abra no Control Hub</span>`}</li>`,
          )
          .join("")}</ul>`;

  const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="margin:0;background:#f5f5f4;font-family:Arial,Helvetica,sans-serif">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f5f5f4;padding:24px 12px"><tr><td align="center">
<table role="presentation" width="680" cellpadding="0" cellspacing="0" style="max-width:680px;width:100%;background:#ffffff;border-radius:8px;border:1px solid ${COR.linha}">
<tr><td style="padding:24px 28px 4px"><div style="font-size:12px;color:${COR.ambar};font-weight:bold;letter-spacing:.04em">CASE SHOWS · CONTRATOS</div>
<h1 style="margin:8px 0 0;font-size:20px;line-height:1.3;color:${COR.tinta}">${esc(titulo)}</h1>
<div style="margin-top:4px;font-size:14px;color:${COR.suave}">${esc(c.name)} · Venda ${esc(fmtBRL(d.total_venda))}</div></td></tr>
${secao("Situação", blocoSituacao)}
${secao("Cliente", blocoCliente)}
${secao("Evento", blocoEvento)}
${secao("Valores", blocoValores)}
${secao("Atrações", blocoAtracoes + blocoFornecedores)}
${blocoAssinaturas ? secao("Assinaturas (ClickSign)", blocoAssinaturas) : ""}
${secao("Relatório de pagamentos", blocoFinanceiro)}
${secao("O que já aconteceu", htmlLinhaDoTempo(linhaDoPassado(d, input.historico, input.signatarios), "Sem registros."))}
${secao("O que vem pela frente", htmlLinhaDoTempo(linhaDoFuturo(d, hoje), "Nada agendado."))}
${secao("Contratos anexados", blocoAnexos)}
<tr><td style="padding:22px 28px 6px"><a href="${esc(url)}" style="display:inline-block;background:#d97706;color:#ffffff;text-decoration:none;font-size:14px;font-weight:bold;padding:10px 18px;border-radius:6px">Abrir no Control Hub</a></td></tr>
<tr><td style="padding:8px 28px 24px;font-size:12px;color:${COR.suave}">Enviado por ${esc(input.enviadoPor)} pelo Control Hub em ${esc(fmtDataHora(input.enviadoEm))}.</td></tr>
</table></td></tr></table></body></html>`;

  return { subject: titulo, html };
}
