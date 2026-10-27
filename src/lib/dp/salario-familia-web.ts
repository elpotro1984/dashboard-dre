import "server-only";

import { z } from "zod";

import { buscarNaWeb } from "@/lib/ai/busca-web";
import { sanearSalarioFamilia } from "@/lib/dp/beneficios-config";

// Tabela ATUAL do salário-família pesquisada na web, para o bloco de Benefícios.
// O valor é federal (portaria interministerial MPS/MF de cada ano) — a busca
// devolve uma PROPOSTA que preenche o formulário; gravar continua sendo o
// "Salvar" de quem conferiu. Número fora da grandeza vira vazio
// (sanearSalarioFamilia), em vez de entrar no cadastro.

const Schema = z.object({
  cota: z.number().nullable().describe("Valor da cota do salário-família POR FILHO, em reais, vigente hoje. Null se não encontrado."),
  limite: z
    .number()
    .nullable()
    .describe("Remuneração mensal MÁXIMA para ter direito ao salário-família, em reais, vigente hoje. Null se não encontrado."),
  vigencia: z.string().nullable().describe("Desde quando os valores valem (ex.: 'a partir de 01/01/2026'). Null se não claro."),
  ato: z.string().nullable().describe("O ato que fixou os valores (ex.: 'Portaria Interministerial MPS/MF nº 13/2026'). Null se não claro."),
});

export interface SalarioFamiliaEncontrado {
  cota: number | null;
  limite: number | null;
  vigencia: string | null;
  fonte: string | null;
  fontes: string[];
}

export async function buscarSalarioFamiliaNaWeb(ano: number): Promise<{ ok: true; dados: SalarioFamiliaEncontrado } | { ok: false; error: string }> {
  const r = await buscarNaWeb({
    modulo: "dp",
    schema: Schema,
    system:
      "Você pesquisa legislação trabalhista e previdenciária do Brasil. Use a busca na web e reporte só o que encontrar, " +
      "com o valor, o ato normativo e a fonte. Prefira fontes oficiais (gov.br, INSS, Diário Oficial da União). " +
      "Se não encontrar um valor, diga explicitamente que não encontrou — nunca estime.",
    prompt:
      `Qual é o valor ATUAL (vigente em ${ano}) da cota do salário-família por filho e o limite de remuneração mensal para ` +
      `ter direito a ele? Os valores são reajustados todo ano por portaria interministerial MPS/MF (em 2026: Portaria ` +
      `Interministerial MPS/MF nº 13/2026). Procure a portaria de ${ano} e informe: a cota, o limite de remuneração, desde ` +
      "quando valem e o número da portaria.",
    extracao:
      "Extraia do relatório abaixo os valores do salário-família. NÃO invente nem estime: valor sem número claro em reais " +
      "fica null. Não confunda com o salário mínimo nem com faixas do INSS.",
  });
  if (!r.ok) return { ok: false, error: r.error };
  const { cota, limite } = sanearSalarioFamilia({ cota: r.data.cota, limite: r.data.limite });
  return {
    ok: true,
    dados: {
      cota,
      limite,
      vigencia: r.data.vigencia,
      fonte: [r.data.ato, r.fontes[0]].filter(Boolean).join(" — ") || null,
      fontes: r.fontes,
    },
  };
}
