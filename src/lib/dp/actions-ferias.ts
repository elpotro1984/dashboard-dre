"use server";

import { revalidatePath } from "next/cache";

import { DP_PATH } from "@/lib/auth/dp";
import { requireDpEmpresa } from "@/lib/dp/auth";
import { erroDasFerias, mesesDoPeriodo } from "@/lib/dp/ferias";
import { rotuloCompetencia } from "@/lib/dp/folha/parametros";
import { empresaDoSolidesId } from "@/lib/dp/folha/queries";
import { createAdminClient } from "@/lib/supabase/admin";

// Pagamento de férias — o controle de férias (`dp_ferias`), a fonte das férias
// da folha. Trabalho do dia a dia, como a Folha do mês: qualquer pessoa do DP na
// empresa dela (requireDpEmpresa), conferindo que o colaborador é da empresa.
// Férias que tocam um mês com a folha FECHADA não mudam — o retrato daquele mês
// foi fechado com elas.

type Admin = ReturnType<typeof createAdminClient>;
export type DpFeriasResult<T = object> = ({ ok: true } & T) | { ok: false; error: string };

function falha(error: unknown): { ok: false; error: string } {
  const e = error as { code?: string; message?: string } | null;
  if (e?.code === "PGRST205" || e?.code === "42P01") {
    return { ok: false, error: "Controle de férias não instalado no banco (migration 20261027180000_dp_ferias.sql)." };
  }
  return { ok: false, error: e?.message || "Erro inesperado." };
}

async function pessoaDaEmpresa(admin: Admin, solidesId: number, companyId: string): Promise<void> {
  if (!Number.isInteger(solidesId) || solidesId === 0) throw new Error("Colaborador inválido.");
  if ((await empresaDoSolidesId(admin, solidesId)) !== companyId) throw new Error("Este colaborador não é desta empresa.");
}

async function exigirMesesAbertos(admin: Admin, companyId: string, meses: string[]): Promise<void> {
  if (meses.length === 0) return;
  const { data, error } = await admin.from("dp_folha_fechamentos").select("competencia").eq("company_id", companyId).in("competencia", meses);
  if (error) throw error;
  const fechado = (data ?? []).map((r) => r.competencia as string).sort()[0];
  if (fechado) throw new Error(`A folha de ${rotuloCompetencia(fechado)} desta empresa está fechada — reabra antes de alterar estas férias.`);
}

function revalidar() {
  // A folha lê as férias daqui: a Folha do mês, o 13º e as rescisões mudam junto.
  revalidatePath(DP_PATH, "layout");
}

/** Lança (sem `id`) ou altera (com `id`) um período de férias. */
export async function salvarFerias(input: {
  companyId: string;
  id?: string | null;
  solidesId: number;
  inicio: string;
  fim: string;
  valorManual: number | null;
  observacao: string | null;
}): Promise<DpFeriasResult<{ id: string }>> {
  try {
    const user = await requireDpEmpresa(input.companyId);
    const admin = createAdminClient();
    await pessoaDaEmpresa(admin, input.solidesId, input.companyId);
    if (input.valorManual !== null && (!Number.isFinite(input.valorManual) || input.valorManual < 0 || input.valorManual > 1_000_000)) {
      throw new Error("Valor manual inválido.");
    }
    const observacao = input.observacao?.trim().slice(0, 300) || null;

    const { data: daPessoa, error: eLer } = await admin.from("dp_ferias").select("id, solides_id, inicio, fim").eq("solides_id", input.solidesId);
    if (eLer) throw eLer;
    let antiga: { inicio: string; fim: string } | null = null;
    if (input.id) {
      const { data: linha, error } = await admin.from("dp_ferias").select("solides_id, inicio, fim").eq("id", input.id).maybeSingle();
      if (error) throw error;
      if (!linha) throw new Error("Estas férias não existem mais — recarregue a página.");
      if (Number(linha.solides_id) !== input.solidesId) throw new Error("Para trocar o colaborador, exclua estas férias e lance de novo.");
      antiga = { inicio: linha.inicio as string, fim: linha.fim as string };
    }
    const outras = (daPessoa ?? []).filter((r) => r.id !== input.id).map((r) => ({ inicio: r.inicio as string, fim: r.fim as string }));
    const erro = erroDasFerias({ inicio: input.inicio, fim: input.fim }, outras);
    if (erro) throw new Error(erro);
    await exigirMesesAbertos(admin, input.companyId, Array.from(new Set([...mesesDoPeriodo(input.inicio, input.fim), ...(antiga ? mesesDoPeriodo(antiga.inicio, antiga.fim) : [])])));

    const agora = new Date().toISOString();
    const dados = { solides_id: input.solidesId, inicio: input.inicio, fim: input.fim, valor_manual: input.valorManual, observacao, updated_by: user.id, updated_at: agora };
    if (input.id) {
      const { error } = await admin.from("dp_ferias").update(dados).eq("id", input.id);
      if (error) throw error;
      revalidar();
      return { ok: true, id: input.id };
    }
    const { data: nova, error } = await admin.from("dp_ferias").insert({ ...dados, created_by: user.id }).select("id").single();
    if (error) throw error;
    revalidar();
    return { ok: true, id: nova.id as string };
  } catch (error) {
    return falha(error);
  }
}

export async function excluirFerias(input: { companyId: string; id: string }): Promise<DpFeriasResult> {
  try {
    await requireDpEmpresa(input.companyId);
    const admin = createAdminClient();
    const { data: linha, error } = await admin.from("dp_ferias").select("solides_id, inicio, fim").eq("id", input.id).maybeSingle();
    if (error) throw error;
    if (!linha) throw new Error("Estas férias não existem mais — recarregue a página.");
    await pessoaDaEmpresa(admin, Number(linha.solides_id), input.companyId);
    await exigirMesesAbertos(admin, input.companyId, mesesDoPeriodo(linha.inicio as string, linha.fim as string));
    const { error: eDel } = await admin.from("dp_ferias").delete().eq("id", input.id);
    if (eDel) throw eDel;
    revalidar();
    return { ok: true };
  } catch (error) {
    return falha(error);
  }
}
