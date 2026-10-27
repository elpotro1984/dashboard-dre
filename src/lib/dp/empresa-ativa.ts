import "server-only";

import { readActiveDpEmpresa, readDpEmpresaConfirmedSession } from "@/lib/context/active-context";
import { currentCtrlConfirmationKey } from "@/lib/ctrl/orgs";
import type { DpUserContext } from "@/lib/dp/auth";
import { listDpEmpresasComQuadro } from "@/lib/dp/cargos-queries";
import { escolherEmpresaAtiva, podeVerEmpresa, precisaEscolherEmpresa } from "@/lib/dp/escopo";
import type { createAdminClient } from "@/lib/supabase/admin";

type AdminClient = ReturnType<typeof createAdminClient>;

export interface DpEmpresaRef {
  id: string;
  name: string;
  /** Colaboradores ativos desta empresa no espelho da Sólides. */
  ativos: number;
}

/**
 * As empresas que a pessoa pode ver (o seletor do topo) e a ativa. Gestor vê
 * todas as empresas ativas, inclusive as ainda sem quadro (é onde se monta a
 * tabela salarial antes de vincular); analista, só as liberadas a ela. Ordem:
 * quem tem quadro primeiro, depois o nome.
 */
export async function getDpEmpresaAtiva(
  db: AdminClient,
  user: DpUserContext,
): Promise<{ ativa: DpEmpresaRef | null; empresas: DpEmpresaRef[] }> {
  const todas = await listDpEmpresasComQuadro(db);
  const empresas = todas
    .filter((e) => podeVerEmpresa(user, e.id))
    .sort((a, b) => Number(b.ativos > 0) - Number(a.ativos > 0) || a.name.localeCompare(b.name, "pt-BR"));
  const id = escolherEmpresaAtiva(empresas, await readActiveDpEmpresa());
  return { ativa: empresas.find((e) => e.id === id) ?? null, empresas };
}

/**
 * Pede a escolha da empresa neste login? (ver precisaEscolherEmpresa). A chave
 * do login é a mesma do Compras (`currentCtrlConfirmationKey`): o session_id do
 * Supabase Auth. Devolve também a última empresa usada, se ainda for uma das
 * permitidas — só para a etiqueta "Última empresa utilizada".
 */
export async function dpEscolhaDeEmpresa(
  supabase: Parameters<typeof currentCtrlConfirmationKey>[0],
  userId: string,
  empresas: DpEmpresaRef[],
): Promise<{ pendente: boolean; ultimaId: string | null }> {
  const cookieId = await readActiveDpEmpresa();
  const ultimaId = empresas.some((e) => e.id === cookieId) ? cookieId : null;
  if (empresas.length <= 1) return { pendente: false, ultimaId };
  const [confirmada, chaveDoLogin] = await Promise.all([readDpEmpresaConfirmedSession(), currentCtrlConfirmationKey(supabase, userId)]);
  return { pendente: precisaEscolherEmpresa({ empresas, cookieId, confirmada, chaveDoLogin }), ultimaId };
}
