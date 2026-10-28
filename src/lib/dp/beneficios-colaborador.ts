// ============================================================================
// BENEFÍCIOS do COLABORADOR — o card "Benefícios" da ficha (28/10/2026). Puro e
// testado: a tela usa estas funções para a prévia ao vivo e o servidor, para
// validar e conferir o que vai gravar.
//
// A pessoa ESCOLHE; o valor vem do cadastro da EMPRESA (Configurações ›
// Benefícios) na hora da leitura. Por isso o que se grava é a escolha — o id
// da faixa, do bilhete, da modalidade, o nº de dias presenciais —, nunca o
// valor: um reajuste no bloco da empresa chega sozinho a todo mundo que o usa.
// O nome do item vai junto da escolha só para dizer QUAL sumiu, se a empresa o
// remover; o id é que decide.
//
//   Vale-alimentação     faixa        → valor por dia ou no mês (regra da empresa)
//   Vale-transporte      bilhete      → valor por dia
//   Auxílio gasolina     faixa de km  → valor no mês
//   Auxílio carona       faixa de km  → valor no mês
//   Auxílio home office  dias presenciais na semana → valor no mês
//   Clube SESI           modalidade   → valor no mês
//   Salário-família      pelas regras + filhos (Sólides e os cadastrados aqui)
//   Assiduidade          sim/não      → valor no mês
//   Outros benefícios    rótulo + valor + DESTINO: soma no benefício escolhido
//                        (na unidade dele) ou fica "Separado", sem somar a nada.
//
// Por enquanto é CADASTRO: a Folha do mês segue com o cadastro da folha (janela
// da pessoa). Ligar os dois é a etapa seguinte.
// ============================================================================

import {
  BLOCOS_BENEFICIO,
  ROTULO_BLOCO,
  blocoValido,
  MAX_DIAS_HOME_OFFICE,
  rotuloDias,
  rotuloFaixa,
  type DpBeneficiosDados,
  type DpBlocoBeneficio,
} from "@/lib/dp/beneficios-config";
import { grupoContratoFolha } from "@/lib/dp/folha/motor";

/** Escolha de um item do cadastro da empresa. */
export interface DpEscolhaItem {
  id: string;
  /** Nome do item quando foi escolhido — só para a mensagem, se ele sair do cadastro. */
  nome: string;
}

/** Filho cadastrado AQUI: o que não está na Sólides, ou que a corrige (mesmo nome = vale o daqui). */
export interface DpFilhoSalarioFamilia {
  id: string;
  nome: string;
  nascimento: string;
  /** Inválido recebe em qualquer idade (Lei 8.213/1991, art. 66). */
  invalido: boolean;
}

export type DpDestinoOutro = DpBlocoBeneficio | "separado";
export const DESTINOS_OUTROS: DpDestinoOutro[] = [...BLOCOS_BENEFICIO, "separado"];
export const ROTULO_DESTINO: Record<DpDestinoOutro, string> = { ...ROTULO_BLOCO, separado: "Separado" };

export interface DpOutroBeneficio {
  id: string;
  rotulo: string;
  valor: number;
  destino: DpDestinoOutro;
}

export interface DpBeneficiosColaborador {
  alimentacao: DpEscolhaItem | null;
  transporte: DpEscolhaItem | null;
  gasolina: DpEscolhaItem | null;
  carona: DpEscolhaItem | null;
  /** Dias presenciais na semana (a chave do bloco da empresa); null = não recebe. */
  homeOfficeDias: number | null;
  sesi: DpEscolhaItem | null;
  filhos: DpFilhoSalarioFamilia[];
  assiduidade: boolean;
  outros: DpOutroBeneficio[];
}

export const BENEFICIOS_COLABORADOR_VAZIO: DpBeneficiosColaborador = {
  alimentacao: null,
  transporte: null,
  gasolina: null,
  carona: null,
  homeOfficeDias: null,
  sesi: null,
  filhos: [],
  assiduidade: false,
  outros: [],
};

export const MAX_FILHOS = 20;
export const MAX_OUTROS = 30;
const VALOR_MAXIMO = 1_000_000;

const r2 = (v: number) => Math.round((v + Number.EPSILON) * 100) / 100;
const brl = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const chave = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/\s+/g, " ")
    .toLowerCase()
    .trim();
const DATA = /^\d{4}-\d{2}-\d{2}$/;

function dataValida(s: string): boolean {
  if (!DATA.test(s)) return false;
  const [y, m, d] = s.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

/** "1 dia presencial", "3 dias presenciais" (0 = todo remoto). */
export const rotuloPresenciais = (dias: number) => `${rotuloDias(dias)} ${dias === 1 ? "presencial" : "presenciais"}`;

const fmtData = (s: string) => `${s.slice(8, 10)}/${s.slice(5, 7)}/${s.slice(0, 4)}`;
const fmtMes = (s: string) => `${s.slice(5, 7)}/${s.slice(0, 4)}`;

// ── Validação (o que entra no banco) ───────────────────────────────────────

class Recusa extends Error {}

function texto(v: unknown, max: number): string | null {
  if (typeof v !== "string") return null;
  const t = v.replace(/\s+/g, " ").trim();
  return t ? t.slice(0, max) : null;
}

function idDe(v: unknown, i: number, vistos: Set<string>): string {
  let id = typeof v === "string" && v.trim() ? v.trim().slice(0, 64) : `item-${i + 1}`;
  while (vistos.has(id)) id = `${id}-${i + 1}`;
  vistos.add(id);
  return id;
}

function escolha(v: unknown): DpEscolhaItem | null {
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  const id = texto(o.id, 64);
  if (!id) return null;
  return { id, nome: texto(o.nome, 120) ?? "" };
}

function lista(v: unknown, max: number, oQue: string): Record<string, unknown>[] {
  if (!Array.isArray(v)) return [];
  if (v.length > max) throw new Recusa(`${oQue}: no máximo ${max}.`);
  return v.filter((x): x is Record<string, unknown> => Boolean(x) && typeof x === "object");
}

function filhos(v: unknown, hoje: string): DpFilhoSalarioFamilia[] {
  const vistos = new Set<string>();
  const nomes = new Set<string>();
  return lista(v, MAX_FILHOS, "Filhos do salário-família").map((x, i) => {
    const nome = texto(x.nome, 120);
    if (!nome) throw new Recusa(`Salário-família: dê o nome do filho ${i + 1}.`);
    if (nomes.has(chave(nome))) throw new Recusa(`Salário-família: "${nome}" aparece duas vezes.`);
    nomes.add(chave(nome));
    const nascimento = typeof x.nascimento === "string" ? x.nascimento.trim() : "";
    if (!nascimento) throw new Recusa(`Salário-família: informe o nascimento de ${nome}.`);
    if (!dataValida(nascimento)) throw new Recusa(`Salário-família: data de nascimento de ${nome} inválida.`);
    if (nascimento > hoje) throw new Recusa(`Salário-família: o nascimento de ${nome} está no futuro.`);
    return { id: idDe(x.id, i, vistos), nome, nascimento, invalido: x.invalido === true };
  });
}

function outros(v: unknown): DpOutroBeneficio[] {
  const vistos = new Set<string>();
  return lista(v, MAX_OUTROS, "Outros benefícios").map((x, i) => {
    const rotulo = texto(x.rotulo, 80);
    if (!rotulo) throw new Recusa(`Outros benefícios: dê um rótulo à linha ${i + 1}.`);
    const bruto = x.valor;
    if (bruto === null || bruto === undefined || bruto === "") throw new Recusa(`Outros benefícios — ${rotulo}: informe o valor.`);
    const valor = typeof bruto === "number" ? bruto : Number(bruto);
    if (!Number.isFinite(valor) || valor <= 0) throw new Recusa(`Outros benefícios — ${rotulo}: o valor precisa ser maior que zero.`);
    if (valor > VALOR_MAXIMO) throw new Recusa(`Outros benefícios — ${rotulo}: valor alto demais.`);
    const destino = x.destino === "separado" || blocoValido(x.destino) ? (x.destino as DpDestinoOutro) : null;
    if (!destino) throw new Recusa(`Outros benefícios — ${rotulo}: escolha para onde vai o valor.`);
    return { id: idDe(x.id, i, vistos), rotulo, valor: r2(valor), destino };
  });
}

function normalizar(raw: unknown, hoje: string): DpBeneficiosColaborador {
  const o = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  let homeOfficeDias: number | null = null;
  if (o.homeOfficeDias !== null && o.homeOfficeDias !== undefined && o.homeOfficeDias !== "") {
    const d = Number(o.homeOfficeDias);
    if (!Number.isInteger(d) || d < 0 || d > MAX_DIAS_HOME_OFFICE) {
      throw new Recusa(`Auxílio home office: dias presenciais é um número inteiro de 0 a ${MAX_DIAS_HOME_OFFICE}.`);
    }
    homeOfficeDias = d;
  }
  return {
    alimentacao: escolha(o.alimentacao),
    transporte: escolha(o.transporte),
    gasolina: escolha(o.gasolina),
    carona: escolha(o.carona),
    homeOfficeDias,
    sesi: escolha(o.sesi),
    filhos: filhos(o.filhos, hoje),
    assiduidade: o.assiduidade === true,
    outros: outros(o.outros),
  };
}

/** O que a tela mandou, pronto para gravar — ou a frase do que está errado. `hoje` = AAAA-MM-DD (Brasília). */
export function validarBeneficiosColaborador(raw: unknown, hoje: string): { ok: DpBeneficiosColaborador } | { erro: string } {
  try {
    return { ok: normalizar(raw, hoje) };
  } catch (e) {
    if (e instanceof Recusa) return { erro: e.message };
    throw e;
  }
}

/**
 * Leitura do banco: o gravado passou pela validação; o que não passar cai no
 * vazio em vez de derrubar a ficha. A data de nascimento no futuro não existe
 * aqui (foi recusada ao gravar), então `hoje` distante basta.
 */
export function lerBeneficiosColaborador(raw: unknown): DpBeneficiosColaborador {
  const r = validarBeneficiosColaborador(raw, "9999-12-31");
  return "ok" in r ? r.ok : BENEFICIOS_COLABORADOR_VAZIO;
}

// ── Conferência contra o cadastro da EMPRESA (ao gravar) ───────────────────

type BlocoEscolha = "alimentacao" | "transporte" | "gasolina" | "carona" | "sesi";

function itensDoBloco(cfg: DpBeneficiosDados, bloco: BlocoEscolha): Array<{ id: string; nome: string }> {
  switch (bloco) {
    case "alimentacao":
      return cfg.alimentacao.faixas;
    case "transporte":
      return cfg.transporte.bilhetes;
    case "sesi":
      return cfg.sesi.modalidades;
    case "gasolina":
    case "carona":
      return cfg[bloco].faixas.map((f) => ({ id: f.id, nome: rotuloFaixa(bloco, f) }));
  }
}

/** As opções que a tela oferece em cada bloco de escolha (id + rótulo + valor). */
export function opcoesDoBloco(cfg: DpBeneficiosDados, bloco: BlocoEscolha): Array<{ id: string; nome: string; valor: number }> {
  switch (bloco) {
    case "alimentacao":
      return cfg.alimentacao.faixas.map((f) => ({ id: f.id, nome: f.nome, valor: f.valor }));
    case "transporte":
      return cfg.transporte.bilhetes.map((b) => ({ id: b.id, nome: b.nome, valor: b.valor }));
    case "sesi":
      return cfg.sesi.modalidades.map((m) => ({ id: m.id, nome: m.nome, valor: m.valor }));
    case "gasolina":
    case "carona":
      return cfg[bloco].faixas.map((f) => ({ id: f.id, nome: rotuloFaixa(bloco, f), valor: f.valor }));
  }
}

export const BLOCOS_ESCOLHA: BlocoEscolha[] = ["alimentacao", "transporte", "gasolina", "carona", "sesi"];

/**
 * Toda escolha tem de existir no cadastro ATUAL da empresa — uma aba aberta
 * antes de alguém remover a faixa ainda posta, e gravar uma referência que
 * não resolve deixaria a pessoa com um benefício de valor zero sem ninguém ver.
 */
export function conferirComEmpresa(e: DpBeneficiosColaborador, cfg: DpBeneficiosDados): string | null {
  for (const b of BLOCOS_ESCOLHA) {
    const esc = e[b];
    if (esc && !itensDoBloco(cfg, b).some((i) => i.id === esc.id)) {
      return `${ROTULO_BLOCO[b]}: ${esc.nome ? `“${esc.nome}”` : "a opção escolhida"} não existe mais no cadastro da empresa. Escolha outra.`;
    }
  }
  if (e.homeOfficeDias !== null && !cfg.home_office.porDias.some((x) => x.dias === e.homeOfficeDias)) {
    return `Auxílio home office: o cadastro da empresa não tem valor para ${rotuloPresenciais(e.homeOfficeDias)}.`;
  }
  if (e.assiduidade && cfg.assiduidade.valor === null) {
    return "Assiduidade: a empresa não tem o valor cadastrado (Configurações › Benefícios).";
  }
  return null;
}

// ── Salário-família ────────────────────────────────────────────────────────

export interface DpDependenteFicha {
  nome: string;
  nascimento: string | null;
  parentesco: string | null;
}

export interface DpFilhoAvaliado {
  nome: string;
  nascimento: string | null;
  invalido: boolean;
  origem: "solides" | "ficha";
  conta: boolean;
  motivo: string;
}

/** Filho ou equiparado na Sólides (o rótulo visto em 28/10/2026 é "Filho/Enteado"). */
export function ehFilho(parentesco: string | null): boolean {
  return /filh|entead|tutel/.test(chave(parentesco ?? ""));
}

/** Competência (AAAA-MM) em que a pessoa completa 14 anos. */
function mesDos14(nascimento: string): string {
  return `${Number(nascimento.slice(0, 4)) + 14}-${nascimento.slice(5, 7)}`;
}

/**
 * Os filhos que entram na conta: os da Sólides (filho/enteado) e os cadastrados
 * aqui, que vencem o da Sólides de mesmo nome — é como se corrige a data ou
 * marca um filho inválido sem mexer na Sólides. Conta quem tem até 14 anos, e o
 * mês do aniversário de 14 ainda conta (a cota cessa no mês SEGUINTE —
 * Decreto 3.048/1999, art. 88); inválido conta em qualquer idade.
 */
export function avaliarFilhos(dependentes: DpDependenteFicha[], cadastrados: DpFilhoSalarioFamilia[], hoje: string): DpFilhoAvaliado[] {
  const daqui = new Map(cadastrados.map((f) => [chave(f.nome), f]));
  const out: DpFilhoAvaliado[] = [];
  const avaliar = (f: { nome: string; nascimento: string | null; invalido: boolean }, origem: DpFilhoAvaliado["origem"]): DpFilhoAvaliado => {
    const base = { nome: f.nome, nascimento: f.nascimento, invalido: f.invalido, origem };
    if (f.invalido) return { ...base, conta: true, motivo: "inválido — conta em qualquer idade" };
    if (!f.nascimento || !dataValida(f.nascimento)) return { ...base, conta: false, motivo: "sem data de nascimento — cadastre abaixo para contar" };
    if (f.nascimento > hoje) return { ...base, conta: false, motivo: "nascimento no futuro — confira a data" };
    const limite = mesDos14(f.nascimento);
    return limite >= hoje.slice(0, 7)
      ? { ...base, conta: true, motivo: `até 14 anos (completa em ${fmtMes(limite)})` }
      : { ...base, conta: false, motivo: `completou 14 anos em ${fmtMes(limite)}` };
  };
  for (const d of dependentes) {
    if (!ehFilho(d.parentesco) || daqui.has(chave(d.nome))) continue;
    out.push(avaliar({ nome: d.nome, nascimento: d.nascimento, invalido: false }, "solides"));
  }
  for (const f of cadastrados) out.push(avaliar(f, "ficha"));
  return out;
}

// ── Resolução: o que a pessoa recebe, com o valor da empresa ───────────────

export type DpUnidadeBeneficio = "dia" | "mes";

export interface DpLinhaBeneficio {
  bloco: DpBlocoBeneficio;
  rotulo: string;
  /** O que foi escolhido, em texto ("Operacional", "de 0 a 10 km", "2 dias presenciais", "Sim"); null = não recebe. */
  escolha: string | null;
  /** Valor que vem do cadastro da empresa (0 sem escolha ou se a escolha não resolve). */
  base: number;
  unidade: DpUnidadeBeneficio;
  /** "Outros benefícios" que somam nesta linha, na unidade dela. */
  outros: Array<{ rotulo: string; valor: number }>;
  /** O valor do benefício: o do cadastro da empresa + os "outros" que vão para ele, na unidade dele. */
  valor: number;
  /** Memória curta ("2 filhos até 14 anos × R$ 67,54"). */
  detalhe: string | null;
  aviso: string | null;
}

export interface DpResumoBeneficios {
  /** Os oito blocos, sempre, na ordem do cadastro da empresa. */
  linhas: DpLinhaBeneficio[];
  separados: Array<{ rotulo: string; valor: number }>;
  filhos: DpFilhoAvaliado[];
}

/** A unidade de cada benefício: VT é por dia; VA segue a regra da empresa; o resto é no mês. */
export function unidadeDoDestino(cfg: DpBeneficiosDados, destino: DpDestinoOutro): DpUnidadeBeneficio {
  if (destino === "transporte") return "dia";
  if (destino === "alimentacao") return cfg.alimentacao.regra === "diario" ? "dia" : "mes";
  return "mes";
}

export const ROTULO_UNIDADE: Record<DpUnidadeBeneficio, string> = { dia: "por dia", mes: "no mês" };

/** O salário-família recebe quem é empregado: CLT e aprendiz — a mesma regra do motor da folha (sem tipo = CLT, com aviso). */
function salarioFamilia(
  cfg: DpBeneficiosDados["salario_familia"],
  filhosAvaliados: DpFilhoAvaliado[],
  pessoa: { tipoContrato: string | null; salario: number | null },
): Pick<DpLinhaBeneficio, "escolha" | "base" | "detalhe" | "aviso"> {
  const contrato = grupoContratoFolha(pessoa.tipoContrato);
  const n = filhosAvaliados.filter((f) => f.conta).length;
  const escolha = n > 0 ? `${n} ${n === 1 ? "filho" : "filhos"}` : null;
  if (contrato !== "clt" && contrato !== "aprendiz" && contrato !== "outro") {
    return { escolha, base: 0, detalhe: "Não se aplica: só empregado CLT (inclusive aprendiz) recebe salário-família.", aviso: null };
  }
  const avisos: string[] = [];
  if (contrato === "outro") avisos.push("Sem tipo de contrato na Sólides — considerado CLT.");
  if (n === 0) return { escolha, base: 0, detalhe: "Nenhum filho até 14 anos (ou inválido) cadastrado.", aviso: avisos.join(" ") || null };
  if (cfg.cota === null) {
    avisos.push("A empresa não tem a cota do salário-família cadastrada (Configurações › Benefícios).");
    return { escolha, base: 0, detalhe: null, aviso: avisos.join(" ") };
  }
  if (cfg.limite !== null && pessoa.salario !== null && pessoa.salario > cfg.limite) {
    return {
      escolha,
      base: 0,
      detalhe: `Salário de ${brl(pessoa.salario)} (Sólides) acima do limite de ${brl(cfg.limite)}: não recebe.`,
      aviso: avisos.join(" ") || null,
    };
  }
  if (cfg.limite === null) avisos.push("A empresa não tem o limite de remuneração cadastrado — o limite não foi conferido.");
  else if (pessoa.salario === null) avisos.push("Sem salário na Sólides — o limite de remuneração não foi conferido.");
  return {
    escolha,
    base: r2(n * cfg.cota),
    detalhe: `${n} ${n === 1 ? "filho" : "filhos"} × ${brl(cfg.cota)}${cfg.limite !== null && pessoa.salario !== null ? ` (salário dentro do limite de ${brl(cfg.limite)})` : ""}.`,
    aviso: avisos.join(" ") || null,
  };
}

/**
 * O card inteiro: cada benefício com o valor do cadastro da empresa e os
 * "outros" somados no destino — o valor POR DIA ou NO MÊS de cada um, e só.
 * Não há total de propósito (decisão do dono do projeto, 28/10/2026): quanto a
 * pessoa recebe no mês é conta da futura tela de gestão de benefícios, que
 * sabe os dias trabalhados.
 */
export function resolverBeneficios(input: {
  cfg: DpBeneficiosDados;
  escolhas: DpBeneficiosColaborador;
  pessoa: { tipoContrato: string | null; salario: number | null; dependentes: DpDependenteFicha[] };
  hoje: string;
}): DpResumoBeneficios {
  const { cfg, escolhas: e } = input;
  const filhosAvaliados = avaliarFilhos(input.pessoa.dependentes, e.filhos, input.hoje);

  const deEscolha = (b: BlocoEscolha): Pick<DpLinhaBeneficio, "escolha" | "base" | "detalhe" | "aviso"> => {
    const esc = e[b];
    if (!esc) return { escolha: null, base: 0, detalhe: null, aviso: null };
    const item = opcoesDoBloco(cfg, b).find((i) => i.id === esc.id);
    if (!item) {
      return {
        escolha: esc.nome || null,
        base: 0,
        detalhe: null,
        aviso: `${esc.nome ? `“${esc.nome}”` : "A opção escolhida"} não existe mais no cadastro da empresa — escolha outra.`,
      };
    }
    const detalhe =
      b === "transporte" ? (cfg.transporte.descontar6 ? "A empresa desconta 6% do salário (até o custo do VT)." : "A empresa não desconta os 6% do salário.") : null;
    return { escolha: item.nome, base: item.valor, detalhe, aviso: null };
  };

  const parte: Record<DpBlocoBeneficio, Pick<DpLinhaBeneficio, "escolha" | "base" | "detalhe" | "aviso">> = {
    alimentacao: deEscolha("alimentacao"),
    transporte: deEscolha("transporte"),
    gasolina: deEscolha("gasolina"),
    carona: deEscolha("carona"),
    home_office: (() => {
      if (e.homeOfficeDias === null) return { escolha: null, base: 0, detalhe: null, aviso: null };
      const escolha = rotuloPresenciais(e.homeOfficeDias);
      const x = cfg.home_office.porDias.find((d) => d.dias === e.homeOfficeDias);
      return x
        ? { escolha, base: x.valor, detalhe: null, aviso: null }
        : { escolha, base: 0, detalhe: null, aviso: `O cadastro da empresa não tem mais valor para ${rotuloPresenciais(e.homeOfficeDias)} — escolha outro.` };
    })(),
    sesi: deEscolha("sesi"),
    salario_familia: salarioFamilia(cfg.salario_familia, filhosAvaliados, input.pessoa),
    assiduidade: !e.assiduidade
      ? { escolha: null, base: 0, detalhe: null, aviso: null }
      : cfg.assiduidade.valor === null
        ? { escolha: "Sim", base: 0, detalhe: null, aviso: "A empresa não tem o valor da assiduidade cadastrado." }
        : { escolha: "Sim", base: cfg.assiduidade.valor, detalhe: null, aviso: null },
  };

  const separados: DpResumoBeneficios["separados"] = [];
  const outrosPor = new Map<DpBlocoBeneficio, Array<{ rotulo: string; valor: number }>>();
  for (const o of e.outros) {
    if (o.destino === "separado") separados.push({ rotulo: o.rotulo, valor: o.valor });
    else outrosPor.set(o.destino, [...(outrosPor.get(o.destino) ?? []), { rotulo: o.rotulo, valor: o.valor }]);
  }

  const linhas: DpLinhaBeneficio[] = BLOCOS_BENEFICIO.map((b) => {
    const outros = outrosPor.get(b) ?? [];
    return {
      bloco: b,
      rotulo: ROTULO_BLOCO[b],
      ...parte[b],
      unidade: unidadeDoDestino(cfg, b),
      outros,
      valor: r2(parte[b].base + outros.reduce((s, o) => s + o.valor, 0)),
    };
  });

  return { linhas, separados, filhos: filhosAvaliados };
}

/** "12/03/2015" — para a lista de filhos na tela. */
export const dataBR = (s: string | null) => (s && DATA.test(s) ? fmtData(s) : "—");
