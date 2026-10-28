"use server";

import { revalidatePath } from "next/cache";

import { DP_BENEFICIOS_PATH } from "@/lib/auth/dp";
import { todayBR } from "@/lib/ctrl/datetime";
import { exigirEmpresa, requireDpEmpresa, requireDpGestor } from "@/lib/dp/auth";
import {
  BLOCOS_BENEFICIO,
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
import { podeVerEmpresa } from "@/lib/dp/escopo";
import { buscarSalarioFamiliaNaWeb, type SalarioFamiliaEncontrado } from "@/lib/dp/salario-familia-web";
import { createAdminClient } from "@/lib/supabase/admin";

// Configurações › Benefícios da EMPRESA. Só a Visão Estratégica (gestor) grava, reajusta
// e busca na web — exceto COPIAR de outra empresa, que a Visão Operacional também faz
// (27/10/2026), entre as empresas que ela vê. No resto,
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

export interface DpOrigemBeneficios {
  id: string;
  nome: string;
  /** Os blocos que a empresa tem SALVOS (o não salvo não é copiado). */
  blocos: Partial<Record<DpBlocoBeneficio, DpBeneficiosDados[DpBlocoBeneficio]>>;
}

/**
 * As empresas de onde dá para copiar: as que a pessoa VÊ no DP, com pelo menos
 * um bloco salvo, menos a própria. Vem com os blocos, para a prévia mostrar o
 * que cada uma tem antes de copiar.
 */
export async function origensDeCopiaBeneficios(input: { companyId: string }): Promise<DpBeneficioResult<{ origens: DpOrigemBeneficios[] }>> {
  try {
    // Os dois papéis copiam; a lista é recortada pelas empresas que a pessoa vê.
    const user = await requireDpEmpresa(input.companyId);
    const admin = createAdminClient();
    const { data, error } = await admin.from("dp_beneficios_config").select("company_id, bloco, dados").neq("company_id", input.companyId);
    if (error) throw error;
    const porEmpresa = new Map<string, DpOrigemBeneficios["blocos"]>();
    for (const r of data ?? []) {
      const id = r.company_id as string;
      const b = r.bloco as string;
      if (!podeVerEmpresa(user, id) || !blocoValido(b)) continue;
      porEmpresa.set(id, { ...(porEmpresa.get(id) ?? {}), [b]: lerBloco(b, r.dados) });
    }
    if (porEmpresa.size === 0) return { ok: true, origens: [] };
    const { data: comps, error: eC } = await admin.from("companies").select("id, name").in("id", Array.from(porEmpresa.keys()));
    if (eC) throw eC;
    const origens = (comps ?? [])
      .map((c) => ({ id: c.id as string, nome: c.name as string, blocos: porEmpresa.get(c.id as string) ?? {} }))
      .sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"));
    return { ok: true, origens };
  } catch (error) {
    return falha(error);
  }
}

/**
 * Copia os blocos escolhidos de outra empresa para esta. O bloco copiado
 * SUBSTITUI o desta empresa (a prévia avisa quais já existem); os não escolhidos
 * ficam como estão. O histórico de reajustes não vem — ele conta a história da
 * outra empresa. A origem é relida aqui, nunca a que a tela mandou.
 */
export async function copiarBeneficiosDeEmpresa(input: {
  companyId: string;
  origemId: string;
  blocos: DpBlocoBeneficio[];
}): Promise<DpBeneficioResult<{ copiados: number }>> {
  try {
    // Os dois papéis copiam (a Visão Operacional também, 27/10/2026) — origem e destino no escopo.
    const user = await requireDpEmpresa(input.companyId);
    exigirEmpresa(user, input.origemId);
    if (input.origemId === input.companyId) throw new Error("Escolha outra empresa para copiar.");
    const blocos = Array.from(new Set(input.blocos)).filter(blocoValido);
    if (blocos.length === 0) throw new Error("Marque pelo menos um bloco para copiar.");
    const admin = createAdminClient();
    const { data, error } = await admin
      .from("dp_beneficios_config")
      .select("bloco, dados")
      .eq("company_id", input.origemId)
      .in("bloco", blocos);
    if (error) throw error;
    const agora = new Date().toISOString();
    const linhas = (data ?? [])
      .filter((r) => blocoValido(r.bloco))
      .map((r) => {
        const b = r.bloco as DpBlocoBeneficio;
        return { company_id: input.companyId, bloco: b, dados: lerBloco(b, r.dados), updated_by: user.id, updated_at: agora };
      })
      .sort((a, b) => BLOCOS_BENEFICIO.indexOf(a.bloco) - BLOCOS_BENEFICIO.indexOf(b.bloco));
    if (linhas.length === 0) throw new Error("A outra empresa não tem esses blocos salvos.");
    const { error: eUp } = await admin.from("dp_beneficios_config").upsert(linhas, { onConflict: "company_id,bloco" });
    if (eUp) throw eUp;
    revalidatePath(DP_BENEFICIOS_PATH);
    return { ok: true, copiados: linhas.length };
  } catch (error) {
    return falha(error);
  }
}
