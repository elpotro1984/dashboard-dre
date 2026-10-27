"use server";

import { revalidatePath } from "next/cache";

import { DP_BENEFICIOS_PATH } from "@/lib/auth/dp";
import { todayBR } from "@/lib/ctrl/datetime";
import { exigirEmpresa, requireDpGestor } from "@/lib/dp/auth";
import {
  blocoValido,
  erroDoPercentual,
  lerBloco,
  mesmoBloco,
  reajustarBloco,
  validarBloco,
  valoresDoBloco,
  type DpBeneficiosDados,
  type DpBlocoBeneficio,
} from "@/lib/dp/beneficios-config";
import { buscarSalarioFamiliaNaWeb, type SalarioFamiliaEncontrado } from "@/lib/dp/salario-familia-web";
import { createAdminClient } from "@/lib/supabase/admin";

// Configurações › Benefícios da EMPRESA. Só a Visão Estratégica (gestor) grava —
// como os Encargos da empresa: são premissas que mudam o custo dela; a Visão
// Operacional lê. A regra de cada bloco é @/lib/dp/beneficios-config (pura e testada).

export type DpBeneficioResult<T> = ({ ok: true } & T) | { ok: false; error: string };

const MUDOU = "O bloco mudou desde a prévia (outra pessoa salvou?). Nada foi aplicado — recarregue e confira o reajuste de novo.";

function falha(error: unknown): { ok: false; error: string } {
  const e = error as { code?: string; message?: string } | null;
  if (e?.code === "PGRST205" || e?.code === "42P01" || e?.code === "PGRST202") {
    return { ok: false, error: "Cadastro de benefícios não instalado no banco (migration 20261027170000_dp_beneficios_config.sql)." };
  }
  if (e?.message?.includes("dp_beneficio_mudou")) return { ok: false, error: MUDOU };
  return { ok: false, error: e?.message || "Erro inesperado." };
}

function exigirBloco(bloco: unknown): DpBlocoBeneficio {
  if (!blocoValido(bloco)) throw new Error("Bloco de benefício inválido.");
  return bloco;
}

/** Grava um bloco da empresa (os outros não são tocados). */
export async function salvarBlocoBeneficio(input: {
  companyId: string;
  bloco: DpBlocoBeneficio;
  dados: unknown;
}): Promise<DpBeneficioResult<{ dados: DpBeneficiosDados[DpBlocoBeneficio]; atualizadoEm: string }>> {
  try {
    const user = await requireDpGestor();
    exigirEmpresa(user, input.companyId);
    const bloco = exigirBloco(input.bloco);
    const v = validarBloco(bloco, input.dados);
    if ("erro" in v) return { ok: false, error: v.erro };
    const atualizadoEm = new Date().toISOString();
    const { error } = await createAdminClient()
      .from("dp_beneficios_config")
      .upsert(
        { company_id: input.companyId, bloco, dados: v.ok, updated_by: user.id, updated_at: atualizadoEm },
        { onConflict: "company_id,bloco" },
      );
    if (error) throw error;
    revalidatePath(DP_BENEFICIOS_PATH);
    return { ok: true, dados: v.ok, atualizadoEm };
  } catch (error) {
    return falha(error);
  }
}

/**
 * Reajuste % de UM bloco, depois da confirmação. `base` é o bloco que a prévia
 * mostrou: se o gravado não for mais ele, recusa — o número aplicado tem de ser o
 * confirmado. O cálculo é o mesmo da prévia (reajustarBloco), e a gravação +
 * histórico vão numa transação (dp_beneficio_reajustar), que confere de novo.
 */
export async function aplicarReajusteBeneficio(input: {
  companyId: string;
  bloco: DpBlocoBeneficio;
  percentual: number;
  base: unknown;
}): Promise<DpBeneficioResult<{ dados: DpBeneficiosDados[DpBlocoBeneficio] }>> {
  try {
    const user = await requireDpGestor();
    exigirEmpresa(user, input.companyId);
    const bloco = exigirBloco(input.bloco);
    const erroPct = erroDoPercentual(input.percentual);
    if (erroPct) return { ok: false, error: erroPct };
    const admin = createAdminClient();
    const { data: linha, error: eLer } = await admin
      .from("dp_beneficios_config")
      .select("dados")
      .eq("company_id", input.companyId)
      .eq("bloco", bloco)
      .maybeSingle();
    if (eLer) throw eLer;
    if (!linha) return { ok: false, error: "Salve o bloco antes de aplicar um reajuste." };
    if (!mesmoBloco(bloco, linha.dados, input.base)) return { ok: false, error: MUDOU };
    const antes = lerBloco(bloco, linha.dados);
    if (valoresDoBloco(bloco, antes).length === 0) return { ok: false, error: "Este bloco não tem valor para reajustar." };
    const depois = reajustarBloco(bloco, antes, input.percentual);
    const { error } = await admin.rpc("dp_beneficio_reajustar", {
      p_company_id: input.companyId,
      p_bloco: bloco,
      p_percentual: input.percentual,
      p_antes: linha.dados,
      p_depois: depois,
      p_user_id: user.id,
    });
    if (error) throw error;
    revalidatePath(DP_BENEFICIOS_PATH);
    return { ok: true, dados: depois };
  } catch (error) {
    return falha(error);
  }
}

/**
 * Tabela ATUAL do salário-família, pesquisada na web. Não grava: a tela preenche
 * o formulário com a proposta, e quem conferiu salva. Gasta busca na OpenAI, por
 * isso o mesmo gate de quem grava.
 */
export async function buscarSalarioFamiliaAtualizado(input: {
  companyId: string;
}): Promise<DpBeneficioResult<{ encontrado: SalarioFamiliaEncontrado }>> {
  try {
    const user = await requireDpGestor();
    exigirEmpresa(user, input.companyId);
    const r = await buscarSalarioFamiliaNaWeb(Number(todayBR().slice(0, 4)));
    if (!r.ok) return { ok: false, error: `A busca não encontrou os valores agora (${r.error.slice(0, 160)}). Preencha à mão.` };
    return { ok: true, encontrado: r.dados };
  } catch (error) {
    return falha(error);
  }
}
