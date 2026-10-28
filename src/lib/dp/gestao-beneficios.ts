// ============================================================================
// GESTÃO DE BENEFÍCIOS — puro e testado (28/10/2026). Quanto cada pessoa recebe
// de benefício NO MÊS: as escolhas do card "Benefícios" da ficha, com o valor do
// cadastro da empresa (resolverBeneficios), aplicadas aos DIAS do mês.
//
// Os dias (pelo calendário de TRABALHO da folha: seg–sex ou seg–sáb pela
// escala, sem os feriados nacionais e os da escala):
//
//   dias úteis do mês     o mês inteiro;
//   dias de vínculo       os do mês em que a pessoa está contratada — admissão
//                         recente ou FUTURA dentro do mês, e o desligamento;
//   dias trabalhados      os de vínculo menos os de FÉRIAS VERDADEIRAS do
//                         Pagamento de férias (FK desmarcado). Férias com FK
//                         marcado não tiram dia.
//
// E como cada benefício usa os dias (decisão do dono do projeto, 28/10/2026):
//
//   POR DIA      VT e o vale-alimentação de regra diária: valor × dias trabalhados.
//   TRABALHADOS  gasolina e carona (mensais): proporcionais aos dias trabalhados —
//                férias e admissão reduzem.
//   VÍNCULO      todo o resto (VA fixo, home office, SESI, assiduidade,
//                salário-família, outros): proporcional só na admissão (e no
//                desligamento) — férias NÃO reduzem.
//
// "Outros benefícios" que somam num benefício seguem a regra dele (na unidade
// dele); o "Separado" vai para a coluna Outros, com a regra do VÍNCULO.
//
// O valor de cada célula vem com os ITENS que o compõem (de onde veio e a
// conta) — na tela, todo valor é clicável e mostra isto.
// ============================================================================

import { resolverBeneficios, type DpBeneficiosColaborador, type DpDependenteFicha } from "@/lib/dp/beneficios-colaborador";
import { ROTULO_BLOCO, type DpBeneficiosDados, type DpBlocoBeneficio, type DpRegraAlimentacao } from "@/lib/dp/beneficios-config";
import { diaMes, diasUteis, intervaloNoMes, primeiroDia, ultimoDia } from "@/lib/dp/folha/calendario";

/** As colunas da tabela, na ordem do pedido: VA, gasolina, carona, VT, SESI, assiduidade e os demais. */
export const COLUNAS_GESTAO = [
  "alimentacao",
  "gasolina",
  "carona",
  "transporte",
  "sesi",
  "assiduidade",
  "home_office",
  "salario_familia",
  "outros",
] as const;
export type DpColunaGestao = (typeof COLUNAS_GESTAO)[number];

export const ROTULO_COLUNA_GESTAO: Record<DpColunaGestao, string> = { ...ROTULO_BLOCO, outros: "Outros benefícios" };

export type DpRegraDias = "por_dia" | "trabalhados" | "vinculo";

export const REGRA_TEXTO: Record<DpRegraDias, string> = {
  por_dia: "Valor por dia × dias trabalhados — férias e admissão tiram dias.",
  trabalhados: "Valor mensal proporcional aos dias trabalhados — férias e admissão reduzem.",
  vinculo: "Valor mensal; proporcional só na admissão ou no desligamento — férias não reduzem.",
};

export interface DpFeriasGestao {
  inicio: string;
  fim: string;
  /** FK marcado = não são férias verdadeiras: não tiram dia. */
  fk: boolean;
}

export interface DpEscalaGestao {
  nome: string;
  diasSemana: 5 | 6;
  feriados: string[];
}

export interface DpDiasBeneficio {
  uteisMes: number;
  uteisVinculo: number;
  /** Dias úteis de férias verdadeiras dentro do vínculo. */
  uteisFerias: number;
  trabalhados: number;
  admissaoNoMes: string | null;
  desligamentoNoMes: string | null;
  /** Há férias verdadeiras no mês. */
  temFerias: boolean;
  /** Há férias marcadas FK no mês (não contaram). */
  temFeriasFk: boolean;
  /** A conta dos dias, em linhas — é o que o clique em "Dias trabalhados" mostra. */
  memoria: string[];
}

const plural = (n: number, um: string, varios: string) => `${n} ${n === 1 ? um : varios}`;
const dma = (ymd: string) => `${ymd.slice(8, 10)}/${ymd.slice(5, 7)}/${ymd.slice(0, 4)}`;

/** Os dias do mês de uma pessoa: úteis, de vínculo e trabalhados, com a memória da conta. */
export function diasDoMes(input: {
  competencia: string;
  admissao: string | null;
  desligamento: string | null;
  ferias: DpFeriasGestao[];
  /** null = a escala da pessoa não está nos parâmetros: seg–sex, só feriados nacionais (dito na memória). */
  escala: DpEscalaGestao | null;
}): DpDiasBeneficio {
  const { competencia } = input;
  const p = primeiroDia(competencia);
  const u = ultimoDia(competencia);
  const diasSemana = input.escala?.diasSemana ?? 5;
  const extras = new Set(input.escala?.feriados ?? []);
  const uteis = (ini: string, fim: string) => diasUteis(ini, fim, diasSemana, extras);

  const uteisMes = uteis(p, u);
  const memoria = [
    `${plural(uteisMes, "dia útil", "dias úteis")} no mês (${diasSemana === 6 ? "seg–sáb" : "seg–sex"}, sem os feriados nacionais` +
      (input.escala ? `${extras.size ? ` e os da escala "${input.escala.nome}"` : ""}).` : `) — a escala da pessoa não está nos Parâmetros da folha.`),
  ];

  const vinculo = intervaloNoMes(input.admissao, input.desligamento, competencia);
  const admissaoNoMes = input.admissao && input.admissao > p && input.admissao <= u ? input.admissao : null;
  const desligamentoNoMes = input.desligamento && input.desligamento >= p && input.desligamento < u ? input.desligamento : null;
  const uteisVinculo = vinculo ? uteis(vinculo.ini, vinculo.fim) : 0;
  if (!vinculo) memoria.push("Sem vínculo neste mês.");
  else if (admissaoNoMes && desligamentoNoMes)
    memoria.push(`Admissão em ${dma(admissaoNoMes)} e desligamento em ${dma(desligamentoNoMes)}: ${plural(uteisVinculo, "dia útil", "dias úteis")} de vínculo.`);
  else if (admissaoNoMes) memoria.push(`Admissão em ${dma(admissaoNoMes)}: ${plural(uteisVinculo, "dia útil", "dias úteis")} a partir dela.`);
  else if (desligamentoNoMes) memoria.push(`Desligamento em ${dma(desligamentoNoMes)}: ${plural(uteisVinculo, "dia útil", "dias úteis")} até ele.`);

  let uteisFerias = 0;
  let temFerias = false;
  let temFeriasFk = false;
  const pedacos = (input.ferias ?? [])
    .map((f) => ({ ...f, ini: f.inicio > p ? f.inicio : p, fimMes: f.fim < u ? f.fim : u }))
    .filter((f) => f.ini <= f.fimMes)
    .sort((a, b) => a.ini.localeCompare(b.ini));
  for (const f of pedacos) {
    const periodo = `Férias de ${diaMes(f.inicio)} a ${diaMes(f.fim)}`;
    if (f.fk) {
      temFeriasFk = true;
      memoria.push(`${periodo} marcadas FK: não tiram dias.`);
      continue;
    }
    temFerias = true;
    // Só o pedaço dentro do vínculo: férias antes da admissão não tiram o que já não contava.
    const ini = vinculo && f.ini < vinculo.ini ? vinculo.ini : f.ini;
    const fim = vinculo && f.fimMes > vinculo.fim ? vinculo.fim : f.fimMes;
    const n = vinculo ? uteis(ini, fim) : 0;
    uteisFerias += n;
    memoria.push(`${periodo}: −${plural(n, "dia útil", "dias úteis")}${f.inicio < p || f.fim > u ? " (só a parte deste mês)" : ""}.`);
  }
  const trabalhados = Math.max(0, uteisVinculo - uteisFerias);
  memoria.push(`Dias trabalhados: ${trabalhados}.`);
  return { uteisMes, uteisVinculo, uteisFerias, trabalhados, admissaoNoMes, desligamentoNoMes, temFerias, temFeriasFk, memoria };
}

// ── Valores ────────────────────────────────────────────────────────────────

export interface DpItemGestao {
  /** O que é ("Faixa 2", "Bilhete BH", um "outro benefício"). */
  rotulo: string;
  origem: "cadastro da empresa" | "outro benefício";
  /** A conta ("R$ 11,00/dia × 19 dias", "R$ 300,00 × 11/19 dias úteis"). */
  conta: string;
  valor: number;
}

export interface DpCelulaGestao {
  valor: number;
  regra: DpRegraDias;
  itens: DpItemGestao[];
  /** Memória do benefício (salário-família, desconto do VT) — vem do card. */
  notas: string[];
  /** O que pode estar errado (opção que saiu do cadastro, cota não cadastrada). */
  avisos: string[];
}

const r2 = (v: number) => Math.round((v + Number.EPSILON) * 100) / 100;
const brl = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

/** Como os dias entram no benefício: pela unidade (por dia) e, no mensal, pelo bloco. */
export function regraDoBeneficio(bloco: DpBlocoBeneficio | "separado", unidade: "dia" | "mes"): DpRegraDias {
  if (unidade === "dia") return "por_dia";
  if (bloco === "gasolina" || bloco === "carona") return "trabalhados";
  return "vinculo";
}

/** Aplica os dias a um valor do cadastro (por dia ou mensal), com a conta. */
export function aplicarDias(unitario: number, regra: DpRegraDias, d: Pick<DpDiasBeneficio, "uteisMes" | "uteisVinculo" | "trabalhados">): { valor: number; conta: string } {
  if (regra === "por_dia") {
    return { valor: r2(unitario * d.trabalhados), conta: `${brl(unitario)}/dia × ${plural(d.trabalhados, "dia", "dias")}` };
  }
  const dias = regra === "trabalhados" ? d.trabalhados : d.uteisVinculo;
  if (d.uteisMes <= 0) return { valor: 0, conta: "mês sem dia útil" };
  if (dias >= d.uteisMes) return { valor: r2(unitario), conta: `${brl(unitario)} no mês` };
  return { valor: r2((unitario * dias) / d.uteisMes), conta: `${brl(unitario)} × ${dias}/${d.uteisMes} dias úteis` };
}

/** As células de uma pessoa: cada benefício do card com os dias do mês aplicados. */
export function beneficiosDoMes(input: {
  cfg: DpBeneficiosDados;
  escolhas: DpBeneficiosColaborador;
  pessoa: { tipoContrato: string | null; salario: number | null; dependentes: DpDependenteFicha[] };
  dias: DpDiasBeneficio;
  competencia: string;
}): Record<DpColunaGestao, DpCelulaGestao> {
  const { dias } = input;
  // Os filhos contam pelo fim do mês: o que faz 14 anos no mês ainda conta, o que nasce no mês já conta.
  const resumo = resolverBeneficios({ cfg: input.cfg, escolhas: input.escolhas, pessoa: input.pessoa, hoje: ultimoDia(input.competencia) });
  const celulas = {} as Record<DpColunaGestao, DpCelulaGestao>;

  for (const l of resumo.linhas) {
    const regra = regraDoBeneficio(l.bloco, l.unidade);
    const itens: DpItemGestao[] = [];
    if (l.base > 0) itens.push({ rotulo: l.escolha ?? l.rotulo, origem: "cadastro da empresa", ...aplicarDias(l.base, regra, dias) });
    for (const o of l.outros) itens.push({ rotulo: o.rotulo, origem: "outro benefício", ...aplicarDias(o.valor, regra, dias) });
    celulas[l.bloco] = {
      valor: r2(itens.reduce((s, i) => s + i.valor, 0)),
      regra,
      itens,
      notas: l.detalhe && (l.base > 0 || l.bloco === "salario_familia") ? [l.detalhe] : [],
      // No salário-família o aviso ("sem tipo de contrato — considerado CLT") só importa
      // para quem tem filho: sem isso ele acenderia a coluna para a empresa inteira.
      avisos: l.aviso && (l.bloco !== "salario_familia" || l.escolha) ? [l.aviso] : [],
    };
  }
  const separados = resumo.separados.map((o) => ({ rotulo: o.rotulo, origem: "outro benefício" as const, ...aplicarDias(o.valor, "vinculo", dias) }));
  celulas.outros = { valor: r2(separados.reduce((s, i) => s + i.valor, 0)), regra: "vinculo", itens: separados, notas: [], avisos: [] };
  return celulas;
}

// ── A linha da tabela e os cards ───────────────────────────────────────────

export interface DpLinhaGestao {
  solidesId: number;
  /** Para o link da ficha (o card "Benefícios" mora lá). */
  colaboradorId: string;
  nome: string;
  setor: string | null;
  dias: DpDiasBeneficio;
  celulas: Record<DpColunaGestao, DpCelulaGestao>;
  total: number;
  /** Ninguém cadastrou o card desta pessoa. */
  semCadastro: boolean;
  /** Avisos da pessoa (escolhas feitas no cadastro de outra empresa…). */
  avisos: string[];
}

/** O que a página entrega à tela (montado em gestao-beneficios-queries.ts). */
export interface DpGestaoDados {
  competencia: string;
  linhas: DpLinhaGestao[];
  /** A empresa tem algum bloco salvo em Configurações › Benefícios. */
  empresaTemCadastro: boolean;
  regraAlimentacao: DpRegraAlimentacao;
  /** Os benefícios que a empresa tem cadastrados: a tabela sempre mostra essas colunas. */
  colunasCadastradas: DpColunaGestao[];
  /** Vigência dos Parâmetros da folha de onde saíram as escalas; null = padrão do sistema. */
  vigencia: string | null;
  /** Tabelas que ainda não existem no banco (a tela diz qual migration falta). */
  faltando: { card: boolean; ferias: boolean };
}

export function totalDasCelulas(celulas: Record<DpColunaGestao, DpCelulaGestao>): number {
  return r2(COLUNAS_GESTAO.reduce((s, c) => s + celulas[c].valor, 0));
}

/** Os grupos dos cards. */
export const GRUPOS_GESTAO = {
  alimentacao: ["alimentacao"],
  mobilidade: ["transporte", "gasolina", "carona"],
  demais: ["home_office", "sesi", "assiduidade", "salario_familia", "outros"],
} as const satisfies Record<string, readonly DpColunaGestao[]>;

export interface DpResumoGestao {
  pessoas: number;
  /** Pessoas com algum valor no mês. */
  comBeneficio: number;
  alimentacao: number;
  mobilidade: number;
  demais: number;
  total: number;
}

/** Os cards: a soma das linhas recebidas (as que estão na tela). */
export function resumirGestao(linhas: DpLinhaGestao[]): DpResumoGestao {
  const grupo = (cols: readonly DpColunaGestao[]) => r2(linhas.reduce((s, l) => s + cols.reduce((s2, c) => s2 + l.celulas[c].valor, 0), 0));
  return {
    pessoas: linhas.length,
    comBeneficio: linhas.filter((l) => l.total > 0).length,
    alimentacao: grupo(GRUPOS_GESTAO.alimentacao),
    mobilidade: grupo(GRUPOS_GESTAO.mobilidade),
    demais: grupo(GRUPOS_GESTAO.demais),
    total: r2(linhas.reduce((s, l) => s + l.total, 0)),
  };
}

/** Fração de `parte` em `todo`; null quando o todo é zero (não dá para dizer, não é 0%). */
export function fracao(parte: number, todo: number): number | null {
  return todo > 0 ? parte / todo : null;
}

/** Os benefícios que a EMPRESA tem cadastrados (com alguma opção ou valor) — "Outros" não tem cadastro. */
export function colunasCadastradas(cfg: DpBeneficiosDados): DpColunaGestao[] {
  const tem: Record<DpColunaGestao, boolean> = {
    alimentacao: cfg.alimentacao.faixas.length > 0,
    gasolina: cfg.gasolina.faixas.length > 0,
    carona: cfg.carona.faixas.length > 0,
    transporte: cfg.transporte.bilhetes.length > 0,
    sesi: cfg.sesi.modalidades.length > 0,
    assiduidade: cfg.assiduidade.valor !== null,
    home_office: cfg.home_office.porDias.length > 0,
    salario_familia: cfg.salario_familia.cota !== null,
    outros: false,
  };
  return COLUNAS_GESTAO.filter((c) => tem[c]);
}

/**
 * As colunas de benefício que a tabela mostra: todo benefício que a empresa tem
 * cadastrado, mesmo zerado (é a lista de benefícios dela), mais qualquer um com
 * valor ou aviso em alguém. Decidido sobre a EMPRESA, nunca sobre o filtro —
 * senão a coluna aparece e some conforme se filtra.
 */
export function colunasComValorGestao(linhas: DpLinhaGestao[], cadastradas: readonly DpColunaGestao[] = []): DpColunaGestao[] {
  return COLUNAS_GESTAO.filter(
    (c) => cadastradas.includes(c) || linhas.some((l) => l.celulas[c].valor !== 0 || l.celulas[c].avisos.length > 0),
  );
}
