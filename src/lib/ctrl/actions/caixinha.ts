"use server";

import { requireCtrlRole } from "@/lib/ctrl/auth";
import { caixinhaDoTipo, type SaldoCaixinha } from "@/lib/ctrl/caixinha";
import { lerSaldoCaixinha } from "@/lib/ctrl/caixinha-saldo";

// Saldo da caixinha da Puxada para a nova requisição (informativo — ver
// caixinha.ts). Mesmos papéis que verificam orçamento. Tipo que não é caixinha
// devolve `saldo: null`, e a tela não mostra nada.
export async function getSaldoCaixinha(
  expenseTypeId: string,
): Promise<{ saldo: SaldoCaixinha | null } | { error: string }> {
  const caixinha = caixinhaDoTipo(expenseTypeId);
  if (!caixinha) return { saldo: null };

  let userId: string;
  try {
    const ctx = await requireCtrlRole("solicitante", "gerente", "diretor", "csc", "contas_a_pagar", "admin");
    userId = ctx.id;
  } catch {
    return { error: "Sem acesso ao saldo da caixinha." };
  }

  try {
    return { saldo: await lerSaldoCaixinha(caixinha, userId) };
  } catch (err) {
    console.error("[caixinha] falha ao calcular o saldo:", err instanceof Error ? err.message : err);
    return { error: "Não foi possível calcular o saldo da caixinha agora." };
  }
}
