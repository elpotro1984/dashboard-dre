import "server-only";

import { readActiveDpEmpresa } from "@/lib/context/active-context";
import type { DpUserContext } from "@/lib/dp/auth";
import { listDpEmpresasComQuadro } from "@/lib/dp/cargos-queries";
import { escolherEmpresaAtiva, podeVerEmpresa } from "@/lib/dp/escopo";
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
