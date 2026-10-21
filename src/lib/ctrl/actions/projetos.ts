"use server";

import { requireCtrlRole } from "@/lib/ctrl/auth";
import { refreshProjetosDaOrg } from "@/lib/ctrl/omie-projetos";

// Botão "Atualizar agora" (campo Projeto da nova requisição): força a repuxada
// dos projetos da Omie para a EMPRESA ATIVA e devolve a lista fresca. A empresa
// vem da sessão (ctx.orgId), nunca do cliente — ninguém força a atualização de
// uma empresa que não acessa. Mesmos papéis que criam requisição.
export async function atualizarProjetosAgora(): Promise<{ projetos: string[] }> {
  const ctx = await requireCtrlRole(
    "solicitante",
    "gerente",
    "diretor",
    "csc",
    "contas_a_pagar",
    "admin",
  );
  const projetos = await refreshProjetosDaOrg(ctx.orgId);
  return { projetos };
}
