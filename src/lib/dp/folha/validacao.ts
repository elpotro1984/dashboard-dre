// ============================================================================
// Validação do que a tela da folha grava — pura e testada. A action só grava o
// que passou por aqui; a tela não decide regra (mesma divisão do resto do DP).
// ============================================================================

import {
  COLUNAS_AJUSTAVEIS,
  type DpColunaAjustavel,
  type DpFolhaCadastro,
  type DpFolhaLancamento,
  type DpRecorrente,
  type DpSituacaoFolha,
} from "@/lib/dp/folha/motor";
import { diasCorridos, type DpPeriodoFerias } from "@/lib/dp/folha/calendario";
import { PLANO_TIPOS, type DpFolhaParametros } from "@/lib/dp/folha/parametros";

const r2 = (v: number) => Math.round(v * 100) / 100;

function numero(v: unknown, campo: string, min: number, max: number): number {
  const n = typeof v === "number" ? v : Number(v);
  if (!Number.isFinite(n) || n < min || n > max) throw new Error(`${campo}: valor inválido.`);
  return n;
}

function inteiro(v: unknown, campo: string): number {
  const n = numero(v, campo, 0, 20);
  if (!Number.isInteger(n)) throw new Error(`${campo}: use um número inteiro.`);
  return n;
}

const SITUACOES: DpSituacaoFolha[] = ["normal", "afastado", "licenca_maternidade"];

export function validarCadastro(c: DpFolhaCadastro, p: DpFolhaParametros): DpFolhaCadastro {
  if (c.planoSaude !== "nenhum" && !PLANO_TIPOS.includes(c.planoSaude)) throw new Error("Plano de saúde inválido.");
  const deps = Array.isArray(c.planoDependentes) ? c.planoDependentes : [];
  if (deps.length > 10) throw new Error("No máximo 10 dependentes no plano.");
  const planoDependentes = deps.map((d, i) => {
    const nome = String(d?.nome ?? "").trim() || `Dependente ${i + 1}`;
    const nasc = d?.nascimento ? String(d.nascimento) : null;
    if (nasc && !/^\d{4}-\d{2}-\d{2}$/.test(nasc)) throw new Error(`Data de nascimento de "${nome}" inválida.`);
    return { nome: nome.slice(0, 120), nascimento: nasc };
  });
  if (!["nenhum", "bilhete", "gasolina"].includes(c.transporteTipo)) throw new Error("Transporte inválido.");
  if (c.transporteTipo === "bilhete" && !p.bilhetes.some((b) => b.nome === c.transporteOpcao)) {
    throw new Error("Escolha um bilhete cadastrado nos parâmetros.");
  }
  if (!p.escalas.some((e) => e.nome === c.escala)) throw new Error("Escolha uma escala cadastrada nos parâmetros.");
  return {
    planoSaude: c.planoSaude === "nenhum" ? "nenhum" : c.planoSaude,
    planoDependentes: c.planoSaude === "nenhum" ? [] : planoDependentes,
    odontoVidas: inteiro(c.odontoVidas, "Odontológico"),
    salarioFamiliaCotas: inteiro(c.salarioFamiliaCotas, "Salário-família"),
    dependentesIr: inteiro(c.dependentesIr, "Dependentes de IR"),
    adiantamento: Boolean(c.adiantamento),
    alimentacao: r2(numero(c.alimentacao, "Alimentação", 0, 100_000)),
    transporteTipo: c.transporteTipo,
    transporteOpcao: c.transporteTipo === "bilhete" ? c.transporteOpcao : null,
    transporteValor: c.transporteTipo === "gasolina" ? r2(numero(c.transporteValor, "Gasolina", 0, 100_000)) : 0,
    escala: c.escala,
    homeOffice: r2(numero(c.homeOffice, "Home office", 0, 100_000)),
    semInss: Boolean(c.semInss),
    setorFolha: String(c.setorFolha ?? "").replace(/\s+/g, " ").trim().slice(0, 120) || null,
    recorrentes: validarRecorrentes(c.recorrentes ?? []),
    ferias: validarFerias(c.ferias ?? []),
  };
}

const RE_COMP = /^\d{4}-(0[1-9]|1[0-2])$/;

/** Proventos/descontos fixos: descrição, valor > 0 e período coerente. */
export function validarRecorrentes(lista: DpRecorrente[]): DpRecorrente[] {
  if (!Array.isArray(lista)) throw new Error("Lista de fixos inválida.");
  if (lista.length > 30) throw new Error("No máximo 30 proventos/descontos fixos por pessoa.");
  return lista.map((r, i) => {
    const descricao = String(r?.descricao ?? "").replace(/\s+/g, " ").trim().slice(0, 120);
    if (!descricao) throw new Error(`Fixo ${i + 1}: informe a descrição.`);
    if (r.tipo !== "provento" && r.tipo !== "desconto") throw new Error(`"${descricao}": tipo inválido.`);
    const valor = numero(r.valor, `"${descricao}"`, 0.01, 1_000_000);
    if (!RE_COMP.test(String(r.inicio ?? ""))) throw new Error(`"${descricao}": mês de início inválido.`);
    const fim = r.fim ? String(r.fim) : null;
    if (fim && !RE_COMP.test(fim)) throw new Error(`"${descricao}": mês final inválido.`);
    if (fim && fim < r.inicio) throw new Error(`"${descricao}": o mês final é antes do início.`);
    return { id: String(r.id || `${Date.now()}-${i}`).slice(0, 60), tipo: r.tipo, descricao, valor: r2(valor), inicio: r.inicio, fim };
  });
}

const RE_DIA = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Férias programadas: datas válidas, fim depois do início, no máximo 30 dias
 * por período (a CLT permite fracionar em até 3) e sem sobreposição — dois
 * períodos no mesmo dia contariam a mesma férias duas vezes.
 */
export function validarFerias(lista: DpPeriodoFerias[]): DpPeriodoFerias[] {
  if (!Array.isArray(lista)) throw new Error("Lista de férias inválida.");
  if (lista.length > 20) throw new Error("No máximo 20 períodos de férias por pessoa.");
  const out = lista.map((f, i) => {
    if (!RE_DIA.test(String(f?.inicio ?? "")) || !RE_DIA.test(String(f?.fim ?? ""))) throw new Error(`Férias ${i + 1}: datas inválidas.`);
    if (f.fim < f.inicio) throw new Error(`Férias ${i + 1}: o fim é antes do início.`);
    if (diasCorridos(f.inicio, f.fim) > 30) throw new Error(`Férias ${i + 1}: mais de 30 dias num período.`);
    return { id: String(f.id || `${Date.now()}-${i}`).slice(0, 60), inicio: f.inicio, fim: f.fim };
  });
  const ord = out.slice().sort((a, b) => a.inicio.localeCompare(b.inicio));
  for (let i = 1; i < ord.length; i++) {
    if (ord[i].inicio <= ord[i - 1].fim) throw new Error("Há períodos de férias sobrepostos.");
  }
  return ord;
}

export function validarLancamento(l: DpFolhaLancamento): DpFolhaLancamento {
  if (!SITUACOES.includes(l.situacao)) throw new Error("Situação inválida.");
  const ajustes: DpFolhaLancamento["ajustes"] = {};
  for (const [k, a] of Object.entries(l.ajustes ?? {})) {
    if (!(COLUNAS_AJUSTAVEIS as readonly string[]).includes(k)) throw new Error(`Coluna "${k}" não aceita ajuste.`);
    if (!a) continue;
    const motivo = String(a.motivo ?? "").trim();
    // Ajuste sem motivo é o número que ninguém consegue explicar depois.
    if (!motivo) throw new Error("Todo ajuste manual precisa de um motivo.");
    ajustes[k as DpColunaAjustavel] = { valor: r2(numero(a.valor, "Ajuste", -1_000_000, 1_000_000)), motivo: motivo.slice(0, 300) };
  }
  return {
    situacao: l.situacao,
    diasTrabalhados: l.diasTrabalhados === null ? null : numero(l.diasTrabalhados, "Dias trabalhados", 0, 31),
    outrosProventos: r2(numero(l.outrosProventos, "Outros proventos", -1_000_000, 1_000_000)),
    diasFerias: l.diasFerias === null ? null : numero(l.diasFerias, "Dias de férias", 0, 31),
    inssFerias: l.inssFerias === null ? null : r2(numero(l.inssFerias, "INSS das férias", 0, 100_000)),
    coparticipacao: r2(numero(l.coparticipacao, "Coparticipação", -100_000, 100_000)),
    outrosDescontos: r2(numero(l.outrosDescontos, "Outros descontos", -1_000_000, 1_000_000)),
    comissao: r2(numero(l.comissao, "Comissão", -1_000_000, 1_000_000)),
    vtDiasDesconto: l.vtDiasDesconto === null ? null : numero(l.vtDiasDesconto, "Dias de VT a descontar", 0, 31),
    ajustes,
  };
}

/** Linhas do banco a partir do cadastro/lançamento validados. */
export function linhaCadastro(c: DpFolhaCadastro) {
  return {
    plano_saude: c.planoSaude,
    plano_dependentes: c.planoDependentes,
    odonto_vidas: c.odontoVidas,
    salario_familia_cotas: c.salarioFamiliaCotas,
    dependentes_ir: c.dependentesIr,
    adiantamento: c.adiantamento,
    alimentacao: c.alimentacao,
    transporte_tipo: c.transporteTipo,
    transporte_opcao: c.transporteOpcao,
    transporte_valor: c.transporteValor,
    escala: c.escala,
    home_office: c.homeOffice,
    sem_inss: c.semInss,
    setor_folha: c.setorFolha,
    recorrentes: c.recorrentes,
    ferias: c.ferias,
  };
}

export function linhaLancamento(l: DpFolhaLancamento) {
  return {
    situacao: l.situacao,
    dias_trabalhados: l.diasTrabalhados,
    outros_proventos: l.outrosProventos,
    dias_ferias: l.diasFerias,
    inss_ferias: l.inssFerias,
    coparticipacao: l.coparticipacao,
    outros_descontos: l.outrosDescontos,
    comissao: l.comissao,
    vt_dias_desconto: l.vtDiasDesconto,
    ajustes: l.ajustes,
  };
}

/** Campos do mês que a GRADE de lançamentos edita (os ajustes e a observação ficam como estão). */
export type DpCamposGrade = Omit<DpFolhaLancamento, "ajustes">;

/** Mescla a edição da grade sobre o lançamento gravado, preservando ajustes manuais. */
export function mesclarLancamento(gravado: DpFolhaLancamento | null, grade: DpCamposGrade): DpFolhaLancamento {
  return { ...grade, ajustes: gravado?.ajustes ?? {} };
}

/**
 * O que passa de um mês para o outro: só a SITUAÇÃO (afastado/licença
 * continuam até alguém mudar — esquecer pagaria salário a quem está
 * afastado). O que se REPETE com valor (consignado, pensão, gratificação) é
 * fixo no cadastro (`recorrentes`), com prazo; copiar os outros descontos aqui
 * também faria o consignado entrar duas vezes. Dias, férias, coparticipação,
 * comissão e ajustes são do mês e começam no automático.
 */
export function herdarDoMesAnterior(anterior: DpFolhaLancamento, base: DpFolhaLancamento): DpFolhaLancamento {
  return { ...base, situacao: anterior.situacao, ajustes: {} };
}
