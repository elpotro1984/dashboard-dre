// ============================================================================
// Planilha de CARGA dos benefícios por colaborador (28/10/2026). Puro e testado.
//
// É o contrato entre o modelo (scripts/dp-beneficios-modelo.ts) e a importação:
// os nomes das colunas e o TEXTO de cada opção nas listas suspensas. A
// importação casa o texto de volta com o item do cadastro da empresa, então os
// dois lados precisam ler daqui — um rótulo escrito à mão no gerador e outro na
// importação divergiriam, e a linha simplesmente não casaria.
//
// O texto da opção é o do card (`opcoesDoBloco`): nome da faixa, do bilhete, da
// modalidade; faixa de km por `rotuloFaixa`; home office por nº de dias.
// ============================================================================

import {
  opcoesDoBloco,
  rotuloPresenciais,
  ROTULO_DESTINO,
  DESTINOS_OUTROS,
  type DpBeneficiosColaborador,
} from "@/lib/dp/beneficios-colaborador";
import type { DpBeneficiosDados } from "@/lib/dp/beneficios-config";

export const ABA_COMO = "Como preencher";
export const ABA_FILHOS = "Filhos";
export const ABA_OUTROS = "Outros benefícios";
export const ABA_OPCOES = "Opções";
/** Aba oculta com as listas das validações. */
export const ABA_LISTAS = "_listas";

/** As colunas de escolha, na ordem da aba de cada empresa. */
export const COLUNAS_ESCOLHA = ["alimentacao", "transporte", "gasolina", "carona", "homeOffice", "sesi", "assiduidade"] as const;
export type DpColunaEscolha = (typeof COLUNAS_ESCOLHA)[number];

export const CABECALHO_PESSOA = {
  id: "ID Sólides (não altere)",
  nome: "Colaborador",
  departamento: "Departamento",
  cargo: "Cargo",
  contrato: "Contrato",
} as const;

export const CABECALHO_ESCOLHA: Record<DpColunaEscolha, string> = {
  alimentacao: "Vale-alimentação",
  transporte: "Vale-transporte",
  gasolina: "Auxílio gasolina (faixa ou km)",
  carona: "Auxílio carona (faixa ou km)",
  homeOffice: "Home office (dias presenciais)",
  sesi: "Clube SESI",
  assiduidade: "Assiduidade",
};

export const CABECALHO_FILHOS = ["Colaborador", "Nome do filho", "Nascimento", "Inválido"] as const;
export const CABECALHO_OUTROS = ["Colaborador", "Rótulo", "Valor", "Destino"] as const;

export const SIM_NAO = ["Sim", "Não"] as const;

/** Os destinos de "Outros benefícios" como aparecem na lista: os oito benefícios + Separado. */
export const DESTINOS_PLANILHA: string[] = DESTINOS_OUTROS.map((d) => ROTULO_DESTINO[d]);

/** "Ana Souza — Dataforte (ID 123)": o ID no fim é o que a importação lê; o resto é para quem escolhe. */
export function rotuloColaboradorPlanilha(p: { nome: string; empresa: string; solidesId: number }): string {
  return `${p.nome} — ${p.empresa} (ID ${p.solidesId})`;
}

/** O ID Sólides de um rótulo de colaborador (ou de um número digitado na coluna de ID). */
export function idDoColaboradorPlanilha(v: unknown): number | null {
  if (typeof v === "number") return Number.isInteger(v) && v > 0 ? v : null;
  if (typeof v !== "string") return null;
  const t = v.trim();
  const m = /\(ID\s*(\d+)\)\s*$/i.exec(t) ?? /^(\d+)$/.exec(t);
  return m ? Number(m[1]) : null;
}

type ColunaLista = Exclude<DpColunaEscolha, "assiduidade">;

/** O texto de cada opção da empresa, por coluna — é o que vai na lista suspensa. */
export function opcoesDaPlanilha(cfg: DpBeneficiosDados): Record<ColunaLista, string[]> {
  return {
    alimentacao: opcoesDoBloco(cfg, "alimentacao").map((o) => o.nome),
    transporte: opcoesDoBloco(cfg, "transporte").map((o) => o.nome),
    gasolina: opcoesDoBloco(cfg, "gasolina").map((o) => o.nome),
    carona: opcoesDoBloco(cfg, "carona").map((o) => o.nome),
    homeOffice: cfg.home_office.porDias.map((d) => rotuloPresenciais(d.dias)),
    sesi: opcoesDoBloco(cfg, "sesi").map((o) => o.nome),
  };
}

/**
 * O que a pessoa JÁ tem no card, no texto da planilha — o modelo vem com isso
 * preenchido, para a carga não apagar o que alguém já cadastrou. Escolha que
 * saiu do cadastro da empresa vira vazio: não há opção na lista para ela.
 */
export function escolhasNaPlanilha(e: DpBeneficiosColaborador, cfg: DpBeneficiosDados): Record<DpColunaEscolha, string> {
  const nome = (b: "alimentacao" | "transporte" | "gasolina" | "carona" | "sesi") => {
    const esc = e[b];
    return esc ? (opcoesDoBloco(cfg, b).find((o) => o.id === esc.id)?.nome ?? "") : "";
  };
  return {
    alimentacao: nome("alimentacao"),
    transporte: nome("transporte"),
    gasolina: nome("gasolina"),
    carona: nome("carona"),
    homeOffice:
      e.homeOfficeDias !== null && cfg.home_office.porDias.some((d) => d.dias === e.homeOfficeDias) ? rotuloPresenciais(e.homeOfficeDias) : "",
    sesi: nome("sesi"),
    assiduidade: e.assiduidade ? "Sim" : "",
  };
}
