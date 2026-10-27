// =============================================================================
// A empresa USA grupos de despesa?
//
// Chave do card "Grupos de despesa" na Configuração da empresa (27/10/2026).
// Ligada, o admin cadastra os grupos na árvore e a montagem oferece o campo
// "grupo"; desligada, somem as opções e o cadastro.
//
// ── A polaridade mora AQUI, e só aqui ──────────────────────────────────────
// `orcamento_grupos_despesa_ativo` lista as empresas ATIVAS — o inverso de
// `orcamento_metodos_ocultos`, que lista as escondidas. As duas guardam a
// EXCEÇÃO; o que muda é qual lado é o padrão (lá "aparece", aqui "não
// aparece"). Quem ler as duas tabelas lado a lado vai supor errado em uma
// delas, então a leitura da linha passa por uma função nomeada, com teste, em
// vez de um `.has()` solto em cada chamador.
//
// ── Isto esconde a PORTA, não o número ────────────────────────────────────
// Desligar não apaga nada: o `grupo_id` continua em cada despesa, e a Prévia
// continua mostrando o subnível que já existe. O que a chave governa é o que se
// OFERECE daqui em diante. Ver a migration 20261027130000.
// =============================================================================

import type { createClient } from "@/lib/supabase/server";
import { isSchemaMissing } from "@/lib/orcamento/errors";

type Supabase = Awaited<ReturnType<typeof createClient>>;

/**
 * A empresa usa grupos de despesa?
 *
 * `ativas` é o conjunto de `company_id` presentes na tabela. **Conjunto vazio =
 * NENHUMA empresa usa** — é o padrão pedido, e é o oposto do que a intuição
 * sugere para quem vem de `orcamento_metodos_ocultos`.
 */
export function gruposAtivosNaEmpresa(
  ativas: ReadonlySet<string>,
  companyId: string | null | undefined,
): boolean {
  if (!companyId) return false;
  return ativas.has(companyId);
}

/**
 * Lê a chave de uma empresa.
 *
 * **Tabela ausente devolve `true`**, e isso não contradiz o padrão desligado:
 * tabela ausente significa que a chave ainda não existe no banco (migration não
 * aplicada), e aí o certo é o comportamento de antes dela — que era oferecer
 * grupos a todo mundo. Devolver `false` faria o cadastro da empresa que JÁ usa
 * grupos sumir da tela entre o deploy e a migration, sem ninguém ter mexido na
 * chave. Depois de aplicada, a tabela semeia justamente essa empresa, então não
 * há janela em que trabalho feito desapareça.
 */
export async function gruposDespesaAtivo(
  supabase: Supabase,
  companyId: string,
): Promise<boolean> {
  if (!companyId) return false;
  const { data, error } = await supabase
    .from("orcamento_grupos_despesa_ativo")
    .select("company_id")
    .eq("company_id", companyId)
    .maybeSingle();
  if (error) {
    if (isSchemaMissing(error.message) || error.code === "42P01") return true;
    // Qualquer outra falha de leitura cai no lado que não esconde cadastro: a
    // chave é sobre a porta, e fechá-la por causa de uma instabilidade de rede
    // faria o admin concluir que o cadastro dele sumiu.
    return true;
  }
  return Boolean(data);
}
