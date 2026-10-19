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
};

/** O que muda todo mês (a aba CONTROLE, parte variável). */
export interface DpFolhaLancamento {
  situacao: DpSituacaoFolha;
  diasTrabalhados: number;
  /** "Insuficiência de saldo / outros proventos": entra no salário do mês. */
  outrosProventos: number;
  diasFerias: number;
  /** INSS já descontado no recibo de férias (entra como dedução). */
  inssFerias: number;
  coparticipacao: number;
  outrosDescontos: number;
  comissao: number;
  /** Dias de VT/gasolina a descontar (faltas, férias, home office). */
  vtDiasDesconto: number;
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
  diasTrabalhados: 30,
  outrosProventos: 0,
  diasFerias: 0,
  inssFerias: 0,
  coparticipacao: 0,
  outrosDescontos: 0,
  comissao: 0,
  vtDiasDesconto: 0,
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

  // ENTRADAS
  const salarioProporcional = afastado ? 0 : dia * l.diasTrabalhados;
  memoria.salarioMes = afastado
    ? "Afastado: sem salário na folha."
    : `${brl(salario)} ÷ 30 × ${n(l.diasTrabalhados)} dias${l.outrosProventos ? ` + ${brl(l.outrosProventos)} de outros proventos` : ""}.`;
  const salarioMes = aj("salarioMes", afastado ? 0 : r2(salarioProporcional + l.outrosProventos));

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
  if (l.diasFerias > 0) {
    memoria.ferias = `${brl(salario)} ÷ 30 × ${n(l.diasFerias)} dias de férias.`;
    memoria.tercoFerias = estagio ? "Estágio: recesso sem 1/3." : "Um terço das férias.";
  }
  const ferias = aj("ferias", afastado ? 0 : r2(dia * l.diasFerias));
  const tercoFerias = aj("tercoFerias", afastado || estagio ? 0 : r2((dia * l.diasFerias) / 3));
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
  const inssFerias = inss > 0 && l.inssFerias > 0 ? -r2(l.inssFerias) : 0;
  if (inssFerias) memoria.inssFerias = "Já descontado no recibo de férias — sai do desconto do mês.";
  if (inss > 0 && l.diasFerias > 0 && l.inssFerias <= 0) {
    avisos.push("Há férias no mês, mas o INSS descontado no recibo de férias não foi informado — o INSS do mês pode estar em dobro.");
  }

  // Transporte (extras) — calculado antes porque o desconto de VT é limitado a ele.
  const escala = p.escalas.find((s) => s.nome === c.escala) ?? null;
  const diasMesVt = escala?.diasMes ?? 21;
  if (c.transporteTipo !== "nenhum" && !escala) avisos.push(`Escala "${c.escala}" não está nos parâmetros — usei ${diasMesVt} dias.`);
  const semBeneficio = afastado || licenca;
  let valeTransporte = 0;
  let valeGasolina = 0;
  if (c.transporteTipo === "bilhete") {
    const b = p.bilhetes.find((x) => x.nome === c.transporteOpcao) ?? null;
    if (!b) avisos.push(`Bilhete "${c.transporteOpcao ?? "—"}" não está nos parâmetros — VT zerado.`);
    else if (semBeneficio) memoria.valeTransporte = `${ROTULO_SITUACAO[l.situacao]}: sem VT.`;
    else {
      const dias = Math.max(0, diasMesVt - l.vtDiasDesconto);
      valeTransporte = r2(b.valorDiario * dias);
      memoria.valeTransporte = `${b.nome}: ${brl(b.valorDiario)} × ${n(dias)} dias (${n(diasMesVt)} da escala${l.vtDiasDesconto ? ` − ${n(l.vtDiasDesconto)} descontados` : ""}).`;
    }
    valeTransporte = aj("valeTransporte", valeTransporte);
  } else if (c.transporteTipo === "gasolina") {
    if (semBeneficio) memoria.valeGasolina = `${ROTULO_SITUACAO[l.situacao]}: sem gasolina.`;
    else {
      valeGasolina = r2(Math.max(0, c.transporteValor - (c.transporteValor / diasMesVt) * l.vtDiasDesconto));
      memoria.valeGasolina = l.vtDiasDesconto
        ? `${brl(c.transporteValor)} − ${brl(c.transporteValor)} ÷ ${n(diasMesVt)} × ${n(l.vtDiasDesconto)} dias descontados.`
        : `Valor mensal ${brl(c.transporteValor)}.`;
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
  const outrosDescontos = afastado ? 0 : r2(l.outrosDescontos);

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
      const dias = l.diasTrabalhados + l.diasFerias;
      alimentacao = r2((c.alimentacao / 30) * dias);
      memoria.alimentacao = `${brl(c.alimentacao)} ÷ 30 × ${n(dias)} dias (trabalhados + férias).`;
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
  };
}

/** Soma coluna a coluna (o rodapé da tabela). */
export function somarFolha(linhas: DpFolhaValores[]): DpFolhaValores {
  const t = Object.fromEntries(COLUNAS_FOLHA.map((k) => [k, 0])) as DpFolhaValores;
  for (const l of linhas) for (const k of COLUNAS_FOLHA) t[k] = r2(t[k] + l[k]);
  return t;
}
