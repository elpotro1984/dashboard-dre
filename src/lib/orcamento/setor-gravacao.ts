// Em que setor uma linha de orçamento deve ser GRAVADA.
//
// Módulo "puro" (sem "use server"): as actions de média, valor fixo e
// planejamento chamam a mesma função, para o critério não divergir entre elas.
//
// O problema que ele resolve: empresa com "Orçar por setor" DESLIGADO não
// escolhe setor na tela, então o `setorId` chega nulo. Gravar NULL parece
// inofensivo, mas quebra o upsert — no Postgres dois NULLs são DISTINTOS num
// índice único, e as chaves dessas tabelas incluem `setor_id`:
//
//   UNIQUE (company_id, year, category_code, setor_id)
//
// Com setor nulo, o `onConflict` nunca encontra a linha anterior e INSERE uma
// nova a cada gravação: a mesma categoria vira 2, 3, 10 linhas, e a Prévia soma
// todas. Por isso toda linha cai num setor de verdade.
//
// O balde é o "Não atribuído" — criado aqui se ainda não existir. É também o
// lugar honesto para esse orçamento no dia em que a chave for ligada: ele
// aparece separado, esperando ser distribuído, em vez de fingir pertencer a um
// setor que ninguém escolheu.

import type { createClient } from "@/lib/supabase/server";
import { setorEspecifico } from "@/lib/orcamento/setor-filtro";

type Supabase = Awaited<ReturnType<typeof createClient>>;

/** Nome do setor-balde. Mesmo texto que a migration da Fase 1 usou no backfill. */
export const SETOR_NAO_ATRIBUIDO = "Não atribuído";

/**
 * Resolve o setor de gravação.
 *
 * Setor específico na tela → é ele. Caso contrário (empresa sem orçar por
 * setor, ou visão "Todos os setores") → o "Não atribuído" da empresa/ano.
 */
export async function setorParaGravar(
  supabase: Supabase,
  companyId: string,
  year: number,
  setorId: string | null | undefined,
  userId: string,
): Promise<{ id: string | null; error?: string }> {
  const especifico = setorEspecifico(setorId);
  if (especifico) return { id: especifico };

  const existente = await setorNaoAtribuido(supabase, companyId, year);
  // Tabela ausente (migration pendente) não pode derrubar a gravação: devolve
  // null e o chamador segue com o comportamento antigo.
  if (existente.error) return { id: null, error: existente.error };
  if (existente.id) return { id: existente.id };

  const { data: criado, error: insErr } = await supabase
    .from("orcamento_setores")
    .insert({ company_id: companyId, year, name: SETOR_NAO_ATRIBUIDO, updated_by: userId })
    .select("id")
    .maybeSingle();
  if (insErr) return { id: null, error: insErr.message };
  return { id: (criado?.id as string) ?? null };
}

/**
 * O balde "Não atribuído" da empresa × ano, SEM criá-lo.
 *
 * É o setor em que `setorParaGravar` põe tudo o que chega sem setor — então é
 * também o setor que uma tela de empresa SEM "Orçar por setor" tem de usar
 * quando precisa de UM setor concreto (a fatia do Finalizar e a trava dela).
 * Usar `null` ali procuraria uma fatia que nenhuma gravação produz: as linhas
 * estão no balde, não em setor nulo. `null` aqui = o balde ainda não existe,
 * logo nada foi gravado sem setor.
 */
export async function setorNaoAtribuido(
  supabase: Supabase,
  companyId: string,
  year: number,
): Promise<{ id: string | null; error?: string }> {
  const { data, error } = await supabase
    .from("orcamento_setores")
    .select("id")
    .eq("company_id", companyId)
    .eq("year", year)
    .ilike("name", SETOR_NAO_ATRIBUIDO)
    .maybeSingle();
  if (error) return { id: null, error: error.message };
  return { id: (data?.id as string | undefined) ?? null };
}

/**
 * A empresa orça por setor neste ano?
 *
 * Com a chave DESLIGADA o módulo inteiro deve trabalhar como se a empresa não
 * tivesse setores: sem seletor na tela, sem coluna de setor, e — o que não é
 * óbvio — sem casar as linhas gravadas por setor na leitura. A linha continua
 * tendo um setor no banco (é obrigatório para a chave única funcionar), mas ele
 * vira um detalhe de armazenamento que a tela não deve enxergar.
 */
export async function orcaPorSetor(
  supabase: Supabase,
  companyId: string,
  year: number,
): Promise<boolean> {
  const { data } = await supabase
    .from("orcamento_company_config")
    .select("orcar_por_setor")
    .eq("company_id", companyId)
    .eq("year", year)
    .maybeSingle();
  return Boolean(data?.orcar_por_setor);
}
