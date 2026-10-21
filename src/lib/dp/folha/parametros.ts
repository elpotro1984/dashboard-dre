// ============================================================================
// Parâmetros da FOLHA GERENCIAL do DP — puro e testado. É a aba TABELAS da
// planilha de folha do DP, transformada em cadastro com VIGÊNCIA: cada linha de
// `dp_folha_parametros` vale a partir de uma competência ("AAAA-MM") até a
// próxima. O cálculo de um mês usa a vigência mais recente que não passa dele —
// assim mudar a tabela do INSS em janeiro não reescreve o dezembro.
//
// Os valores padrão vêm da planilha "Setembro" do DP (19/10/2026), com UMA
// correção deliberada: o IRRF. A planilha tinha as faixas sobrescritas por
// "5.000" e calculava com as deduções da tabela de 2024 (142,80 / 354,80 /
// 636,13 / 869,36), sem o redutor da Lei 15.270/2025. Aqui vai a tabela
// progressiva de maio/2025 (que segue valendo em 2026) + o redutor mensal da
// lei nova. INSS e salário-família 2026 conferem com a Portaria MPS/MF 13/2026.
// Tudo é editável em Configurações › Parâmetros da folha — o sistema não é a
// fonte da lei, o DP é quem confere.
// ============================================================================

export const FAIXAS_ETARIAS = ["00 a 18", "19 a 23", "24 a 28", "29 a 33", "34 a 38", "39 a 43", "44 a 48", "49 a 53", "54 a 58", "59 ou mais"] as const;
/** Idade máxima de cada faixa (a última não tem teto). Faixas da ANS. */
const TETO_FAIXA = [18, 23, 28, 33, 38, 43, 48, 53, 58, Infinity];

export type DpPlanoTipo = "ambulatorial" | "enfermaria" | "apartamento";
export const PLANO_TIPOS: DpPlanoTipo[] = ["ambulatorial", "enfermaria", "apartamento"];
export const ROTULO_PLANO: Record<DpPlanoTipo | "nenhum", string> = {
  nenhum: "Nenhum",
  ambulatorial: "Ambulatorial",
  enfermaria: "Enfermaria",
  apartamento: "Apartamento",
};

export interface DpFaixaInss {
  /** Limite superior da faixa (inclusive). A última faixa é o teto. */
  ate: number;
  aliquota: number;
}

export interface DpFaixaIrrf {
  /** Limite superior (inclusive); null = sem teto (última faixa). */
  ate: number | null;
  aliquota: number;
  deducao: number;
}

export interface DpFolhaParametros {
  inss: DpFaixaInss[];
  irrf: {
    faixas: DpFaixaIrrf[];
    deducaoDependente: number;
    /** Desconto simplificado mensal: usado no lugar de INSS + dependentes quando for maior. */
    descontoSimplificado: number;
    /** Redutor mensal da Lei 15.270/2025, sobre o rendimento tributável BRUTO do mês. */
    redutor: { limiteIsencao: number; reducaoMaxima: number; limiteReducao: number; a: number; b: number } | null;
  };
  salarioFamilia: { cota: number; limiteRemuneracao: number | null };
  fgtsPercentual: number;
  /** FGTS do jovem aprendiz (Lei 10.097/2000: 2%). */
  fgtsAprendizPercentual: number;
  vtPercentual: number;
  adiantamentoPercentual: number;
  /** Valor mensal de cada faixa etária, por tipo de plano (10 faixas, na ordem de FAIXAS_ETARIAS). */
  planos: Record<DpPlanoTipo, number[]>;
  /** A empresa paga o valor AMBULATORIAL do titular; o colaborador paga o resto e os dependentes. */
  empresaPagaAmbulatorialTitular: boolean;
  odontoPorVida: number;
  /** Bilhetes de transporte: valor por DIA trabalhado. */
  bilhetes: Array<{ nome: string; valorDiario: number }>;
  /**
   * Escalas de trabalho. Com `vtPeloCalendario`, os dias de VT saem dos dias
   * úteis REAIS do mês (seg–sex ou seg–sáb, sem feriado nacional nem os
   * `feriados` da escala — municipais e da empresa); sem ele, de `diasMes` fixo.
   */
  escalas: DpEscala[];
  /** Dias de VT pelo calendário real do mês (true) ou pelo número fixo da escala (false). */
  vtPeloCalendario: boolean;
  /** Avisa quando o total do mês de uma pessoa varia mais que isto contra o mês anterior (0,2 = 20%). */
  variacaoAlerta: number;
  /** Opções de alimentação usadas na planilha (para a importação e para escolher na tela). */
  alimentacoes: Array<{ nome: string; valor: number }>;
  /** Empresas (company_id) que pagam prêmio de férias, e o percentual sobre férias + 1/3. */
  premioFerias: { empresas: string[]; percentual: number };
}

export interface DpEscala {
  nome: string;
  diasMes: number;
  diasSemana: 5 | 6;
  /** Datas (AAAA-MM-DD) sem expediente além dos feriados nacionais: municipais, ponto da empresa. */
  feriados: string[];
}

/** Escala sem dias/semana gravado (vigência antiga): "6 dias…" é seg–sáb, o resto seg–sex. */
function normalizarEscala(e: Partial<DpEscala> & { nome: string; diasMes: number }): DpEscala {
  return {
    nome: e.nome,
    diasMes: e.diasMes,
    diasSemana: e.diasSemana === 6 || (e.diasSemana === undefined && /^\s*6/.test(e.nome)) ? 6 : 5,
    feriados: Array.isArray(e.feriados) ? e.feriados.filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d)) : [],
  };
}

export const PARAMETROS_PADRAO: DpFolhaParametros = {
  inss: [
    { ate: 1621.0, aliquota: 0.075 },
    { ate: 2902.84, aliquota: 0.09 },
    { ate: 4354.27, aliquota: 0.12 },
    { ate: 8475.55, aliquota: 0.14 },
  ],
  irrf: {
    faixas: [
      { ate: 2428.8, aliquota: 0, deducao: 0 },
      { ate: 2826.65, aliquota: 0.075, deducao: 182.16 },
      { ate: 3751.05, aliquota: 0.15, deducao: 394.16 },
      { ate: 4664.68, aliquota: 0.225, deducao: 675.49 },
      { ate: null, aliquota: 0.275, deducao: 908.73 },
    ],
    deducaoDependente: 189.59,
    descontoSimplificado: 607.2,
    redutor: { limiteIsencao: 5000, reducaoMaxima: 312.89, limiteReducao: 7350, a: 978.62, b: 0.133145 },
  },
  salarioFamilia: { cota: 67.54, limiteRemuneracao: 1980.38 },
  fgtsPercentual: 0.08,
  fgtsAprendizPercentual: 0.02,
  vtPercentual: 0.06,
  adiantamentoPercentual: 0.4,
  planos: {
    // Valores exatos da planilha (a operadora fatura com casas além do centavo).
    ambulatorial: [58.397, 64.8025, 72.588, 83.4785, 96.002, 114.2295, 142.8185, 185.656, 235.773, 348.9445],
    enfermaria: [111.726, 124.0164, 138.8988, 159.7428, 183.6972, 218.6028, 273.2184, 355.2012, 451.11, 667.6668],
    apartamento: [142.6124, 158.2686, 177.2638, 203.8592, 234.4296, 278.992, 348.74, 453.3514, 575.739, 852.1234],
  },
  empresaPagaAmbulatorialTitular: true,
  odontoPorVida: 39.16,
  bilhetes: [
    { nome: "Bilhete BH", valorDiario: 21 },
    { nome: "Bilhete PET", valorDiario: 11.8 },
    { nome: "Bilhete Tradicional 2", valorDiario: 7.5 },
    { nome: "Bilhete Tradicional 3", valorDiario: 11.25 },
    { nome: "Bilhete Tradicional 4", valorDiario: 15 },
    { nome: "Bilhete Único 2,5", valorDiario: 9.375 },
    { nome: "Bilhete Único 2+0,5+0,5", valorDiario: 11.25 },
    { nome: "Dinheiro", valorDiario: 15 },
  ],
  // Os 21/25 da planilha são os dias úteis de set/2026 (07/09 é feriado); pelo
  // calendário, cada mês tem os seus — nov/2026 tem 19 em seg–sex.
  escalas: [
    { nome: "5 dias", diasMes: 21, diasSemana: 5, feriados: [] },
    { nome: "5 dias BH", diasMes: 21, diasSemana: 5, feriados: [] },
    { nome: "5 dias PET", diasMes: 21, diasSemana: 5, feriados: [] },
    { nome: "6 dias", diasMes: 25, diasSemana: 6, feriados: [] },
  ],
  vtPeloCalendario: true,
  variacaoAlerta: 0.2,
  alimentacoes: [
    { nome: "Alimentação 100,00", valor: 100 },
    { nome: "Alimentação 200,00", valor: 200 },
    { nome: "Alimentação 300,00", valor: 300 },
    { nome: "Alimentação 350,00", valor: 350 },
    { nome: "Alimentação 400,00", valor: 400 },
    { nome: "Alimentação 420,00", valor: 420 },
    { nome: "Alimentação 432,65", valor: 432.65 },
    { nome: "Alimentação 475,00", valor: 475 },
    { nome: "Alimentação 492,65", valor: 492.65 },
    { nome: "Alimentação 525,00", valor: 525 },
    { nome: "Alimentação BH", valor: 420 },
    { nome: "Alimentação PET", valor: 567 },
    { nome: "Alimentação URA", valor: 336 },
  ],
  premioFerias: { empresas: [], percentual: 0.1 },
};

// ── Competência ────────────────────────────────────────────────────────────

const RE_COMPETENCIA = /^(\d{4})-(0[1-9]|1[0-2])$/;

export function competenciaValida(c: string | null | undefined): c is string {
  return typeof c === "string" && RE_COMPETENCIA.test(c);
}

/** "2026-09" → "set/2026". */
export function rotuloCompetencia(c: string): string {
  const m = RE_COMPETENCIA.exec(c);
  if (!m) return c;
  const nomes = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
  return `${nomes[Number(m[2]) - 1]}/${m[1]}`;
}

export function somarMeses(c: string, n: number): string {
  const [y, m] = c.split("-").map(Number);
  const t = y * 12 + (m - 1) + n;
  return `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, "0")}`;
}

/** A vigência que vale para a competência: a mais recente que não passa dela. */
export function vigenciaPara<T extends { vigencia: string }>(vigencias: T[], competencia: string): T | null {
  let melhor: T | null = null;
  for (const v of vigencias) {
    if (v.vigencia <= competencia && (!melhor || v.vigencia > melhor.vigencia)) melhor = v;
  }
  return melhor;
}

// ── Idade e faixa etária ───────────────────────────────────────────────────

/** Idade em anos completos no 1º dia da competência (não "hoje": a planilha usava HOJE() e mudava com o tempo). */
export function idadeNaCompetencia(nascimento: string | null, competencia: string): number | null {
  if (!nascimento || !/^\d{4}-\d{2}-\d{2}$/.test(nascimento)) return null;
  const [ny, nm, nd] = nascimento.split("-").map(Number);
  const [cy, cm] = competencia.split("-").map(Number);
  const idade = cy - ny - (cm < nm || (cm === nm && 1 < nd) ? 1 : 0);
  return idade < 0 ? null : idade;
}

export function faixaEtaria(idade: number): number {
  return TETO_FAIXA.findIndex((teto) => idade <= teto);
}

// ── Validação (o que vem da tela) ──────────────────────────────────────────

function num(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function taxa(v: unknown, campo: string): number {
  const n = num(v);
  if (n === null || n < 0 || n > 1) throw new Error(`${campo}: percentual inválido.`);
  return n;
}

function valor(v: unknown, campo: string): number {
  const n = num(v);
  if (n === null || n < 0 || n > 1_000_000) throw new Error(`${campo}: valor inválido.`);
  return Math.round(n * 1e6) / 1e6;
}

function crescente(limites: Array<number | null>, campo: string) {
  for (let i = 1; i < limites.length; i++) {
    const a = limites[i - 1];
    const b = limites[i];
    if (a === null || (b !== null && b <= a)) throw new Error(`${campo}: as faixas precisam estar em ordem crescente.`);
  }
}

/** Confere e normaliza o objeto inteiro. Lança com a mensagem para a tela. */
export function validarParametros(p: DpFolhaParametros): DpFolhaParametros {
  if (!p || typeof p !== "object") throw new Error("Parâmetros inválidos.");
  if (!Array.isArray(p.inss) || p.inss.length === 0) throw new Error("INSS: informe as faixas.");
  const inss = p.inss.map((f, i) => ({ ate: valor(f.ate, `INSS faixa ${i + 1}`), aliquota: taxa(f.aliquota, `INSS faixa ${i + 1}`) }));
  crescente(inss.map((f) => f.ate), "INSS");

  const fx = p.irrf?.faixas;
  if (!Array.isArray(fx) || fx.length === 0) throw new Error("IRRF: informe as faixas.");
  const faixas = fx.map((f, i) => ({
    ate: i === fx.length - 1 ? null : valor(f.ate, `IRRF faixa ${i + 1}`),
    aliquota: taxa(f.aliquota, `IRRF faixa ${i + 1}`),
    deducao: valor(f.deducao, `IRRF faixa ${i + 1}`),
  }));
  crescente(faixas.map((f) => f.ate), "IRRF");
  const r = p.irrf.redutor;
  const redutor = r
    ? {
        limiteIsencao: valor(r.limiteIsencao, "Redutor"),
        reducaoMaxima: valor(r.reducaoMaxima, "Redutor"),
        limiteReducao: valor(r.limiteReducao, "Redutor"),
        a: valor(r.a, "Redutor"),
        b: valor(r.b, "Redutor"),
      }
    : null;
  if (redutor && redutor.limiteReducao <= redutor.limiteIsencao) throw new Error("Redutor: o limite da redução precisa ser maior que o da isenção.");

  const planos = {} as Record<DpPlanoTipo, number[]>;
  for (const t of PLANO_TIPOS) {
    const l = p.planos?.[t];
    if (!Array.isArray(l) || l.length !== FAIXAS_ETARIAS.length) throw new Error(`Plano ${ROTULO_PLANO[t]}: informe as ${FAIXAS_ETARIAS.length} faixas.`);
    planos[t] = l.map((v, i) => valor(v, `Plano ${ROTULO_PLANO[t]} ${FAIXAS_ETARIAS[i]}`));
  }

  const nomeado = <T extends { nome: string }>(l: T[] | undefined, campo: string): T[] => {
    if (!Array.isArray(l)) throw new Error(`${campo}: lista inválida.`);
    const vistos = new Set<string>();
    return l.map((x) => {
      const nome = String(x.nome ?? "").trim();
      if (!nome) throw new Error(`${campo}: há uma linha sem nome.`);
      const k = nome.toLowerCase();
      if (vistos.has(k)) throw new Error(`${campo}: "${nome}" aparece duas vezes.`);
      vistos.add(k);
      return { ...x, nome };
    });
  };

  return {
    inss,
    irrf: {
      faixas,
      deducaoDependente: valor(p.irrf.deducaoDependente, "Dedução por dependente"),
      descontoSimplificado: valor(p.irrf.descontoSimplificado, "Desconto simplificado"),
      redutor,
    },
    salarioFamilia: {
      cota: valor(p.salarioFamilia?.cota, "Salário-família"),
      limiteRemuneracao: p.salarioFamilia?.limiteRemuneracao == null ? null : valor(p.salarioFamilia.limiteRemuneracao, "Salário-família"),
    },
    fgtsPercentual: taxa(p.fgtsPercentual, "FGTS"),
    fgtsAprendizPercentual: taxa(p.fgtsAprendizPercentual ?? PARAMETROS_PADRAO.fgtsAprendizPercentual, "FGTS do aprendiz"),
    vtPercentual: taxa(p.vtPercentual, "Desconto de VT"),
    adiantamentoPercentual: taxa(p.adiantamentoPercentual, "Adiantamento"),
    planos,
    empresaPagaAmbulatorialTitular: Boolean(p.empresaPagaAmbulatorialTitular),
    odontoPorVida: valor(p.odontoPorVida, "Odontológico"),
    bilhetes: nomeado(p.bilhetes, "Bilhetes").map((b) => ({ nome: b.nome, valorDiario: valor(b.valorDiario, `Bilhete ${b.nome}`) })),
    escalas: nomeado(p.escalas, "Escalas").map((e) => {
      const d = num(e.diasMes);
      if (d === null || d < 0 || d > 31) throw new Error(`Escala ${e.nome}: dias inválidos.`);
      if (e.diasSemana !== 5 && e.diasSemana !== 6) throw new Error(`Escala ${e.nome}: dias por semana tem de ser 5 ou 6.`);
      const ruins = (e.feriados ?? []).filter((x) => !/^\d{4}-\d{2}-\d{2}$/.test(x));
      if (ruins.length) throw new Error(`Escala ${e.nome}: data de feriado inválida (${ruins[0]}).`);
      return { nome: e.nome, diasMes: d, diasSemana: e.diasSemana, feriados: Array.from(new Set(e.feriados ?? [])).sort() };
    }),
    vtPeloCalendario: Boolean(p.vtPeloCalendario),
    variacaoAlerta: taxa(p.variacaoAlerta ?? PARAMETROS_PADRAO.variacaoAlerta, "Alerta de variação"),
    alimentacoes: nomeado(p.alimentacoes, "Alimentação").map((a) => ({ nome: a.nome, valor: valor(a.valor, `Alimentação ${a.nome}`) })),
    premioFerias: {
      empresas: Array.from(new Set((p.premioFerias?.empresas ?? []).filter((x) => typeof x === "string"))),
      percentual: taxa(p.premioFerias?.percentual ?? 0, "Prêmio de férias"),
    },
  };
}

/** Lê o jsonb gravado; o que faltar cai no padrão (vigência antiga não quebra quando um campo novo surge). */
export function lerParametros(dados: unknown): DpFolhaParametros {
  const d = (dados && typeof dados === "object" ? dados : {}) as Partial<DpFolhaParametros>;
  return {
    ...PARAMETROS_PADRAO,
    ...d,
    irrf: { ...PARAMETROS_PADRAO.irrf, ...(d.irrf ?? {}) },
    salarioFamilia: { ...PARAMETROS_PADRAO.salarioFamilia, ...(d.salarioFamilia ?? {}) },
    planos: { ...PARAMETROS_PADRAO.planos, ...(d.planos ?? {}) },
    premioFerias: { ...PARAMETROS_PADRAO.premioFerias, ...(d.premioFerias ?? {}) },
    escalas: (Array.isArray(d.escalas) ? d.escalas : PARAMETROS_PADRAO.escalas).map(normalizarEscala),
  };
}
