// ============================================================================
// ENCARGOS DA EMPRESA na Configuração do DP — puro e testado. O DP edita o
// MESMO cadastro do Orçamento (`orcamento_encargos`, empresa × ano, e o regime
// tributário de `companies`), decisão do dono do projeto em 22/10/2026: são
// premissas da empresa, e duas fontes fariam o custo de uma pessoa sair
// diferente nos dois módulos. A regra de leitura continua sendo
// `resolverEncargos` (@/lib/orcamento/encargos).
//
// Aqui só se editam os três encargos PATRONAIS (INSS, RAT × FAP, terceiros). O
// FGTS da linha é do Orçamento — a folha do DP usa o dos Parâmetros da folha
// (8%, 2% do aprendiz) — e é PRESERVADO ao gravar: sobrescrevê-lo com um campo
// que a tela do DP nem mostra mudaria o Orçamento sem ninguém ver.
// ============================================================================

import { encargosPadrao, type EncargoValues } from "@/lib/orcamento/encargos";

export const REGIMES_TRIBUTARIOS = ["simples_nacional", "lucro_presumido", "lucro_real"] as const;
export type DpRegimeTributario = (typeof REGIMES_TRIBUTARIOS)[number];

export const ROTULO_REGIME: Record<DpRegimeTributario, string> = {
  simples_nacional: "Simples Nacional",
  lucro_presumido: "Lucro Presumido",
  lucro_real: "Lucro Real",
};

export type DpEncargoPatronal = "inss_patronal" | "rat_fap" | "terceiros";
export const ENCARGOS_PATRONAIS: readonly DpEncargoPatronal[] = ["inss_patronal", "rat_fap", "terceiros"];

const ROTULO: Record<DpEncargoPatronal, string> = {
  inss_patronal: "INSS patronal",
  rat_fap: "RAT × FAP",
  terceiros: "Terceiros",
};

export function regimeValido(v: unknown): v is DpRegimeTributario | null {
  return v === null || (REGIMES_TRIBUTARIOS as readonly unknown[]).includes(v);
}

/**
 * A linha a gravar em `orcamento_encargos`: os três patronais informados (0 a
 * 100, em pontos percentuais) e o FGTS que já estava lá — ou o padrão do
 * regime, quando a linha ainda não existe.
 */
export function linhaEncargosDp(
  informado: Record<DpEncargoPatronal, number>,
  fgtsAtual: number | null,
  regime: string | null,
): EncargoValues {
  const out = { fgts: fgtsAtual ?? encargosPadrao(regime).fgts } as EncargoValues;
  for (const k of ENCARGOS_PATRONAIS) {
    const v = informado[k];
    if (typeof v !== "number" || !Number.isFinite(v) || v < 0 || v > 100) throw new Error(`${ROTULO[k]}: use de 0 a 100%.`);
    out[k] = Math.round(v * 10000) / 10000;
  }
  return out;
}
