// ============================================================================
// Fechamentos em aberto da Feat Produções — FONTE: hubfeat (tela Tabulação).
//
// Toda geração do relatório da Feat consulta o hubfeat
// (GET /api/ext/controlhub/fechamentos-abertos) e usa a resposta SÓ na seção
// "Fechamentos em aberto". É a situação de AGORA (decisão do dono, 09/10/2026),
// não do mês de referência do relatório. O resto do bloco de eventos continua
// lendo `company_feat_projetos`.
//
// + eventos anteriores ao hubfeat (EVENTOS_PRE_HUBFEAT_EM_ABERTO), fixos aqui.
// − eventos não oficiais (EVENTOS_NAO_OFICIAIS), que não entram no relatório.
//
// Falha = null, e a seção some do relatório (decisão do dono): não há fallback
// para a tabela manual, que mostraria número possivelmente velho sem ninguém
// perceber.
//
// Env: HUBFEAT_API_URL (base do hubfeat) + HUBFEAT_API_KEY (a mesma chave
// compartilhada que o hubfeat usa para chamar /api/ext/v1/ctrl/*).
// ============================================================================

export interface HubfeatFechamentoEvento {
  projeto: string;
  resultadoPrevisto: number;
  /** False = o Faturamento ainda não lançou o imposto; a projeção está antes dos impostos. */
  impostoLancado: boolean;
}

export interface HubfeatFechamentosAbertos {
  eventos: HubfeatFechamentoEvento[];
  total: number;
  /** ISO — momento da consulta no hubfeat. */
  consultadoEm: string;
}

const TIMEOUT_MS = 20_000;

// Eventos em aberto que NÃO existem no hubfeat porque aconteceram antes dele
// (decisão do dono, 14/10/2026). Entram na seção junto com os do hubfeat.
// FIXO NO CÓDIGO: quando o evento fechar, alguém precisa avisar para remover
// daqui — senão ele continua aparecendo como em aberto.
export const EVENTOS_PRE_HUBFEAT_EM_ABERTO: readonly HubfeatFechamentoEvento[] = [
  { projeto: "FESTIVAL DE VERÃO", resultadoPrevisto: 733034.16, impostoLancado: true },
];

// Sem acento e sem caixa: tira as marcas combinantes (U+0300 a U+036F) que o
// NFD separa da letra. Comparação por código, sem regex de faixa Unicode.
function normalizaNome(nome: string): string {
  return Array.from(nome.normalize("NFD"))
    .filter((ch) => {
      const c = ch.charCodeAt(0);
      return c < 0x300 || c > 0x36f;
    })
    .join("")
    .trim()
    .toUpperCase();
}

/**
 * Soma os eventos pré-hubfeat à lista do hubfeat. Se um dia o hubfeat passar a
 * listar o mesmo evento (mesmo nome), vale o do hubfeat — nunca conta duas vezes.
 */
export function comEventosPreHubfeat(
  r: HubfeatFechamentosAbertos,
  extras: readonly HubfeatFechamentoEvento[] = EVENTOS_PRE_HUBFEAT_EM_ABERTO,
): HubfeatFechamentosAbertos {
  const nomes = new Set(r.eventos.map((e) => normalizaNome(e.projeto)));
  const novos = extras.filter((e) => !nomes.has(normalizaNome(e.projeto)));
  if (novos.length === 0) return r;
  const eventos = [...r.eventos, ...novos.map((e) => ({ ...e }))];
  return { ...r, eventos, total: round2(eventos.reduce((acc, e) => acc + e.resultadoPrevisto, 0)) };
}

// Eventos NÃO OFICIAIS: o resultado não aparece no relatório (decisão do dono,
// 14/10/2026). Casa por trecho do nome, sem acento e sem caixa — o nome no
// hubfeat pode ter sufixo (local, data).
export const EVENTOS_NAO_OFICIAIS: readonly string[] = ["XIQUE XIQUE 2026"];

/** Tira da lista (e do total) os eventos não oficiais. */
export function semEventosNaoOficiais(
  r: HubfeatFechamentosAbertos,
  excluidos: readonly string[] = EVENTOS_NAO_OFICIAIS,
): HubfeatFechamentosAbertos {
  const trechos = excluidos.map(normalizaNome);
  const eventos = r.eventos.filter((e) => {
    const nome = normalizaNome(e.projeto);
    return !trechos.some((t) => nome.includes(t));
  });
  if (eventos.length === r.eventos.length) return r;
  return { ...r, eventos, total: round2(eventos.reduce((acc, e) => acc + e.resultadoPrevisto, 0)) };
}

interface RespostaHubfeat {
  consultado_em?: unknown;
  total?: unknown;
  eventos?: unknown;
}

function round2(n: number): number {
  return Number(n.toFixed(2));
}

/** Valida a resposta crua do hubfeat. Null se o formato não for o esperado. */
export function parseHubfeatFechamentos(body: unknown): HubfeatFechamentosAbertos | null {
  if (!body || typeof body !== "object") return null;
  const b = body as RespostaHubfeat;
  if (!Array.isArray(b.eventos)) return null;

  const eventos: HubfeatFechamentoEvento[] = [];
  for (const raw of b.eventos) {
    if (!raw || typeof raw !== "object") return null;
    const e = raw as { nome?: unknown; resultado_projetado?: unknown; imposto_lancado?: unknown };
    const valor = Number(e.resultado_projetado);
    if (!Number.isFinite(valor)) return null;
    eventos.push({
      projeto: (typeof e.nome === "string" ? e.nome.trim() : "") || "(sem nome)",
      resultadoPrevisto: round2(valor),
      impostoLancado: e.imposto_lancado !== false,
    });
  }

  // O total é recalculado aqui: a seção soma exatamente as linhas que lista.
  const total = round2(eventos.reduce((acc, e) => acc + e.resultadoPrevisto, 0));
  const consultadoEm =
    typeof b.consultado_em === "string" && !Number.isNaN(Date.parse(b.consultado_em))
      ? b.consultado_em
      : new Date().toISOString();

  return { eventos, total, consultadoEm };
}

export async function fetchHubfeatFechamentosAbertos(
  env: Record<string, string | undefined> = process.env,
): Promise<HubfeatFechamentosAbertos | null> {
  const base = env.HUBFEAT_API_URL?.trim().replace(/\/+$/, "");
  const key = env.HUBFEAT_API_KEY;
  if (!base || !key) {
    console.warn("[feat-fechamentos-hubfeat] HUBFEAT_API_URL/HUBFEAT_API_KEY ausentes — seção omitida.");
    return null;
  }

  try {
    const res = await fetch(`${base}/api/ext/controlhub/fechamentos-abertos`, {
      headers: { Authorization: `Bearer ${key}` },
      cache: "no-store",
      // Sem seguir redirect: um 307 para /login significa rota não publicada no
      // hubfeat, e seguir devolveria HTML com status 200.
      redirect: "manual",
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) {
      console.warn(`[feat-fechamentos-hubfeat] hubfeat respondeu HTTP ${res.status} — seção omitida.`);
      return null;
    }
    const parsed = parseHubfeatFechamentos(await res.json());
    if (!parsed) {
      console.warn("[feat-fechamentos-hubfeat] resposta em formato inesperado — seção omitida.");
      return null;
    }
    return semEventosNaoOficiais(comEventosPreHubfeat(parsed));
  } catch (err) {
    console.warn("[feat-fechamentos-hubfeat] falha ao consultar o hubfeat — seção omitida.", err);
    return null;
  }
}
