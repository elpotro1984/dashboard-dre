"use server";

import { revalidatePath } from "next/cache";

import { DP_PATH } from "@/lib/auth/dp";
import { requireDpEmpresa, requireDpGestor } from "@/lib/dp/auth";
import { validarAjustes13, type Dp13Ajustes } from "@/lib/dp/folha/decimo-terceiro";
import { getDecimoTerceiro } from "@/lib/dp/folha/decimo-terceiro-queries";
import { empresaDoSolidesId } from "@/lib/dp/folha/queries";
import { createAdminClient } from "@/lib/supabase/admin";

// Escrita do 13º SALÁRIO. Mesmo desenho da folha do mês: requireDpEmpresa em
// toda action de uma empresa, a PESSOA conferida contra a empresa, e parcela
// FECHADA não aceita escrita (reabrir é só do gestor). Fechar grava o RETRATO
// calculado no servidor — a tela nunca manda número.

export type Dp13Result<T = undefined> = { ok: true; data: T } | { ok: false; error: string };

type Admin = ReturnType<typeof createAdminClient>;

function falha(error: unknown): { ok: false; error: string } {
  const e = error as { code?: string; message?: string } | null;
  if (e?.code === "PGRST205" || e?.code === "42P01") {
    return { ok: false, error: "13º ainda não instalado no banco (migration 20261021140000)." };
  }
  if (e?.code === "23505") return { ok: false, error: "Esta parcela acabou de ser fechada por outra pessoa — recarregue a tela." };
  return { ok: false, error: e?.message || "Erro inesperado." };
}

function exigirAno(ano: number): void {
  if (!Number.isInteger(ano) || ano < 2000 || ano > 2100) throw new Error("Ano inválido.");
}

function exigirParcela(p: number): asserts p is 1 | 2 {
  if (p !== 1 && p !== 2) throw new Error("Parcela inválida.");
}

async function parcelaFechada(admin: Admin, companyId: string, ano: number, parcela: 1 | 2): Promise<boolean> {
  const { data, error } = await admin
    .from("dp_folha_13_fechamentos")
    .select("parcela")
    .eq("company_id", companyId)
    .eq("ano", ano)
    .eq("parcela", parcela)
    .maybeSingle();
  if (error) throw error;
  return Boolean(data);
}

/** Ajustes, 1ª parcela paga nas férias e observação do 13º de uma pessoa. Tudo vazio = apaga a linha. */
export async function salvar13Pessoa(input: {
  companyId: string;
  ano: number;
  solidesId: number;
  ajustes: Dp13Ajustes;
  primeiraFerias: number | null;
  observacao: string | null;
}): Promise<Dp13Result> {
  try {
    const user = await requireDpEmpresa(input.companyId);
    exigirAno(input.ano);
    const admin = createAdminClient();
    if (!Number.isInteger(input.solidesId) || (await empresaDoSolidesId(admin, input.solidesId)) !== input.companyId) {
      throw new Error("Este colaborador não é desta empresa.");
    }
    if (await parcelaFechada(admin, input.companyId, input.ano, 2)) {
      throw new Error(`O 13º de ${input.ano} desta empresa está fechado — reabra a 2ª parcela antes de alterar.`);
    }
    const ajustes = validarAjustes13(input.ajustes);
    const pf = input.primeiraFerias;
    if (pf !== null && (typeof pf !== "number" || !Number.isFinite(pf) || pf < 0 || pf > 1_000_000)) throw new Error("1ª parcela paga nas férias: valor inválido.");
    const observacao = (input.observacao ?? "").trim().slice(0, 500) || null;
    const vazio = Object.keys(ajustes).length === 0 && (pf === null || pf === 0) && !observacao;
    const { error } = vazio
      ? await admin.from("dp_folha_13").delete().eq("ano", input.ano).eq("solides_id", input.solidesId)
      : await admin.from("dp_folha_13").upsert(
          {
            ano: input.ano,
            solides_id: input.solidesId,
            ajustes,
            primeira_ferias: pf === null || pf === 0 ? null : Math.round(pf * 100) / 100,
            observacao,
            updated_by: user.id,
            updated_at: new Date().toISOString(),
          },
          { onConflict: "ano,solides_id" },
        );
    if (error) throw error;
    revalidatePath(DP_PATH, "layout");
    return { ok: true, data: undefined };
  } catch (error) {
    return falha(error);
  }
}

/**
 * Fecha uma parcela: grava o retrato calculado AGORA no servidor. A 2ª exige a
 * 1ª fechada — é dela que vem o valor que a 2ª desconta.
 */
export async function fechar13(input: { companyId: string; ano: number; parcela: number }): Promise<Dp13Result> {
  try {
    const user = await requireDpEmpresa(input.companyId);
    exigirAno(input.ano);
    exigirParcela(input.parcela);
    const admin = createAdminClient();
    if (await parcelaFechada(admin, input.companyId, input.ano, input.parcela)) throw new Error("Esta parcela já está fechada.");
    if (input.parcela === 2 && !(await parcelaFechada(admin, input.companyId, input.ano, 1))) {
      throw new Error("Feche a 1ª parcela antes: a 2ª desconta o valor dela.");
    }
    const r = await getDecimoTerceiro(admin, input.companyId, input.ano);
    if (r.linhas.every((l) => l.fora)) throw new Error("Ninguém com 13º nesta empresa no ano — nada a fechar.");
    const { error } = await admin.from("dp_folha_13_fechamentos").insert({
      company_id: input.companyId,
      ano: input.ano,
      parcela: input.parcela,
      resultado: { vigencia: r.vigencia, parametros: r.parametros, linhas: r.linhas },
      fechado_por: user.id,
    });
    if (error) throw error;
    revalidatePath(DP_PATH, "layout");
    return { ok: true, data: undefined };
  } catch (error) {
    return falha(error);
  }
}

/** Reabre uma parcela (apaga o retrato). Só o gestor; a 1ª não reabre com a 2ª fechada. */
export async function reabrir13(input: { companyId: string; ano: number; parcela: number }): Promise<Dp13Result> {
  try {
    await requireDpGestor();
    exigirAno(input.ano);
    exigirParcela(input.parcela);
    const admin = createAdminClient();
    if (input.parcela === 1 && (await parcelaFechada(admin, input.companyId, input.ano, 2))) {
      throw new Error("Reabra a 2ª parcela antes: ela foi calculada sobre o retrato da 1ª.");
    }
    const { error } = await admin
      .from("dp_folha_13_fechamentos")
      .delete()
      .eq("company_id", input.companyId)
      .eq("ano", input.ano)
      .eq("parcela", input.parcela);
    if (error) throw error;
    revalidatePath(DP_PATH, "layout");
    return { ok: true, data: undefined };
  } catch (error) {
    return falha(error);
  }
}
