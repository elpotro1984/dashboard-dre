"use server";

import { revalidatePath } from "next/cache";

import { DP_PATH } from "@/lib/auth/dp";
import { exigirEmpresa, requireDpGestor } from "@/lib/dp/auth";
import { linhaEncargosDp, regimeValido, type DpEncargoPatronal } from "@/lib/dp/encargos-config";
import { createAdminClient } from "@/lib/supabase/admin";

// Configurações DA EMPRESA no DP que moram em cadastros compartilhados: os
// encargos (`orcamento_encargos`, o mesmo do Orçamento) e o regime tributário
// (`companies`). Só o GESTOR grava — são premissas que mudam o custo da empresa
// inteira, no DP e no Orçamento; a analista lê. A regra da linha é de
// @/lib/dp/encargos-config (pura e testada).

export type DpConfigResult = { ok: true } | { ok: false; error: string };

function falha(error: unknown): { ok: false; error: string } {
  const e = error as { code?: string; message?: string } | null;
  if (e?.code === "PGRST205" || e?.code === "42P01") return { ok: false, error: "Cadastro de encargos não instalado no banco." };
  return { ok: false, error: e?.message || "Erro inesperado." };
}

function anoValido(ano: number): void {
  if (!Number.isInteger(ano) || ano < 2000 || ano > 2100) throw new Error("Ano inválido.");
}

function revalidar() {
  revalidatePath(DP_PATH, "layout");
  revalidatePath("/orcamento", "layout");
}

/** Regime tributário + alíquotas patronais da empresa no ano. O FGTS da linha (do Orçamento) é preservado. */
export async function salvarEncargosEmpresa(input: {
  companyId: string;
  ano: number;
  regime: string | null;
  aliquotas: Record<DpEncargoPatronal, number>;
}): Promise<DpConfigResult> {
  try {
    const user = await requireDpGestor();
    exigirEmpresa(user, input.companyId);
    anoValido(input.ano);
    if (!regimeValido(input.regime)) throw new Error("Regime tributário inválido.");
    const admin = createAdminClient();
    const { data: atual, error: eAtual } = await admin
      .from("orcamento_encargos")
      .select("fgts")
      .eq("company_id", input.companyId)
      .eq("year", input.ano)
      .maybeSingle();
    if (eAtual) throw eAtual;
    const linha = linhaEncargosDp(input.aliquotas, atual?.fgts === null || atual?.fgts === undefined ? null : Number(atual.fgts), input.regime);

    const { error: eReg } = await admin.from("companies").update({ regime_tributario: input.regime }).eq("id", input.companyId);
    if (eReg) throw eReg;
    const { error } = await admin
      .from("orcamento_encargos")
      .upsert({ company_id: input.companyId, year: input.ano, ...linha, updated_by: user.id }, { onConflict: "company_id,year" });
    if (error) throw error;
    revalidar();
    return { ok: true };
  } catch (error) {
    return falha(error);
  }
}

/** Apaga as alíquotas do ano: a empresa volta ao padrão do regime (o mesmo "restaurar" do Orçamento). */
export async function voltarEncargosAoPadrao(input: { companyId: string; ano: number }): Promise<DpConfigResult> {
  try {
    const user = await requireDpGestor();
    exigirEmpresa(user, input.companyId);
    anoValido(input.ano);
    const { error } = await createAdminClient().from("orcamento_encargos").delete().eq("company_id", input.companyId).eq("year", input.ano);
    if (error) throw error;
    revalidar();
    return { ok: true };
  } catch (error) {
    return falha(error);
  }
}
