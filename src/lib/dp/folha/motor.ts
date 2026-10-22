// ============================================================================
// Motor da FOLHA GERENCIAL do DP — puro e testado. Replica, coluna a coluna, a
// aba SALÁRIO da planilha de folha do DP ("Setembro", 19/10/2026), com a
// memória de cálculo de cada valor: é uma folha de CONFERÊNCIA — a oficial
// (eSocial, guias) continua na contabilidade —, então cada número tem de se
// explicar sozinho.
//
// Onde o motor DIFERE da planilha, de propósito (a planilha estava errada):
//  - IRRF: tabela progressiva de maio/2025 + redutor da Lei 15.270/2025 sobre
//    o rendimento tributável do mês, com o desconto simplificado quando ele é
//    maior que as deduções legais. A planilha usava as deduções de 2024 sobre o
//    salário de carteira e não tinha o redutor.
//  - 1/3 de férias: a planilha só pagava o terço quando o campo do AUXÍLIO
//    HOME OFFICE estava preenchido (condição apontando para a coluna errada).
//  - Idade do plano de saúde: no 1º dia da competência, não HOJE() — na
//    planilha, abrir o arquivo meses depois mudava a faixa de quem fez aniversário.
//  - Desconto de VT: limitado ao custo do próprio VT (6% do salário OU o custo,
//    o que for menor — Decreto 10.854/2021), sobre o salário proporcional.
//  - Salário-família: só para CLT e só até o limite de remuneração.
//  - Afastado com plano de saúde: a planilha gerava desconto NEGATIVO; aqui é 0
//    com aviso (o plano do afastado é cobrado fora da folha).
//
// Tudo o mais segue a regra da planilha, inclusive o que é decisão de negócio:
// adiantamento sobre o salário de carteira, alimentação proporcional a dias
// trabalhados + férias, empresa pagando o Ambulatorial do titular, comissão
// fora da base de INSS/FGTS/IRRF, sócio tratado como PJ.
// ============================================================================

import {
  diaMes,
  diasComerciais,
  diasUteis,
  feriasDoMes,
  intervaloNoMes,
  primeiroDia,
  ultimoDia,
  type DpPeriodoFerias,
} from "@/lib/dp/folha/calendario";
import {
  FAIXAS_ETARIAS,
  faixaEtaria,
  idadeNaCompetencia,
  ROTULO_PLANO,
  type DpFolhaParametros,
  type DpPlanoTipo,
} from "@/lib/dp/folha/parametros";

export type DpContratoFolha = "clt" | "aprendiz" | "estagio" | "prestador" | "socio" | "outro";
export type DpSituacaoFolha = "normal" | "afastado" | "licenca_maternidade";
export type DpTransporteTipo = "nenhum" | "bilhete" | "gasolina";

export const ROTULO_SITUACAO: Record<DpSituacaoFolha, string> = {
  normal: "Normal",
  afastado: "Afastado",
  licenca_maternidade: "Licença-maternidade",
};

/** O que é fixo da pessoa e só a planilha sabia (a Sólides não tem). */
export interface DpFolhaCadastro {
  planoSaude: DpPlanoTipo | "nenhum";
  /** Dependentes NO PLANO (nem todo dependente da Sólides está no plano). */
  planoDependentes: Array<{ nome: string; nascimento: string | null }>;
  odontoVidas: number;
  salarioFamiliaCotas: number;
  dependentesIr: number;
  adiantamento: boolean;
  /** Alimentação: valor mensal cheio (proporcionalizado pelos dias). */
  alimentacao: number;
  transporteTipo: DpTransporteTipo;
  /** Bilhete escolhido (catálogo dos parâmetros). */
  transporteOpcao: string | null;
  /** Gasolina: valor mensal. */
  transporteValor: number;
  escala: string;
  homeOffice: number;
  /** CLT sem INSS na folha (na planilha: setor DIRETOR). */
  semInss: boolean;
  /** Setor da folha (classificação do DP); null = o departamento da Sólides. */
  setorFolha: string | null;
  /**
   * Proventos e descontos FIXOS, com início e (opcional) fim: consignado em 12
   * parcelas, pensão, gratificação. Entram sozinhos em todo mês do período e
   * param no fim — é o que tira do DP a redigitação mensal da mesma coluna.
   */
  recorrentes: DpRecorrente[];
  /**
   * Férias PROGRAMADAS (início e fim). Delas saem sozinhos os dias de férias de
   * cada mês — inclusive quando atravessam a virada — e os dias úteis que o VT
   * não paga. A Sólides Gestão de Pessoas quase não tem férias (1 em 60 fichas
   * conferidas em 21/10/2026), então a programação é feita aqui.
   */
  ferias: DpPeriodoFerias[];
}

export interface DpRecorrente {
  id: string;
  tipo: "provento" | "desconto";
  descricao: string;
  valor: number;
  /** Competência (AAAA-MM) do 1º mês. */
  inicio: string;
  /** Competência do último mês; null = sem prazo. */
  fim: string | null;
}

const mesesEntre = (a: string, b: string) => {
  const [ya, ma] = a.split("-").map(Number);
  const [yb, mb] = b.split("-").map(Number);
  return (yb - ya) * 12 + (mb - ma);
};

/** Os fixos que valem no mês, com a parcela ("3/12") quando há prazo. */
export function recorrentesDoMes(lista: DpRecorrente[], competencia: string): Array<DpRecorrente & { parcela: string | null }> {
  return (lista ?? [])
    .filter((r) => r.inicio <= competencia && (r.fim === null || competencia <= r.fim))
    .map((r) => ({ ...r, parcela: r.fim ? `${mesesEntre(r.inicio, competencia) + 1}/${mesesEntre(r.inicio, r.fim) + 1}` : null }));
}

export const CADASTRO_VAZIO: DpFolhaCadastro = {
  planoSaude: "nenhum",
  planoDependentes: [],
  odontoVidas: 0,
  salarioFamiliaCotas: 0,
  dependentesIr: 0,
  adiantamento: false,
  alimentacao: 0,
  transporteTipo: "nenhum",
  transporteOpcao: null,
  transporteValor: 0,
  escala: "5 dias",
  homeOffice: 0,
  semInss: false,
  setorFolha: null,
  recorrentes: [],
  ferias: [],
};

/** O que muda todo mês (a aba CONTROLE, parte variável). */
export interface DpFolhaLancamento {
  situacao: DpSituacaoFolha;
  /**
   * Dias trabalhados. NULL = AUTOMÁTICO: o contrato no mês (admissão e
   * desligamento da Sólides) menos as férias, que vão no recibo. Em set/2026 a
   * regra reproduziu os 16 casos de férias da planilha (dias + férias = 30).
   * Número = informado (falta, afastamento parcial) e vence o automático.
   */
  diasTrabalhados: number | null;
  /** "Insuficiência de saldo / outros proventos": entra no salário do mês. */
  outrosProventos: number;
  /** Dias de férias no mês. NULL = automático, pelas férias programadas no cadastro. */
  diasFerias: number | null;
  /**
   * INSS já descontado no recibo de férias (entra como dedução). NULL =
   * calculado como no recibo (INSS sobre férias + 1/3); em set/2026 bateu com o
   * digitado em 9 de 16 — o resto (férias vindas do mês anterior, médias) se informa.
   */
  inssFerias: number | null;
  coparticipacao: number;
  outrosDescontos: number;
  comissao: number;
  /**
   * Dias de VT/gasolina a descontar do mês cheio. NULL = automático: os dias
   * úteis do período trabalhado, proporcionais aos dias trabalhados (ESTIMADO
   * quando há férias ou falta, porque as datas delas não chegam). Número =
   * informado, sobre os dias úteis do mês inteiro (a regra da planilha).
   */
  vtDiasDesconto: number | null;
  /**
   * Valores DIGITADOS por cima do cálculo, com motivo. É como o DP trabalha na
   * planilha (39 células de setembro/2026 eram valor digitado sobre a fórmula:
   * IRRF vindo da contabilidade, plano com regra especial…). O ajuste substitui
   * o calculado e as somas seguem dele — a tela mostra os dois.
   */
  ajustes: Partial<Record<DpColunaAjustavel, { valor: number; motivo: string }>>;
}

export const LANCAMENTO_PADRAO: DpFolhaLancamento = {
  situacao: "normal",
  diasTrabalhados: null,
  outrosProventos: 0,
  diasFerias: null,
  inssFerias: null,
  coparticipacao: 0,
  outrosDescontos: 0,
  comissao: 0,
  vtDiasDesconto: null,
  ajustes: {},
};

export interface DpFolhaEntrada {
  solidesId: number;
  nome: string;
  setor: string | null;
  centroCusto: string | null;
  empresaId: string | null;
  contrato: DpContratoFolha;
  salario: number | null;
  nascimento: string | null;
  /** Admissão e desligamento (AAAA-MM-DD): é deles que saem os dias do mês. */
  admissao: string | null;
  desligamento: string | null;
  /** A Sólides não deu a data: o desligamento é o dia em que a sincronização percebeu a saída. */
  desligamentoEstimado?: boolean;
  cadastro: DpFolhaCadastro;
  lancamento: DpFolhaLancamento;
}

/** Colunas numéricas do resultado, na ordem da planilha. */
export const COLUNAS_FOLHA = [
  "salarioMes",
  "salarioFamilia",
  "homeOffice",
  "totalEntradas",
  "ferias",
  "tercoFerias",
  "totalFerias",
  "premioFerias",
  "inss",
  "inssFerias",
  "vtDesconto",
  "planoSaude",
  "coparticipacao",
  "odonto",
  "irrf",
  "outrosDescontos",
  "totalDescontos",
  "saldo",
  "adiantamento",
  "quintoDiaUtil",
  "comissao",
  "alimentacao",
  "valeTransporte",
  "valeGasolina",
  "totalBeneficio",
  "totalExtras",
  "fgts",
  "totalGeral",
] as const;
export type DpColunaFolha = (typeof COLUNAS_FOLHA)[number];

/** Colunas que aceitam ajuste manual — as de CÁLCULO. Somas e totais nunca: eles seguem dos ajustes. */
export const COLUNAS_AJUSTAVEIS = [
  "salarioMes",
  "salarioFamilia",
  "homeOffice",
  "ferias",
  "tercoFerias",
  "premioFerias",
  "inss",
  "vtDesconto",
  "planoSaude",
  "odonto",
  "irrf",
  "adiantamento",
  "alimentacao",
  "valeTransporte",
  "valeGasolina",
  "fgts",
] as const satisfies readonly DpColunaFolha[];
export type DpColunaAjustavel = (typeof COLUNAS_AJUSTAVEIS)[number];

export const ROTULO_COLUNA: Record<DpColunaFolha, string> = {
  salarioMes: "Salário do mês",
  salarioFamilia: "Salário-família",
  homeOffice: "Auxílio home office",
  totalEntradas: "Total de entradas",
  ferias: "Férias",
  tercoFerias: "1/3 de férias",
  totalFerias: "Total de férias",
  premioFerias: "Prêmio de férias",
  inss: "INSS",
  inssFerias: "INSS já descontado nas férias",
  vtDesconto: "Desconto de VT",
  planoSaude: "Plano de saúde",
  coparticipacao: "Coparticipação",
  odonto: "Plano odontológico",
  irrf: "IRRF",
  outrosDescontos: "Outros descontos",
  totalDescontos: "Total de descontos",
  saldo: "Saldo (entradas − descontos)",
  adiantamento: "Adiantamento",
  quintoDiaUtil: "A pagar no 5º dia útil",
  comissao: "Comissão / meta",
  alimentacao: "Alimentação",
  valeTransporte: "Vale-transporte",
  valeGasolina: "Vale-gasolina",
  totalBeneficio: "Total de benefícios",
  totalExtras: "Total de extras",
  fgts: "FGTS",
  totalGeral: "Total geral",
};

export type DpFolhaValores = Record<DpColunaFolha, number>;

export interface DpFolhaResultado extends DpFolhaValores {
  solidesId: number;
  nome: string;
  setor: string | null;
  centroCusto: string | null;
  empresaId: string | null;
  contrato: DpContratoFolha;
  situacao: DpSituacaoFolha;
  salarioCarteira: number;
  /** Explicação de cada coluna que tem conta (as somas não precisam). */
  memoria: Partial<Record<DpColunaFolha, string>>;
  /** O que o DP precisa conferir nesta linha. */
  avisos: string[];
  /** Colunas com ajuste manual, e o valor que o sistema teria calculado. */
  ajustados: Partial<Record<DpColunaAjustavel, number>>;
  /** O que o sistema preencheria sozinho (a grade mostra como sugestão no campo vazio). */
  automatico: {
    diasTrabalhados: number;
    inssFerias: number;
    vtDiasDesconto: number;
    diasUteisMes: number;
    vtDias: number;
    /** Dias de férias que as férias programadas põem neste mês. */
    diasFerias: number;
  };
  /** Proventos e descontos fixos que entraram no mês. */
  recorrentes: Array<DpRecorrente & { parcela: string | null }>;
  /**
   * Bases de cálculo de cada imposto (a tela de Impostos mostra a conta com elas).
   * `patronal` = base dos encargos da EMPRESA (INSS patronal, RAT, terceiros): CLT
   * fora de afastamento e de licença-maternidade (STF, Tema 72: o patronal não
   * incide sobre o salário-maternidade). Folha fechada antes deste campo não o tem.
   */
  bases?: { inss: number; irrf: number; fgts: number; patronal: number; aliquotaFgts: number };
}

// ── utilitários ────────────────────────────────────────────────────────────

const r2 = (v: number) => Math.round((v + Number.EPSILON) * 100) / 100;
const brl = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const pct = (v: number) => `${(v * 100).toLocaleString("pt-BR", { maximumFractionDigits: 2 })}%`;
const n = (v: number) => v.toLocaleString("pt-BR", { maximumFractionDigits: 2 });

export function grupoContratoFolha(tipo: string | null): DpContratoFolha {
  const t = (tipo ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
  if (!t.trim()) return "outro";
  // Aprendiz é CLT (INSS, IRRF, férias com 1/3), com FGTS de 2% — não é estágio.
  if (t.includes("aprendiz")) return "aprendiz";
  if (t.includes("clt")) return "clt";
  if (t.includes("socio")) return "socio";
  if (t.includes("prestador") || t.includes("pj") || t.includes("rpa")) return "prestador";
  if (t.includes("estag")) return "estagio";
  return "outro";
}

/** INSS progressivo, faixa a faixa, até o teto. */
export function calcularInss(base: number, faixas: DpFolhaParametros["inss"]): { valor: number; memoria: string } {
  if (base <= 0) return { valor: 0, memoria: "Sem base." };
  let anterior = 0;
  let total = 0;
  const partes: string[] = [];
  for (const f of faixas) {
    if (base <= anterior) break;
    const fatia = Math.min(base, f.ate) - anterior;
    if (fatia > 0) {
      const v = fatia * f.aliquota;
      total += v;
      partes.push(`${pct(f.aliquota)} × ${brl(fatia)} = ${brl(r2(v))}`);
    }
    anterior = f.ate;
  }
  const teto = faixas[faixas.length - 1]?.ate ?? 0;
  const nota = base > teto ? ` (base acima do teto de ${brl(teto)})` : "";
  return { valor: r2(total), memoria: `Base ${brl(base)}${nota}: ${partes.join(" + ")}.` };
}

/** IRRF mensal com dedução legal × simplificada e o redutor da Lei 15.270/2025. */
export function calcularIrrf(
  tributavel: number,
  inssMes: number,
  dependentes: number,
  p: DpFolhaParametros["irrf"],
): { valor: number; memoria: string } {
  if (tributavel <= 0) return { valor: 0, memoria: "Sem rendimento tributável no mês." };
  const legais = inssMes + dependentes * p.deducaoDependente;
  const usaSimplificado = p.descontoSimplificado > legais;
  const deducao = usaSimplificado ? p.descontoSimplificado : legais;
  const base = Math.max(0, tributavel - deducao);
  const faixa = p.faixas.find((f) => f.ate === null || base <= f.ate) ?? p.faixas[p.faixas.length - 1];
  const imposto = Math.max(0, base * faixa.aliquota - faixa.deducao);
  let reducao = 0;
  let notaReducao = "";
  const r = p.redutor;
  if (r && imposto > 0) {
    if (tributavel <= r.limiteIsencao) {
      reducao = Math.min(r.reducaoMaxima, imposto);
      notaReducao = ` − redutor ${brl(r2(reducao))} (rendimento até ${brl(r.limiteIsencao)})`;
    } else if (tributavel <= r.limiteReducao) {
      reducao = Math.min(imposto, Math.max(0, r.a - r.b * tributavel));
      notaReducao = ` − redutor ${brl(r2(reducao))} (${brl(r.a)} − ${n(r.b)} × ${brl(tributavel)})`;
    }
  }
  const valor = r2(Math.max(0, imposto - reducao));
  const ded = usaSimplificado
    ? `desconto simplificado ${brl(p.descontoSimplificado)} (maior que INSS + dependentes, ${brl(r2(legais))})`
    : `INSS ${brl(r2(inssMes))}${dependentes ? ` + ${dependentes} dependente(s) × ${brl(p.deducaoDependente)}` : ""}`;
  return {
    valor,
    memoria:
      `Rendimento ${brl(tributavel)} − ${ded} = base ${brl(r2(base))}; ` +
      `${pct(faixa.aliquota)} − ${brl(faixa.deducao)} = ${brl(r2(imposto))}${notaReducao}.`,
  };
}

function precoPlano(p: DpFolhaParametros, tipo: DpPlanoTipo, idade: number): number {
  return p.planos[tipo][faixaEtaria(idade)] ?? 0;
}

// ── o cálculo de uma pessoa ────────────────────────────────────────────────

export function calcularFolhaPessoa(e: DpFolhaEntrada, p: DpFolhaParametros, competencia: string): DpFolhaResultado {
  const c = e.cadastro;
  const l = e.lancamento;
  const memoria: DpFolhaResultado["memoria"] = {};
  const avisos: string[] = [];
  const ajustados: DpFolhaResultado["ajustados"] = {};
  /** Ajuste manual vence o cálculo; a memória guarda os dois. */
  const aj = (col: DpColunaAjustavel, calculado: number): number => {
    const a = l.ajustes?.[col];
    if (!a || !Number.isFinite(a.valor)) return calculado;
    ajustados[col] = calculado;
    const antes = memoria[col];
    memoria[col] = `Ajuste manual: ${brl(a.valor)}${a.motivo ? ` — ${a.motivo}` : ""}. Calculado: ${brl(calculado)}${antes ? ` (${antes})` : ""}`;
    return r2(a.valor);
  };
  const afastado = l.situacao === "afastado";
  const licenca = l.situacao === "licenca_maternidade";
  // Sócio segue a regra do PJ da planilha; "sem tipo" é CLT, com aviso (errar para mais).
  const semEncargos = e.contrato === "prestador" || e.contrato === "socio";
  const estagio = e.contrato === "estagio";
  const ehClt = e.contrato === "clt" || e.contrato === "outro" || e.contrato === "aprendiz";
  const pctFgts = e.contrato === "aprendiz" ? p.fgtsAprendizPercentual : p.fgtsPercentual;
  if (e.contrato === "outro") avisos.push("Sem tipo de contrato na Sólides — calculado como CLT.");
  if (e.contrato === "socio") avisos.push("Sócio: calculado como PJ (sem INSS, IRRF e FGTS na folha), como na planilha.");
  if (e.salario === null) avisos.push("Sem salário na Sólides — salário considerado zero.");
  const salario = e.salario ?? 0;
  const dia = salario / 30;

  // DIAS: o contrato no mês (admissão / desligamento) menos as férias, que são pagas no recibo.
  const intervalo = intervaloNoMes(e.admissao, e.desligamento, competencia);
  const diasBase = diasComerciais(intervalo);
  if (!intervalo) avisos.push("Fora do período de contrato neste mês (admissão depois dele ou desligamento antes).");
  if (e.desligamento && intervalo && e.desligamento <= ultimoDia(competencia)) {
    avisos.push(
      e.desligamentoEstimado
        ? `Desligado (percebido em ${diaMes(e.desligamento)} — a Sólides não informou a data): confira os dias e calcule a rescisão na aba Rescisões.`
        : `Desligado em ${diaMes(e.desligamento)}: calcule a rescisão na aba Rescisões.`,
    );
  }
  // Férias do mês: o informado, ou o que as férias programadas põem neste mês.
  const progr = feriasDoMes(c.ferias ?? [], competencia);
  const diasFerias = l.diasFerias ?? progr.dias;
  const feriasProgramadas = l.diasFerias === null && progr.dias > 0;
  const diasAuto = Math.max(0, diasBase - diasFerias);
  const dias = l.diasTrabalhados ?? diasAuto;
  const origemDias =
    l.diasTrabalhados !== null
      ? "informados"
      : !intervalo
        ? "fora do contrato"
        : [
            e.admissao && e.admissao >= primeiroDia(competencia) ? `admissão em ${diaMes(e.admissao)}` : null,
            e.desligamento && e.desligamento <= ultimoDia(competencia) ? `desligamento em ${diaMes(e.desligamento)}` : null,
            diasFerias > 0 ? `${n(diasBase)} − ${n(diasFerias)} de férias` : null,
          ]
            .filter(Boolean)
            .join(", ") || "mês inteiro";
  const fixos = recorrentesDoMes(c.recorrentes, competencia);
  const fixoProv = r2(fixos.filter((x) => x.tipo === "provento").reduce((s2, x) => s2 + x.valor, 0));
  const fixoDesc = r2(fixos.filter((x) => x.tipo === "desconto").reduce((s2, x) => s2 + x.valor, 0));
  const rotFixos = (tipo: "provento" | "desconto") =>
    fixos
      .filter((x) => x.tipo === tipo)
      .map((x) => `${x.descricao}${x.parcela ? ` ${x.parcela}` : ""} ${brl(x.valor)}`)
      .join(" + ");

  // ENTRADAS
  const outrosProventos = r2(l.outrosProventos + fixoProv);
  const salarioProporcional = afastado ? 0 : dia * dias;
  memoria.salarioMes = afastado
    ? "Afastado: sem salário na folha."
    : `${brl(salario)} ÷ 30 × ${n(dias)} dias (${origemDias})` +
      (l.outrosProventos ? ` + ${brl(l.outrosProventos)} de outros proventos` : "") +
      (fixoProv ? ` + fixos: ${rotFixos("provento")}` : "") +
      ".";
  const salarioMes = aj("salarioMes", afastado ? 0 : r2(salarioProporcional + outrosProventos));

  let salarioFamilia = 0;
  if (c.salarioFamiliaCotas > 0) {
    const lim = p.salarioFamilia.limiteRemuneracao;
    if (afastado) memoria.salarioFamilia = "Afastado: não pago na folha.";
    else if (!ehClt) memoria.salarioFamilia = "Só CLT recebe salário-família.";
    else if (lim !== null && salario > lim) {
      memoria.salarioFamilia = `Salário acima do limite de ${brl(lim)}: não recebe.`;
      avisos.push(`Cadastro com ${c.salarioFamiliaCotas} cota(s) de salário-família, mas o salário passa do limite.`);
    } else {
      salarioFamilia = r2(c.salarioFamiliaCotas * p.salarioFamilia.cota);
      memoria.salarioFamilia = `${c.salarioFamiliaCotas} cota(s) × ${brl(p.salarioFamilia.cota)}.`;
    }
  }
  salarioFamilia = aj("salarioFamilia", salarioFamilia);
  const homeOffice = aj("homeOffice", r2(c.homeOffice));
  const totalEntradas = r2(salarioMes + salarioFamilia + homeOffice);

  // FÉRIAS (pagas no recibo de férias; aqui entram na base de INSS/FGTS)
  if (diasFerias > 0) {
    memoria.ferias =
      `${brl(salario)} ÷ 30 × ${n(diasFerias)} dias de férias` +
      (feriasProgramadas ? ` (programadas: ${progr.pedacos.map((x) => `${diaMes(x.ini)} a ${diaMes(x.fim)}`).join(", ")})` : "") +
      ".";
    memoria.tercoFerias = estagio ? "Estágio: recesso sem 1/3." : "Um terço das férias.";
  }
  const ferias = aj("ferias", afastado ? 0 : r2(dia * diasFerias));
  const tercoFerias = aj("tercoFerias", afastado || estagio ? 0 : r2((dia * diasFerias) / 3));
  const totalFerias = r2(ferias + tercoFerias);
  const premioCalc = e.empresaId !== null && p.premioFerias.empresas.includes(e.empresaId) ? r2(totalFerias * p.premioFerias.percentual) : 0;
  if (premioCalc) memoria.premioFerias = `${pct(p.premioFerias.percentual)} de férias + 1/3 (informativo — não entra no saldo).`;
  const premio = aj("premioFerias", premioCalc);

  // DESCONTOS
  let inss = 0;
  if (afastado) memoria.inss = "Afastado.";
  else if (estagio) memoria.inss = "Estágio não recolhe INSS.";
  else if (semEncargos) memoria.inss = e.contrato === "socio" ? "Sócio." : "PJ / prestador.";
  else if (c.semInss) memoria.inss = "Marcado no cadastro como sem INSS na folha (diretor).";
  else if (salario <= 0) memoria.inss = "Sem salário.";
  else {
    const r = calcularInss(salarioMes + totalFerias, p.inss);
    inss = r.valor;
    memoria.inss = r.memoria + (totalFerias ? " A base inclui as férias do mês." : "");
  }
  inss = aj("inss", inss);
  // INSS do recibo de férias: o recibo desconta o INSS sobre férias + 1/3; o do
  // mês é o da base inteira MENOS esse. Sem valor informado, calcula-se como o recibo.
  const inssFeriasAuto = inss > 0 && diasFerias > 0 ? calcularInss(totalFerias, p.inss).valor : 0;
  const inssFeriasBase = inss > 0 ? l.inssFerias ?? inssFeriasAuto : 0;
  const inssFerias = inssFeriasBase > 0 ? -r2(inssFeriasBase) : 0;
  if (inssFerias) {
    memoria.inssFerias =
      l.inssFerias !== null
        ? "Informado (recibo de férias) — sai do desconto do mês."
        : `Calculado como no recibo: INSS sobre férias + 1/3 (${brl(totalFerias)}) — sai do desconto do mês.`;
  }
  if (inss > 0 && diasFerias > 0 && l.inssFerias === 0) {
    avisos.push("Há férias no mês, mas o INSS do recibo de férias foi informado como zero — o INSS do mês pode estar em dobro.");
  }

  // Transporte (extras) — calculado antes porque o desconto de VT é limitado a ele.
  const escala = p.escalas.find((s) => s.nome === c.escala) ?? null;
  const diasSemana = escala?.diasSemana ?? 5;
  const feriadosEscala = new Set(escala?.feriados ?? []);
  const diasMesVt = p.vtPeloCalendario
    ? diasUteis(primeiroDia(competencia), ultimoDia(competencia), diasSemana, feriadosEscala)
    : escala?.diasMes ?? 21;
  if (c.transporteTipo !== "nenhum" && !escala) avisos.push(`Escala "${c.escala}" não está nos parâmetros — usei ${diasMesVt} dias.`);
  const diasUteisPeriodo = !intervalo
    ? 0
    : intervalo.inteiro
      ? diasMesVt
      : p.vtPeloCalendario
        ? diasUteis(intervalo.ini, intervalo.fim, diasSemana, feriadosEscala)
        : Math.round((diasMesVt * diasBase) / 30);
  // Com as férias programadas, os dias úteis delas saem EXATOS (com as datas); a
  // fração cobre só o que sobrar (falta informada). Sem datas, tudo é proporção.
  const uteisEmFerias =
    feriasProgramadas && p.vtPeloCalendario && intervalo
      ? progr.pedacos.reduce(
          (s2, x) =>
            s2 + diasUteis(x.ini > intervalo.ini ? x.ini : intervalo.ini, x.fim < intervalo.fim ? x.fim : intervalo.fim, diasSemana, feriadosEscala),
          0,
        )
      : 0;
  const baseSemFerias = feriasProgramadas ? Math.max(0, diasBase - diasFerias) : diasBase;
  const fracao = baseSemFerias > 0 ? Math.min(1, dias / baseSemFerias) : 0;
  const vtDiasAuto = Math.round(Math.max(0, diasUteisPeriodo - uteisEmFerias) * fracao);
  const vtDias = l.vtDiasDesconto !== null ? Math.max(0, diasMesVt - l.vtDiasDesconto) : vtDiasAuto;
  const origemVt =
    l.vtDiasDesconto !== null
      ? `${n(diasMesVt)} dias úteis − ${n(l.vtDiasDesconto)} informados`
      : `${n(diasUteisPeriodo)} dias úteis ${intervalo?.inteiro ? "no mês" : "no período do contrato"}` +
        (uteisEmFerias ? ` − ${n(uteisEmFerias)} nas férias programadas` : "") +
        (fracao < 1
          ? ` × ${n(dias)}/${n(baseSemFerias)} dias trabalhados — ESTIMADO (sem as datas ${feriasProgramadas ? "das faltas" : "das férias/faltas"})`
          : "");
  const calendarioVt = p.vtPeloCalendario ? `${diasSemana === 6 ? "seg–sáb" : "seg–sex"}, sem feriados` : "dias fixos da escala";
  const semBeneficio = afastado || licenca;
  let valeTransporte = 0;
  let valeGasolina = 0;
  if (c.transporteTipo === "bilhete") {
    const b = p.bilhetes.find((x) => x.nome === c.transporteOpcao) ?? null;
    if (!b) avisos.push(`Bilhete "${c.transporteOpcao ?? "—"}" não está nos parâmetros — VT zerado.`);
    else if (semBeneficio) memoria.valeTransporte = `${ROTULO_SITUACAO[l.situacao]}: sem VT.`;
    else {
      valeTransporte = r2(b.valorDiario * vtDias);
      memoria.valeTransporte = `${b.nome}: ${brl(b.valorDiario)} × ${n(vtDias)} dias (${origemVt}; ${calendarioVt}).`;
    }
    valeTransporte = aj("valeTransporte", valeTransporte);
  } else if (c.transporteTipo === "gasolina") {
    if (semBeneficio) memoria.valeGasolina = `${ROTULO_SITUACAO[l.situacao]}: sem gasolina.`;
    else {
      valeGasolina = diasMesVt > 0 ? r2(Math.max(0, (c.transporteValor * vtDias) / diasMesVt)) : 0;
      memoria.valeGasolina =
        vtDias >= diasMesVt
          ? `Valor mensal ${brl(c.transporteValor)}.`
          : `${brl(c.transporteValor)} × ${n(vtDias)}/${n(diasMesVt)} dias (${origemVt}).`;
    }
    valeGasolina = aj("valeGasolina", valeGasolina);
  }

  let vtDesconto = 0;
  if (c.transporteTipo === "bilhete" && !afastado && !estagio && !semEncargos && valeTransporte > 0) {
    const seisPct = salarioProporcional * p.vtPercentual;
    vtDesconto = r2(Math.min(seisPct, valeTransporte));
    memoria.vtDesconto =
      seisPct <= valeTransporte
        ? `${pct(p.vtPercentual)} × ${brl(r2(salarioProporcional))} (salário proporcional).`
        : `Limitado ao custo do VT (${brl(valeTransporte)}), menor que ${pct(p.vtPercentual)} do salário.`;
  }
  vtDesconto = aj("vtDesconto", vtDesconto);

  // Plano de saúde: titular + dependentes no plano, menos o que a empresa paga.
  let planoSaude = 0;
  if (c.planoSaude !== "nenhum") {
    const tipo = c.planoSaude;
    if (afastado) {
      memoria.planoSaude = "Afastado: plano não descontado em folha (cobrar à parte).";
    } else {
      const idadeTit = idadeNaCompetencia(e.nascimento, competencia);
      if (idadeTit === null) {
        avisos.push("Plano de saúde sem data de nascimento do titular na Sólides — não calculado.");
      } else {
        const partes: string[] = [];
        let total = precoPlano(p, tipo, idadeTit);
        partes.push(`titular ${idadeTit} anos (${FAIXAS_ETARIAS[faixaEtaria(idadeTit)]}) ${brl(r2(total))}`);
        for (const d of c.planoDependentes) {
          const id = idadeNaCompetencia(d.nascimento, competencia);
          if (id === null) {
            avisos.push(`Dependente do plano "${d.nome}" sem data de nascimento — fora do cálculo.`);
            continue;
          }
          const v = precoPlano(p, tipo, id);
          total += v;
          partes.push(`${d.nome} ${id} anos ${brl(r2(v))}`);
        }
        const empresa = p.empresaPagaAmbulatorialTitular ? precoPlano(p, "ambulatorial", idadeTit) : 0;
        planoSaude = r2(Math.max(0, total - empresa));
        memoria.planoSaude =
          `${ROTULO_PLANO[tipo]}: ${partes.join(" + ")} = ${brl(r2(total))}` +
          (empresa ? ` − ${brl(r2(empresa))} (Ambulatorial do titular, pago pela empresa).` : ".");
      }
    }
  }
  planoSaude = aj("planoSaude", planoSaude);
  const coparticipacao = afastado ? 0 : r2(l.coparticipacao);
  if (!afastado && c.odontoVidas) memoria.odonto = `${c.odontoVidas} vida(s) × ${brl(p.odontoPorVida)}.`;
  const odonto = aj("odonto", afastado ? 0 : r2(c.odontoVidas * p.odontoPorVida));
  const outrosDescontos = afastado ? 0 : r2(l.outrosDescontos + fixoDesc);
  if (fixoDesc && !afastado) memoria.outrosDescontos = `${l.outrosDescontos ? `${brl(l.outrosDescontos)} informados + ` : ""}fixos: ${rotFixos("desconto")}.`;

  let irrf = 0;
  if (semEncargos) memoria.irrf = e.contrato === "socio" ? "Sócio." : "PJ / prestador.";
  else if (afastado) memoria.irrf = "Afastado.";
  else {
    const r = calcularIrrf(salarioMes, Math.max(0, inss + inssFerias), c.dependentesIr, p.irrf);
    irrf = r.valor;
    memoria.irrf = r.memoria;
  }
  irrf = aj("irrf", irrf);

  const totalDescontos = r2(inss + inssFerias + vtDesconto + planoSaude + coparticipacao + odonto + irrf + outrosDescontos);
  const saldo = r2(totalEntradas - totalDescontos);
  if (c.adiantamento && !afastado) memoria.adiantamento = `${pct(p.adiantamentoPercentual)} do salário de carteira (${brl(salario)}).`;
  const adiantamento = aj("adiantamento", c.adiantamento && !afastado ? r2(salario * p.adiantamentoPercentual) : 0);
  const quintoDiaUtil = r2(saldo - adiantamento);
  if (quintoDiaUtil < 0) avisos.push("O valor a pagar no 5º dia útil ficou negativo — confira descontos e adiantamento.");

  // EXTRAS
  const comissao = r2(l.comissao);
  let alimentacao = 0;
  if (c.alimentacao > 0) {
    if (semBeneficio) memoria.alimentacao = `${ROTULO_SITUACAO[l.situacao]}: sem alimentação.`;
    else {
      const diasAlim = dias + diasFerias;
      alimentacao = r2((c.alimentacao / 30) * diasAlim);
      memoria.alimentacao = `${brl(c.alimentacao)} ÷ 30 × ${n(diasAlim)} dias (trabalhados + férias).`;
    }
  }
  alimentacao = aj("alimentacao", alimentacao);
  const totalBeneficio = r2(alimentacao + valeGasolina);
  const totalExtras = r2(comissao + valeTransporte + totalBeneficio);
  if (ehClt && !afastado && !estagio) {
    memoria.fgts = `${pct(pctFgts)} × ${brl(r2(salarioMes + totalFerias))} (salário do mês + férias)${e.contrato === "aprendiz" ? " — jovem aprendiz" : ""}.`;
  }
  const fgts = aj("fgts", ehClt && !afastado && !estagio ? r2((salarioMes + totalFerias) * pctFgts) : 0);
  const totalGeral = r2(totalExtras + saldo);

  return {
    solidesId: e.solidesId,
    nome: e.nome,
    setor: e.setor,
    centroCusto: e.centroCusto,
    empresaId: e.empresaId,
    contrato: e.contrato,
    situacao: l.situacao,
    salarioCarteira: salario,
    salarioMes,
    salarioFamilia,
    homeOffice,
    totalEntradas,
    ferias,
    tercoFerias,
    totalFerias,
    premioFerias: premio,
    inss,
    inssFerias,
    vtDesconto,
    planoSaude,
    coparticipacao,
    odonto,
    irrf,
    outrosDescontos,
    totalDescontos,
    saldo,
    adiantamento,
    quintoDiaUtil,
    comissao,
    alimentacao,
    valeTransporte,
    valeGasolina,
    totalBeneficio,
    totalExtras,
    fgts,
    totalGeral,
    memoria,
    avisos,
    ajustados,
    automatico: {
      diasTrabalhados: diasAuto,
      inssFerias: inssFeriasAuto,
      vtDiasDesconto: Math.max(0, diasMesVt - vtDiasAuto),
      diasUteisMes: diasMesVt,
      vtDias,
      diasFerias: progr.dias,
    },
    recorrentes: fixos,
    bases: {
      inss: ehClt && !afastado && !c.semInss && salario > 0 ? r2(salarioMes + totalFerias) : 0,
      irrf: !semEncargos && !afastado ? salarioMes : 0,
      fgts: ehClt && !afastado && !estagio ? r2(salarioMes + totalFerias) : 0,
      patronal: ehClt && !afastado && !licenca ? r2(salarioMes + totalFerias) : 0,
      aliquotaFgts: pctFgts,
    },
  };
}

/** Soma coluna a coluna (o rodapé da tabela). */
export function somarFolha(linhas: DpFolhaValores[]): DpFolhaValores {
  const t = Object.fromEntries(COLUNAS_FOLHA.map((k) => [k, 0])) as DpFolhaValores;
  for (const l of linhas) for (const k of COLUNAS_FOLHA) t[k] = r2(t[k] + l[k]);
  return t;
}
