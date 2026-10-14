// Leitura do quadro do Trello "CASE SHOWS - EVENTOS" para a agenda do Case.
//
// O quadro não usa o campo de data do Trello nem campos personalizados: tudo
// está no TÍTULO do cartão, no padrão "TIPO - TURMA - LOCAL - DATA - UNIDADE"
// (com variações reais: data no fim, local com cidade, prefixo "Contrato
// intermédio"). Este módulo é puro — o script de importação lê o arquivo e grava.

export interface TrelloCard {
  id: string;
  name: string;
  desc: string;
  closed: boolean;
  idList: string;
  idChecklists: string[];
  shortUrl?: string;
  url?: string;
  attachments?: Array<{ name: string; url: string; mimeType?: string | null }>;
}

export interface TrelloBoard {
  lists: Array<{ id: string; name: string; closed: boolean }>;
  cards: TrelloCard[];
  checklists: Array<{ id: string; name: string }>;
  // O export do Trello traz só as ~1000 ações mais recentes do quadro: o
  // histórico de cartão mais antigo que isso chega cortado.
  actions?: TrelloAction[];
}

type Nomeado = { id?: string; name?: string };

export interface TrelloAction {
  type: string;
  date: string;
  data?: {
    card?: Nomeado & { desc?: string; closed?: boolean; dueComplete?: boolean; due?: string | null };
    idCard?: string;
    text?: string;
    old?: Record<string, unknown>;
    list?: Nomeado;
    listBefore?: Nomeado;
    listAfter?: Nomeado;
    attachment?: Nomeado;
    checklist?: Nomeado;
    checkItem?: Nomeado & { state?: string };
    member?: Nomeado;
  };
  memberCreator?: { fullName?: string | null } | null;
}

/** Um item da linha do tempo do cartão: comentário (texto livre) ou atividade descrita. */
export interface HistoricoTrello {
  tipo: "comentario" | "atividade";
  autor: string | null;
  data: string;
  texto: string;
}

export interface AgendaImportadaRow {
  origem_id: string;
  origem_url: string | null;
  titulo_original: string;
  categoria: string | null;
  turma: string | null;
  local_name: string | null;
  local_city: string | null;
  unidade: string | null;
  intermediacao: boolean;
  event_date: string;
  event_date_fim: string | null;
  atracoes: string[];
  nps: number[];
  observacao: string | null;
  anexos: Array<{ nome: string; url: string }>;
  // Tudo o que as pessoas fizeram no cartão, em ordem cronológica. Os dados do
  // contrato (fundo, horário, valores) estão nos COMENTÁRIOS — a descrição
  // quase sempre só tem o NP.
  historico: HistoricoTrello[];
  // Cartão mais antigo que a ação mais antiga do arquivo: o começo do
  // histórico ficou só no Trello. Nulo = histórico completo.
  historico_desde: string | null;
}

const aspas = (s: string | undefined) => `"${limpa(s ?? "")}"`;

function dataCurtaBR(iso: string): string {
  const [y, m, d] = iso.slice(0, 10).split("-");
  return `${d}/${m}/${y}`;
}

/**
 * Texto em português de uma ação do Trello, ou null quando ela não diz nada a
 * quem lê o evento (reordenar o cartão na lista, mudar etiqueta de cor).
 */
export function descreverAcao(a: TrelloAction): HistoricoTrello | null {
  const d = a.data ?? {};
  const base = { autor: a.memberCreator?.fullName ?? null, data: a.date };
  const atividade = (texto: string): HistoricoTrello => ({ tipo: "atividade", ...base, texto });

  switch (a.type) {
    case "commentCard": {
      const texto = d.text?.trim();
      return texto ? { tipo: "comentario", ...base, texto } : null;
    }
    case "createCard":
      return atividade(d.list?.name ? `criou o cartão em ${aspas(d.list.name)}` : "criou o cartão");
    case "copyCard":
      return atividade("criou o cartão como cópia de outro");
    case "addAttachmentToCard":
      return atividade(`anexou ${aspas(d.attachment?.name)}`);
    case "deleteAttachmentFromCard":
      return atividade(`removeu o anexo ${aspas(d.attachment?.name)}`);
    case "updateCheckItemStateOnCard": {
      const verbo = d.checkItem?.state === "complete" ? "concluiu" : "reabriu";
      return atividade(`${verbo} ${aspas(d.checkItem?.name)}${d.checklist?.name ? ` (${limpa(d.checklist.name)})` : ""}`);
    }
    case "addChecklistToCard":
      return atividade(`adicionou a checklist ${aspas(d.checklist?.name)}`);
    case "removeChecklistFromCard":
      return atividade(`removeu a checklist ${aspas(d.checklist?.name)}`);
    case "updateChecklist":
      return typeof d.old?.name === "string"
        ? atividade(`renomeou a checklist ${aspas(d.old.name)} para ${aspas(d.checklist?.name)}`)
        : null;
    case "addMemberToCard":
      return atividade(`adicionou ${d.member?.name ?? "um membro"} ao cartão`);
    case "removeMemberFromCard":
      return atividade(`removeu ${d.member?.name ?? "um membro"} do cartão`);
    case "updateCard": {
      const old = d.old ?? {};
      if (d.listBefore || d.listAfter) return atividade(`moveu de ${aspas(d.listBefore?.name)} para ${aspas(d.listAfter?.name)}`);
      if (typeof old.name === "string") return atividade(`renomeou o cartão (antes: ${aspas(old.name)})`);
      if ("desc" in old) return atividade(d.card?.desc?.trim() ? `alterou a descrição para: ${d.card.desc.trim()}` : "apagou a descrição");
      if ("closed" in old) return atividade(d.card?.closed ? "arquivou o cartão" : "desarquivou o cartão");
      if ("dueComplete" in old) return atividade(d.card?.dueComplete ? "marcou o prazo como concluído" : "desmarcou o prazo como concluído");
      if ("due" in old) return atividade(d.card?.due ? `definiu o prazo para ${dataCurtaBR(d.card.due)}` : "removeu o prazo");
      return null;
    }
    default:
      return null;
  }
}

/** O id do Trello começa pelo instante de criação, em segundos (8 dígitos hex). */
function criadoEm(cardId: string): string | null {
  const seg = parseInt(cardId.slice(0, 8), 16);
  return Number.isFinite(seg) && seg > 0 ? new Date(seg * 1000).toISOString() : null;
}

export interface LeituraTitulo {
  categoria: string | null;
  turma: string | null;
  local_name: string | null;
  local_city: string | null;
  unidade: string | null;
  intermediacao: boolean;
  event_date: string | null;
  event_date_fim: string | null;
}

// Tipos de evento que aparecem como 1º trecho. "BAILE ENFERMAGEM UFJF" (sem
// hífen) também começa por um deles, por isso a lista é usada como prefixo.
const CATEGORIAS = [
  "AULA DA SAUDADE",
  "MEIO MEDICO",
  "MEIO CURSO",
  "PRE EVENTO",
  "100 DIAS",
  "BILHETERIA",
  "CASAMENTO",
  "CHURRASCO",
  "CORPORATIVO",
  "FORMATURA",
  "JANTAR",
  "BAILE",
];

const INTERMEDIACAO = /^\*?\s*(contrato\s+)?interm[eé]dio\s*\*?$/i;
const DATA = /(\d{1,2})[./](\d{1,2})[./](\d{2,4})/g;

function semAcento(s: string): string {
  return s.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

function limpa(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

function iso(d: string, m: string, y: string): string | null {
  let ano = Number(y);
  if (y.length === 2) ano += 2000;
  const mes = Number(m);
  const dia = Number(d);
  if (mes < 1 || mes > 12 || dia < 1 || dia > 31 || ano < 2000) return null;
  const dt = new Date(Date.UTC(ano, mes - 1, dia));
  if (dt.getUTCMonth() !== mes - 1) return null;
  return `${ano}-${String(mes).padStart(2, "0")}-${String(dia).padStart(2, "0")}`;
}

export function lerTitulo(titulo: string): LeituraTitulo {
  const datas: string[] = [];
  const semData = titulo.replace(DATA, (_, d, m, y) => {
    const v = iso(d, m, y);
    if (v) datas.push(v);
    return " - ";
  });

  // "09.10.2026 a 11.10.2026" deixa um " a " solto entre os dois hífens.
  let trechos = semData
    .split(/\s*-\s*/)
    .map(limpa)
    .filter((t) => t && !/^a$/i.test(t));

  let intermediacao = false;
  trechos = trechos.filter((t) => {
    if (INTERMEDIACAO.test(t)) {
      intermediacao = true;
      return false;
    }
    return true;
  });

  let categoria: string | null = null;
  if (trechos.length > 0) {
    const primeiro = semAcento(trechos[0]).toUpperCase();
    const cat = CATEGORIAS.find((c) => primeiro === c || primeiro.startsWith(c + " "));
    if (cat) {
      categoria = trechos[0].slice(0, cat.length);
      const resto = limpa(trechos[0].slice(cat.length));
      trechos = resto ? [resto, ...trechos.slice(1)] : trechos.slice(1);
    }
  }

  // Com 3+ trechos o último é a unidade (VIVA JF, Vision, Feat…). Com 2, o
  // segundo é local — cartão sem unidade existe ("CASAMENTO - X - Local - data").
  let unidade: string | null = null;
  if (trechos.length >= 3) unidade = trechos.pop() ?? null;

  const turma = trechos.shift() ?? null;
  const local_name = trechos.shift() ?? null;
  const local_city = trechos.length > 0 ? trechos.join(" - ") : null;

  return {
    categoria,
    turma,
    local_name,
    local_city,
    unidade,
    intermediacao,
    event_date: datas[0] ?? null,
    event_date_fim: datas.length > 1 && datas[1] > datas[0] ? datas[1] : null,
  };
}

/** "NP 625", "FP NP 659", "OFFBEAT - NP 663" → números de contrato antigos. */
export function lerNps(desc: string): number[] {
  const out = new Set<number>();
  for (const m of Array.from(desc.matchAll(/\bNP\s*(\d{2,5})\b/gi))) out.add(Number(m[1]));
  return Array.from(out);
}

const CHECKLIST_GENERICA = /^(atra[cç][oõ]es|checklist\b.*)$/i;
const ANEXO_ATRACAO = /CONTRATO[_ ]ATRA[ÇC][ÃA]O[\s_]*-[\s_]*(.+?)(?:[\s_]*-[\s_]+|[\s_]+-[\s_]*|\.pdf$)/i;

/**
 * Atrações por dois sinais confiáveis: checklist com nome de artista (as
 * genéricas "ATRAÇÕES" são o roteiro do contrato, não o artista) e anexo no
 * padrão "CONTRATO_ATRAÇÃO - NOME_-_…". Nome de anexo fora do padrão é
 * ignorado — é variado demais para virar dado sem conferência.
 */
export function lerAtracoes(checklistNames: string[], anexos: string[]): string[] {
  const out: string[] = [];
  const vistos = new Set<string>();
  const add = (n: string) => {
    const v = limpa(n.replace(/_/g, " "));
    const k = semAcento(v).toLowerCase();
    if (!v || vistos.has(k)) return;
    vistos.add(k);
    out.push(v);
  };
  for (const n of checklistNames) if (!CHECKLIST_GENERICA.test(n.trim())) add(n);
  for (const a of anexos) {
    const m = a.match(ANEXO_ATRACAO);
    if (m && !/^baile|^jantar/i.test(m[1].trim())) add(m[1]);
  }
  return out;
}

/** Do mais antigo ao mais recente — o pedido de contrato vem primeiro. Repetido sai. */
function ordenarHistorico(lista: HistoricoTrello[]): HistoricoTrello[] {
  const vistos = new Set<string>();
  return [...lista]
    .sort((a, b) => a.data.localeCompare(b.data))
    .filter((c) => {
      const k = `${c.data}|${c.tipo}|${c.texto}`;
      if (vistos.has(k)) return false;
      vistos.add(k);
      return true;
    });
}

export interface ResultadoLeitura {
  linhas: AgendaImportadaRow[];
  ignorados: Array<{ titulo: string; motivo: string }>;
}

/**
 * Cartões de evento com data >= `desde` (YYYY-MM-DD). Ficam de fora: listas de
 * apoio (EQUIPE, RIDER), arquivados, cartões sem data legível e duplicados
 * (mesmo título e data — o quadro tem cartões repetidos).
 */
export function lerQuadro(board: TrelloBoard, desde: string): ResultadoLeitura {
  const listas = new Map(board.lists.map((l) => [l.id, l]));
  const checklists = new Map(board.checklists.map((c) => [c.id, c.name]));
  const linhas: AgendaImportadaRow[] = [];
  const ignorados: ResultadoLeitura["ignorados"] = [];
  const porChave = new Map<string, AgendaImportadaRow>();

  const historicoPorCartao = new Map<string, HistoricoTrello[]>();
  let acaoMaisAntiga: string | null = null;
  for (const a of board.actions ?? []) {
    if (!acaoMaisAntiga || a.date < acaoMaisAntiga) acaoMaisAntiga = a.date;
    const cardId = a.data?.card?.id ?? a.data?.idCard;
    const item = cardId ? descreverAcao(a) : null;
    if (!cardId || !item) continue;
    const lista = historicoPorCartao.get(cardId) ?? [];
    lista.push(item);
    historicoPorCartao.set(cardId, lista);
  }
  // Só dá para afirmar "cortado" quando o arquivo de fato tem ações.
  const historicoDesde = (cardId: string): string | null => {
    const criado = criadoEm(cardId);
    return acaoMaisAntiga && criado && criado < acaoMaisAntiga ? acaoMaisAntiga.slice(0, 10) : null;
  };

  for (const c of board.cards) {
    const lista = listas.get(c.idList);
    if (!lista || c.closed || lista.closed) continue;
    if (/EQUIPE|RIDER/i.test(lista.name)) continue;

    const t = lerTitulo(c.name);
    if (!t.event_date) {
      ignorados.push({ titulo: c.name, motivo: "sem data completa no título" });
      continue;
    }
    if ((t.event_date_fim ?? t.event_date) < desde) continue;

    const anexos = (c.attachments ?? []).map((a) => ({ nome: a.name, url: a.url }));
    const row: AgendaImportadaRow = {
      origem_id: c.id,
      origem_url: c.shortUrl ?? c.url ?? null,
      titulo_original: limpa(c.name),
      ...t,
      event_date: t.event_date,
      atracoes: lerAtracoes(
        c.idChecklists.map((id) => checklists.get(id) ?? "").filter(Boolean),
        anexos.map((a) => a.nome),
      ),
      nps: lerNps(c.desc),
      observacao: c.desc.trim() || null,
      anexos,
      historico: ordenarHistorico(historicoPorCartao.get(c.id) ?? []),
      historico_desde: historicoDesde(c.id),
    };

    const chave = `${semAcento(limpa(c.name)).toLowerCase()}|${t.event_date}`;
    const anterior = porChave.get(chave);
    if (anterior) {
      const comentarios = (r: AgendaImportadaRow) => r.historico.filter((h) => h.tipo === "comentario").length;
      const peso = (r: AgendaImportadaRow) =>
        r.anexos.length + r.atracoes.length + r.nps.length + comentarios(r) + (r.observacao ? 1 : 0);
      ignorados.push({ titulo: c.name, motivo: "cartão duplicado" });
      const [fica, sai] = peso(row) > peso(anterior) ? [row, anterior] : [anterior, row];
      // O que foi dito no cartão descartado não pode sumir junto com ele.
      fica.historico = ordenarHistorico([...fica.historico, ...sai.historico]);
      const desdes = [fica.historico_desde, sai.historico_desde].filter((x): x is string => Boolean(x));
      fica.historico_desde = desdes.length > 0 ? desdes.sort()[0] : null;
      if (fica === row) linhas[linhas.indexOf(anterior)] = row;
      porChave.set(chave, fica);
      continue;
    }
    porChave.set(chave, row);
    linhas.push(row);
  }

  linhas.sort((a, b) => a.event_date.localeCompare(b.event_date) || a.titulo_original.localeCompare(b.titulo_original));
  return { linhas, ignorados };
}
