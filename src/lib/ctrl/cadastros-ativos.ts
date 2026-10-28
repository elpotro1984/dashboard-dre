// Módulo interno de servidor — NÃO é "use server": exportado como action, viraria
// uma leitura pública de cadastros sem guarda. Quem chama já passou pelo gate da
// própria tela.
import "server-only";

import { createAdminClientIfAvailable } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export interface CadastroAtivo {
  id: string;
  name: string;
}

// Setores e tipos de despesa ATIVOS da empresa, para os modais de correção de
// setor/tipo (Contas a Pagar e Aprovações). Lê com o admin client: o perfil
// contas_a_pagar não é coberto pelo gate de getSectors/getExpenseTypes, e
// getSectors ainda filtraria pelos setores vinculados ao usuário.
export async function listCadastrosAtivos(
  orgId: string | null,
): Promise<{ sectors: CadastroAtivo[]; expenseTypes: CadastroAtivo[] }> {
  if (!orgId) return { sectors: [], expenseTypes: [] };
  const supabase = createAdminClientIfAvailable() ?? (await createClient());
  const [sec, exp] = await Promise.all([
    supabase.from("ctrl_sectors").select("id, name").eq("active", true).eq("org_id", orgId).order("name"),
    supabase.from("ctrl_expense_types").select("id, name").eq("active", true).eq("org_id", orgId).order("name"),
  ]);
  return {
    sectors: (sec.data ?? []) as CadastroAtivo[],
    expenseTypes: (exp.data ?? []) as CadastroAtivo[],
  };
}
