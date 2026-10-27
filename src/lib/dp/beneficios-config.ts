// ============================================================================
// BENEFÍCIOS da empresa — Configurações do DP (27/10/2026). Puro e testado.
//
// O cadastro de cada empresa que a futura tela de gestão de benefícios vai
// usar: oito BLOCOS com a mesma estrutura em todas as empresas e os valores de
// cada uma. Por enquanto é SÓ cadastro — a folha ainda calcula pelos Parâmetros
// da folha (do grupo); ligar os dois é decisão da tela de gestão.
//
//   alimentacao      regra (valor diário × fixo no mês) + faixas (nome, valor)
//   transporte       desconta 6% do salário? + tipos de bilhete (nome, valor)
//   gasolina         faixas de km (de, até, valor)
//   carona           faixas de km (de, até, valor)
//   home_office      valor por nº de dias presenciais na semana ("1 dia — R$ 20")
//   sesi             modalidades (nome, valor)
//   salario_familia  cota e limite de remuneração (+ vigência e fonte da tabela)
//   assiduidade      um valor
//
// Cada bloco tem o PRÓPRIO reajuste em %, aplicado só depois de confirmado: o
// percentual multiplica todo valor em dinheiro do bloco (faixa, bilhete,
// modalidade, cota e limite), arredondado ao centavo. Faixa de km e nº de dias
// não são dinheiro e não mudam.
// ============================================================================

export const BLOCOS_BENEFICIO = [
  "alimentacao",
  "transporte",
  "gasolina",
  "carona",
  "home_office",
  "sesi",
  "salario_familia",
  "assiduidade",
] as const;
export type DpBlocoBeneficio = (typeof BLOCOS_BENEFICIO)[number];

export const ROTULO_BLOCO: Record<DpBlocoBeneficio, string> = {
  alimentacao: "Vale-alimentação",
  transporte: "Vale-transporte",
  gasolina: "Auxílio gasolina",
  carona: "Auxílio carona",
  home_office: "Auxílio home office",
  sesi: "Clube SESI",
  salario_familia: "Salário-família",
  assiduidade: "Assiduidade",
};

export interface DpItemNomeValor {
  id: string;
  nome: string;
  valor: number;
}

/** Faixa de km: de `de` até `ate` (null = "em diante"). */
export interface DpFaixaBeneficio {
  id: string;
  de: number;
  ate: number | null;
  valor: number;
}

/** Home office: quantos dias presenciais na semana e o valor (27/10/2026: por dia, não em faixa). */
export interface DpDiaValor {
  id: string;
  dias: number;
  valor: number;
}

export type DpRegraAlimentacao = "diario" | "fixo";

export interface DpBeneficiosDados {
  alimentacao: { regra: DpRegraAlimentacao; faixas: DpItemNomeValor[] };
  transporte: { descontar6: boolean; bilhetes: DpItemNomeValor[] };
  gasolina: { faixas: DpFaixaBeneficio[] };
  carona: { faixas: DpFaixaBeneficio[] };
  home_office: { porDias: DpDiaValor[] };
  sesi: { modalidades: DpItemNomeValor[] };
  salario_familia: { cota: number | null; limite: number | null; vigencia: string | null; fonte: string | null };
  assiduidade: { valor: number | null };
}

/** Bloco ainda não cadastrado. O VT nasce descontando os 6% — é a regra da lei, desligar é a exceção. */
export const BENEFICIOS_VAZIOS: DpBeneficiosDados = {
  alimentacao: { regra: "diario", faixas: [] },
  transporte: { descontar6: true, bilhetes: [] },
  gasolina: { faixas: [] },
  carona: { faixas: [] },
  home_office: { porDias: [] },
  sesi: { modalidades: [] },
  salario_familia: { cota: null, limite: null, vigencia: null, fonte: null },
  assiduidade: { valor: null },
};

type BlocoFaixa = "gasolina" | "carona";
export const FAIXA_UNIDADE: Record<BlocoFaixa, { unidade: string; singular: string; inteiro: boolean; max: number }> = {
  gasolina: { unidade: "km", singular: "km", inteiro: false, max: 100_000 },
  carona: { unidade: "km", singular: "km", inteiro: false, max: 100_000 },
};

/** Dias presenciais NA SEMANA: de 0 (todo remoto) a 7. */
export const MAX_DIAS_HOME_OFFICE = 7;

/** "0 dias", "1 dia", "3 dias". */
export function rotuloDias(dias: number): string {
  return `${dias} ${dias === 1 ? "dia" : "dias"}`;
}

export const MAX_ITENS_BLOCO = 30;
const VALOR_MAXIMO = 1_000_000;
/** Teto de sanidade do reajuste: o zero a mais digitado multiplicaria o benefício por dez. */
export const REAJUSTE_MAXIMO_BENEFICIO = 100;

const r2 = (v: number) => Math.round((v + Number.EPSILON) * 100) / 100;
const n = (v: number) => v.toLocaleString("pt-BR", { maximumFractionDigits: 2 });
const chave = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();

// ── Validação (o que entra no banco) ───────────────────────────────────────

class Recusa extends Error {}

function numero(v: unknown, oQue: string, { opcional = false } = {}): number | null {
  if (v === null || v === undefined || v === "") {
    if (opcional) return null;
    throw new Recusa(`${oQue}: informe o valor.`);
  }
  const x = typeof v === "number" ? v : Number(v);
  if (!Number.isFinite(x) || x < 0) throw new Recusa(`${oQue}: valor inválido.`);
  if (x > VALOR_MAXIMO) throw new Recusa(`${oQue}: valor alto demais.`);
  return r2(x);
}

function texto(v: unknown, max: number): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t ? t.slice(0, max) : null;
}

function lista(v: unknown, oQue: string): Record<string, unknown>[] {
  if (!Array.isArray(v)) return [];
  if (v.length > MAX_ITENS_BLOCO) throw new Recusa(`${oQue}: no máximo ${MAX_ITENS_BLOCO} itens.`);
  return v.filter((x): x is Record<string, unknown> => Boolean(x) && typeof x === "object");
}

function idDe(v: unknown, i: number, vistos: Set<string>): string {
  let id = typeof v === "string" && v.trim() ? v.trim().slice(0, 64) : `item-${i + 1}`;
  while (vistos.has(id)) id = `${id}-${i + 1}`;
  vistos.add(id);
  return id;
}

function itensNomeValor(v: unknown, oQue: string, item: string): DpItemNomeValor[] {
  const vistos = new Set<string>();
  const nomes = new Set<string>();
  return lista(v, oQue).map((x, i) => {
    const nome = texto(x.nome, 80);
    if (!nome) throw new Recusa(`${oQue}: dê um nome ${item} ${i + 1}.`);
    if (nomes.has(chave(nome))) throw new Recusa(`${oQue}: "${nome}" aparece duas vezes.`);
    nomes.add(chave(nome));
    return { id: idDe(x.id, i, vistos), nome, valor: numero(x.valor, `${oQue} — ${nome}`)! };
  });
}

function faixas(bloco: BlocoFaixa, v: unknown): DpFaixaBeneficio[] {
  const oQue = ROTULO_BLOCO[bloco];
  const u = FAIXA_UNIDADE[bloco];
  const vistos = new Set<string>();
  const lidas = lista(v, oQue).map((x, i) => {
    const pos = `${oQue} — faixa ${i + 1}`;
    const de = numero(x.de, `${pos}, início`)!;
    const ate = numero(x.ate, `${pos}, fim`, { opcional: true });
    for (const lim of [de, ate]) {
      if (lim === null) continue;
      if (u.inteiro && !Number.isInteger(lim)) throw new Recusa(`${pos}: use número inteiro de ${u.unidade}.`);
      if (lim > u.max) throw new Recusa(`${pos}: no máximo ${n(u.max)} ${u.unidade}.`);
    }
    if (ate !== null && ate < de) throw new Recusa(`${pos}: o fim é menor que o início.`);
    return { id: idDe(x.id, i, vistos), de, ate, valor: numero(x.valor, `${pos}, valor`)! };
  });
  // Em ordem do início; sem sobreposição; só a última pode ficar "em diante".
  const ordenadas = lidas.slice().sort((a, b) => a.de - b.de);
  ordenadas.forEach((f, i) => {
    const prox = ordenadas[i + 1];
    if (!prox) return;
    if (f.ate === null) throw new Recusa(`${oQue}: só a última faixa pode ficar sem fim ("em diante").`);
    if (prox.de <= f.ate) throw new Recusa(`${oQue}: as faixas ${rotuloFaixa(bloco, f)} e ${rotuloFaixa(bloco, prox)} se sobrepõem.`);
  });
  return ordenadas;
}

/** Uma linha por nº de dias, sem repetir; em ordem crescente. */
function porDias(v: unknown): DpDiaValor[] {
  const oQue = ROTULO_BLOCO.home_office;
  const vistos = new Set<string>();
  const usados = new Set<number>();
  return lista(v, oQue)
    .map((x, i) => {
      const dias = numero(x.dias, `${oQue} — linha ${i + 1}, dias`)!;
      if (!Number.isInteger(dias) || dias > MAX_DIAS_HOME_OFFICE) {
        throw new Recusa(`${oQue} — linha ${i + 1}: dias presenciais é um número inteiro de 0 a ${MAX_DIAS_HOME_OFFICE}.`);
      }
      if (usados.has(dias)) throw new Recusa(`${oQue}: "${rotuloDias(dias)}" aparece duas vezes.`);
      usados.add(dias);
      return { id: idDe(x.id, i, vistos), dias, valor: numero(x.valor, `${oQue} — ${rotuloDias(dias)}`)! };
    })
    .sort((a, b) => a.dias - b.dias);
}

/**
 * Normaliza e valida o bloco. Lança Recusa com a frase para a tela — e é a MESMA
 * função que lê o banco (`lerBloco`), para o que foi gravado sair igual.
 */
function normalizar<B extends DpBlocoBeneficio>(bloco: B, raw: unknown): DpBeneficiosDados[B] {
  const o = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  let out: unknown;
  switch (bloco) {
    case "alimentacao":
      out = {
        regra: o.regra === "fixo" ? "fixo" : "diario",
        faixas: itensNomeValor(o.faixas, ROTULO_BLOCO.alimentacao, "à faixa"),
      };
      break;
    case "transporte":
      out = { descontar6: o.descontar6 !== false, bilhetes: itensNomeValor(o.bilhetes, ROTULO_BLOCO.transporte, "ao bilhete") };
      break;
    case "gasolina":
    case "carona":
      out = { faixas: faixas(bloco, o.faixas) };
      break;
    case "home_office":
      // O formato de faixas (até 27/10/2026, nenhum salvo) é lido pelo início de cada faixa.
      out = {
        porDias: porDias(
          o.porDias ?? (Array.isArray(o.faixas) ? (o.faixas as Array<Record<string, unknown>>).map((f) => ({ id: f.id, dias: f.de, valor: f.valor })) : []),
        ),
      };
      break;
    case "sesi":
      out = { modalidades: itensNomeValor(o.modalidades, ROTULO_BLOCO.sesi, "à modalidade") };
      break;
    case "salario_familia":
      out = {
        cota: numero(o.cota, "Salário-família — cota", { opcional: true }),
        limite: numero(o.limite, "Salário-família — limite de remuneração", { opcional: true }),
        vigencia: texto(o.vigencia, 120),
        fonte: texto(o.fonte, 300),
      };
      break;
    case "assiduidade":
      out = { valor: numero(o.valor, ROTULO_BLOCO.assiduidade, { opcional: true }) };
      break;
  }
  return out as DpBeneficiosDados[B];
}

export function blocoValido(bloco: unknown): bloco is DpBlocoBeneficio {
  return typeof bloco === "string" && (BLOCOS_BENEFICIO as readonly string[]).includes(bloco);
}

/** O que a tela mandou, pronto para gravar — ou a frase do que está errado. */
export function validarBloco<B extends DpBlocoBeneficio>(bloco: B, raw: unknown): { ok: DpBeneficiosDados[B] } | { erro: string } {
  try {
    return { ok: normalizar(bloco, raw) };
  } catch (e) {
    if (e instanceof Recusa) return { erro: e.message };
    throw e;
  }
}

/** Leitura do banco: o gravado passou pela validação; o que não passar cai no vazio em vez de derrubar a tela. */
export function lerBloco<B extends DpBlocoBeneficio>(bloco: B, raw: unknown): DpBeneficiosDados[B] {
  const r = validarBloco(bloco, raw);
  return "ok" in r ? r.ok : BENEFICIOS_VAZIOS[bloco];
}

// ── Faixas ─────────────────────────────────────────────────────────────────

/** "de 0 a 10 km", "acima de 20 km". */
export function rotuloFaixa(bloco: BlocoFaixa, f: { de: number; ate: number | null }): string {
  const u = FAIXA_UNIDADE[bloco];
  const un = (v: number) => (u.inteiro && v === 1 ? u.singular : u.unidade);
  if (f.ate === null) return u.inteiro ? `${n(f.de)} ${un(f.de)} ou mais` : `acima de ${n(f.de)} ${u.unidade}`;
  if (f.ate === f.de) return `${n(f.de)} ${un(f.de)}`;
  return `de ${n(f.de)} a ${n(f.ate)} ${u.unidade}`;
}

// ── Reajuste ───────────────────────────────────────────────────────────────

export function erroDoPercentual(p: number): string | null {
  if (!Number.isFinite(p) || p <= 0) return "Informe um reajuste maior que zero.";
  if (p > REAJUSTE_MAXIMO_BENEFICIO) return `O reajuste passa de ${REAJUSTE_MAXIMO_BENEFICIO}% — confira o número.`;
  return null;
}

export const reajustarValor = (v: number, percentual: number) => r2(v * (1 + percentual / 100));

/** Os valores em DINHEIRO do bloco, com o rótulo de cada um — a prévia mostra antes e depois. */
export function valoresDoBloco<B extends DpBlocoBeneficio>(bloco: B, dados: DpBeneficiosDados[B]): Array<{ rotulo: string; valor: number }> {
  const d = dados as DpBeneficiosDados[DpBlocoBeneficio];
  switch (bloco) {
    case "alimentacao":
    case "transporte":
    case "sesi": {
      const itens =
        bloco === "alimentacao"
          ? (d as DpBeneficiosDados["alimentacao"]).faixas
          : bloco === "transporte"
            ? (d as DpBeneficiosDados["transporte"]).bilhetes
            : (d as DpBeneficiosDados["sesi"]).modalidades;
      return itens.map((i) => ({ rotulo: i.nome, valor: i.valor }));
    }
    case "gasolina":
    case "carona":
      return (d as DpBeneficiosDados["gasolina"]).faixas.map((f) => ({ rotulo: rotuloFaixa(bloco as BlocoFaixa, f), valor: f.valor }));
    case "home_office":
      return (d as DpBeneficiosDados["home_office"]).porDias.map((x) => ({ rotulo: rotuloDias(x.dias), valor: x.valor }));
    case "salario_familia": {
      const s = d as DpBeneficiosDados["salario_familia"];
      return [
        ...(s.cota !== null ? [{ rotulo: "Cota por filho", valor: s.cota }] : []),
        ...(s.limite !== null ? [{ rotulo: "Limite de remuneração", valor: s.limite }] : []),
      ];
    }
    case "assiduidade": {
      const a = d as DpBeneficiosDados["assiduidade"];
      return a.valor !== null ? [{ rotulo: "Valor", valor: a.valor }] : [];
    }
  }
  return [];
}

/** O bloco com cada valor em dinheiro reajustado. O resto (nomes, faixas de km/dias, regras) não muda. */
export function reajustarBloco<B extends DpBlocoBeneficio>(bloco: B, dados: DpBeneficiosDados[B], percentual: number): DpBeneficiosDados[B] {
  const rj = (v: number) => reajustarValor(v, percentual);
  const rjNulo = (v: number | null) => (v === null ? null : rj(v));
  const d = dados as never as Record<string, unknown>;
  let out: unknown;
  switch (bloco) {
    case "alimentacao":
      out = { ...d, faixas: (d.faixas as DpItemNomeValor[]).map((i) => ({ ...i, valor: rj(i.valor) })) };
      break;
    case "transporte":
      out = { ...d, bilhetes: (d.bilhetes as DpItemNomeValor[]).map((i) => ({ ...i, valor: rj(i.valor) })) };
      break;
    case "sesi":
      out = { ...d, modalidades: (d.modalidades as DpItemNomeValor[]).map((i) => ({ ...i, valor: rj(i.valor) })) };
      break;
    case "gasolina":
    case "carona":
      out = { ...d, faixas: (d.faixas as DpFaixaBeneficio[]).map((f) => ({ ...f, valor: rj(f.valor) })) };
      break;
    case "home_office":
      out = { ...d, porDias: (d.porDias as DpDiaValor[]).map((x) => ({ ...x, valor: rj(x.valor) })) };
      break;
    case "salario_familia":
      out = { ...d, cota: rjNulo(d.cota as number | null), limite: rjNulo(d.limite as number | null) };
      break;
    case "assiduidade":
      out = { ...d, valor: rjNulo(d.valor as number | null) };
      break;
  }
  return out as DpBeneficiosDados[B];
}

/** Mesmo conteúdo? — para recusar o reajuste confirmado sobre uma prévia que ficou velha. */
export function mesmoBloco<B extends DpBlocoBeneficio>(bloco: B, a: unknown, b: unknown): boolean {
  return JSON.stringify(lerBloco(bloco, a)) === JSON.stringify(lerBloco(bloco, b));
}

// ── Cópia de outra empresa ─────────────────────────────────────────────────

const plural = (q: number, um: string, varios: string) => `${q} ${q === 1 ? um : varios}`;
const reais = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

/** Uma linha que diz o que o bloco tem — a prévia da cópia mostra isto antes de gravar. */
export function resumoDoBloco<B extends DpBlocoBeneficio>(bloco: B, dados: DpBeneficiosDados[B]): string {
  const d = dados as DpBeneficiosDados[DpBlocoBeneficio];
  switch (bloco) {
    case "alimentacao": {
      const a = d as DpBeneficiosDados["alimentacao"];
      return `${plural(a.faixas.length, "faixa", "faixas")} · ${a.regra === "diario" ? "valor diário" : "valor fixo no mês"}`;
    }
    case "transporte": {
      const t = d as DpBeneficiosDados["transporte"];
      return `${t.descontar6 ? "desconta 6%" : "não desconta 6%"} · ${plural(t.bilhetes.length, "bilhete", "bilhetes")}`;
    }
    case "gasolina":
    case "carona":
      return plural((d as DpBeneficiosDados["gasolina"]).faixas.length, "faixa", "faixas");
    case "home_office":
      return plural((d as DpBeneficiosDados["home_office"]).porDias.length, "linha", "linhas");
    case "sesi":
      return plural((d as DpBeneficiosDados["sesi"]).modalidades.length, "modalidade", "modalidades");
    case "salario_familia": {
      const f = d as DpBeneficiosDados["salario_familia"];
      return [f.cota !== null ? `cota ${reais(f.cota)}` : null, f.limite !== null ? `limite ${reais(f.limite)}` : null].filter(Boolean).join(" · ") || "sem valores";
    }
    case "assiduidade": {
      const v = (d as DpBeneficiosDados["assiduidade"]).valor;
      return v !== null ? reais(v) : "sem valor";
    }
  }
  return "";
}

// ── Salário-família vindo da busca na web ──────────────────────────────────

/**
 * Sanidade do que a busca devolveu: em 2026 a cota é R$ 67,54 e o limite R$
 * 1.980,38 (Portaria MPS/MF 13/2026). Número fora dessas grandezas é leitura
 * errada da página (o valor do salário mínimo, uma tabela antiga em cruzeiros) e
 * vira `null` — o campo fica para preencher à mão, em vez de gravar o absurdo.
 */
export function sanearSalarioFamilia(r: { cota: number | null; limite: number | null }): { cota: number | null; limite: number | null } {
  const ok = (v: number | null, min: number, max: number) => (v !== null && Number.isFinite(v) && v >= min && v <= max ? r2(v) : null);
  return { cota: ok(r.cota, 10, 1_000), limite: ok(r.limite, 500, 20_000) };
}
