import "server-only";

import { generateObject, generateText } from "ai";
import type { z } from "zod";

import { logResolvedUsage, resolveAiProvider, type AiModule } from "@/lib/ai/provider";

// =============================================================================
// BUSCA NA WEB em dois passes — o mecanismo que se provou na busca de preços do
// Orçamento (removida com a tela de viagem avulsa em 09/10/2026) e no módulo
// /viagens dormente: a ferramenta de busca devolve PROSA com o que achou, e um
// segundo modelo extrai os números para o schema. Extrair no mesmo turno fazia o
// modelo preencher campo que ele não tinha achado.
//
// Só a OpenAI tem a ferramenta de busca no nosso stack: `capability: web_search`
// força a OpenAI mesmo com outro provedor ativo. O consumo vai ao painel de IA.
// Nunca lança: devolve { ok: false, error } para o chamador dizer que não achou.
// =============================================================================

const TIMEOUT_MS = 120_000;

export type BuscaWebOutcome<T> = { ok: true; data: T; fontes: string[]; engine: string } | { ok: false; error: string };

function comTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return Promise.race([p, new Promise<never>((_, reject) => setTimeout(() => reject(new Error(`busca excedeu ${ms}ms`)), ms))]);
}

/** Só http(s): estas URLs viram link na tela. */
function fontesLimpas(brutas: unknown[]): string[] {
  return Array.from(
    new Set(
      (brutas as Array<Record<string, unknown>>)
        .map((s) => (typeof s?.url === "string" ? s.url : null))
        .filter((u): u is string => {
          if (!u) return false;
          try {
            const p = new URL(u).protocol;
            return p === "http:" || p === "https:";
          } catch {
            return false;
          }
        }),
    ),
  ).slice(0, 10);
}

export async function buscarNaWeb<S extends z.ZodType>(opts: {
  system: string;
  prompt: string;
  schema: S;
  /** Instrução do 2º passe, antes do relatório da busca. Deve proibir inventar valor. */
  extracao: string;
  modulo: AiModule;
}): Promise<BuscaWebOutcome<z.infer<S>>> {
  const resolved = await resolveAiProvider({ capability: "web_search" }).catch(() => null);
  if (!resolved) return { ok: false, error: "Sem chave da OpenAI configurada no painel de IA." };
  const provider = resolved.provider;

  const tentativas: Array<{ engine: string; run: () => Promise<{ text: string; sources?: unknown[]; usage?: unknown }> }> = [
    {
      engine: "gpt-5-mini/web_search",
      run: () =>
        comTimeout(
          generateText({
            model: provider("gpt-5-mini"),
            system: opts.system,
            prompt: opts.prompt,
            tools: { web_search: provider.tools.webSearch({ searchContextSize: "high" }) },
            toolChoice: { type: "tool", toolName: "web_search" },
          }),
          TIMEOUT_MS,
        ),
    },
    {
      engine: "gpt-4o-mini/web_search_preview",
      run: () =>
        comTimeout(
          generateText({
            model: provider.responses("gpt-4o-mini"),
            system: opts.system,
            prompt: opts.prompt,
            tools: { web_search_preview: provider.tools.webSearchPreview({}) },
          }),
          TIMEOUT_MS,
        ),
    },
  ];

  const erros: string[] = [];
  for (const t of tentativas) {
    try {
      const res = await t.run();
      if (!res.text?.trim()) {
        erros.push(`${t.engine}: resposta vazia`);
        continue;
      }
      const { object, usage } = await generateObject({
        model: provider("gpt-4o-mini"),
        schema: opts.schema,
        temperature: 0,
        prompt: `${opts.extracao}\n\n${res.text}`,
      });
      await logResolvedUsage(resolved, opts.modulo, res.usage);
      await logResolvedUsage(resolved, opts.modulo, usage);
      return { ok: true, data: object as z.infer<S>, fontes: fontesLimpas(res.sources ?? []), engine: t.engine };
    } catch (err) {
      erros.push(`${t.engine}: ${(err instanceof Error ? err.message : String(err)).slice(0, 300)}`);
    }
  }
  const error = erros.join(" | ");
  console.warn(`[${opts.modulo}] busca na web falhou:`, error);
  return { ok: false, error };
}
