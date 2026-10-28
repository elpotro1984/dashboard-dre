"use server";

import { revalidatePath } from "next/cache";

import { DP_PATH } from "@/lib/auth/dp";
import { todayBR } from "@/lib/ctrl/datetime";
import { exigirEmpresa, requireDpEmpresa, requireDpUser } from "@/lib/dp/auth";
import { conferirComEmpresa, validarBeneficiosColaborador } from "@/lib/dp/beneficios-colaborador";
import { lerBeneficiosDaEmpresa } from "@/lib/dp/beneficios-queries";
import { chaveNome } from "@/lib/dp/cargos";
import { indexarRegras, resolverEmpresa } from "@/lib/dp/empresa";
import { DpNaoInstaladoError, listDpRegras } from "@/lib/dp/queries";
import { createAdminClient } from "@/lib/supabase/admin";

// Base cadastral do DP: exceções manuais por pessoa (linha da tabela salarial e
// centro de custo) e o cadastro de centros de custo. Toda action confere a
// concessão E a empresa no escopo de quem clica (requireDpEmpresa, ou
// exigirEmpresa sobre a empresa resolvida da pessoa) e grava com o admin client.

export type DpCadastroResult<T = undefined> = { ok: true; data: T } | { ok: false; error: string };

type Admin = ReturnType<typeof createAdminClient>;

function falha(error: unknown): { ok: false; error: string } {
  const e = error as { code?: string; message?: string } | null;
  if (e?.code === "23505") return { ok: false, error: "Já existe um centro de custo com esse nome nesta empresa." };
  if (e?.code === "PGRST205" || e?.code === "42P01" || e?.code === "42703") {
    return { ok: false, error: "Base cadastral ainda não instalada no banco (migration 20261002150000)." };
  }
  return { ok: false, error: e?.message || "Erro inesperado." };
}

function texto(v: string | null | undefined, max = 200): string {
  const t = (v ?? "").replace(/\s+/g, " ").trim();
  if (t.length > max) throw new Error(`Texto passa de ${max} caracteres.`);
  return t;
}

/** Empresa do colaborador pela MESMA regra das telas (unidade, senão departamento). */
async function empresaDoColaborador(admin: Admin, colaboradorId: string): Promise<{ solidesId: number; companyId: string | null }> {
  const { data, error } = await admin
    .from("dp_colaboradores")
    .select("solides_id, unidade_id, departamento_id")
    .eq("id", colaboradorId)
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new Error("Colaborador não encontrado.");
  const idx = indexarRegras(await listDpRegras(admin));
  const e = resolverEmpresa(
    {
      unidadeId: data.unidade_id === null ? null : Number(data.unidade_id),
      departamentoId: data.departamento_id === null ? null : Number(data.departamento_id),
    },
    idx,
  );
  return { solidesId: Number(data.solides_id), companyId: e.companyId };
}

function revalidar() {
  revalidatePath(DP_PATH, "layout");
}

/**
 * Exceções manuais de uma pessoa. `linhaId`/`centroId` null = volta ao
 * automático naquele item. Exceção EXIGE motivo: é a resposta para "por que
 * esta pessoa foge do padrão do cargo?", que ninguém saberia dar depois.
 * Linha e centro são conferidos contra a empresa da pessoa — exceção para a
 * tabela de outra empresa enquadraria no salário errado.
 */
export async function salvarAjusteColaborador(input: {
  colaboradorId: string;
  linhaId: string | null;
  linhaMotivo: string;
  centroId: string | null;
  centroMotivo: string;
}): Promise<DpCadastroResult> {
  try {
    const user = await requireDpUser();
    const admin = createAdminClient();
    const { solidesId, companyId } = await empresaDoColaborador(admin, input.colaboradorId);
    // Analista só mexe em quem é das empresas dela (e nunca em quem está sem empresa).
    exigirEmpresa(user, companyId);
    if ((input.linhaId || input.centroId) && !companyId) {
      throw new Error("Defina a empresa desta pessoa (de-para de empresas) antes de criar exceções.");
    }
    const linhaMotivo = texto(input.linhaMotivo);
    const centroMotivo = texto(input.centroMotivo);
    if (input.linhaId) {
      if (!linhaMotivo) throw new Error("Informe o motivo da exceção na linha da tabela.");
      const { data } = await admin.from("dp_tabela_salarial").select("id").eq("id", input.linhaId).eq("company_id", companyId!).maybeSingle();
      if (!data) throw new Error("A linha escolhida não é da tabela salarial da empresa desta pessoa.");
    }
    if (input.centroId) {
      if (!centroMotivo) throw new Error("Informe o motivo da exceção no centro de custo.");
      const { data } = await admin.from("dp_centros_custo").select("id").eq("id", input.centroId).eq("company_id", companyId!).maybeSingle();
      if (!data) throw new Error("O centro de custo escolhido não é da empresa desta pessoa.");
    }

    if (!input.linhaId && !input.centroId) {
      const { error } = await admin.from("dp_colaborador_ajustes").delete().eq("solides_id", solidesId);
      if (error) throw error;
    } else {
      const { error } = await admin.from("dp_colaborador_ajustes").upsert(
        {
          solides_id: solidesId,
          linha_id: input.linhaId,
          linha_motivo: input.linhaId ? linhaMotivo : null,
          centro_custo_id: input.centroId,
          centro_motivo: input.centroId ? centroMotivo : null,
          updated_by: user.id,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "solides_id" },
      );
      if (error) throw error;
    }
    revalidar();
    return { ok: true, data: undefined };
  } catch (error) {
    return falha(error);
  }
}

/**
 * Card "Benefícios" da ficha: grava as ESCOLHAS da pessoa (o valor vem do
 * cadastro da empresa na leitura). Quem tem a empresa da pessoa no escopo grava
 * — como as exceções acima. Cada escolha é conferida contra o cadastro ATUAL da
 * empresa: uma aba aberta antes de alguém remover a faixa ainda posta.
 */
export async function salvarBeneficiosColaborador(input: {
  colaboradorId: string;
  dados: unknown;
}): Promise<DpCadastroResult<{ atualizadoEm: string }>> {
  try {
    const user = await requireDpUser();
    const admin = createAdminClient();
    const { solidesId, companyId } = await empresaDoColaborador(admin, input.colaboradorId);
    exigirEmpresa(user, companyId);
    if (!companyId) throw new Error("Defina a empresa desta pessoa (de-para de empresas) antes de cadastrar benefícios.");
    const v = validarBeneficiosColaborador(input.dados, todayBR());
    if ("erro" in v) throw new Error(v.erro);
    const erroEmpresa = conferirComEmpresa(v.ok, (await lerBeneficiosDaEmpresa(admin, companyId)).dados);
    if (erroEmpresa) throw new Error(erroEmpresa);
    const atualizadoEm = new Date().toISOString();
    const { error } = await admin
      .from("dp_colaborador_beneficios")
      .upsert(
        { solides_id: solidesId, company_id: companyId, dados: v.ok, updated_by: user.id, updated_at: atualizadoEm },
        { onConflict: "solides_id" },
      );
    if (error) throw error;
    revalidar();
    return { ok: true, data: { atualizadoEm } };
  } catch (error) {
    const e = error as { code?: string } | null;
    if (error instanceof DpNaoInstaladoError || e?.code === "PGRST205" || e?.code === "42P01") {
      return {
        ok: false,
        error: "Benefícios por colaborador ainda não instalados no banco (migrations 20261027170000 e 20261028130000).",
      };
    }
    return falha(error);
  }
}

export async function salvarCentroCusto(input: {
  companyId: string;
  id?: string;
  codigo: string;
  nome: string;
}): Promise<DpCadastroResult<{ id: string }>> {
  try {
    const user = await requireDpEmpresa(input.companyId);
    const admin = createAdminClient();
    const nome = texto(input.nome, 120);
    if (!nome) throw new Error("Informe o nome do centro de custo.");
    const row = {
      codigo: texto(input.codigo, 40),
      nome,
      nome_chave: chaveNome(nome),
      updated_by: user.id,
      updated_at: new Date().toISOString(),
    };
    if (input.id) {
      const { error } = await admin.from("dp_centros_custo").update(row).eq("id", input.id).eq("company_id", input.companyId);
      if (error) throw error;
      revalidar();
      return { ok: true, data: { id: input.id } };
    }
    const { data: company } = await admin.from("companies").select("id").eq("id", input.companyId).maybeSingle();
    if (!company) throw new Error("Empresa não encontrada.");
    const { data, error } = await admin
      .from("dp_centros_custo")
      .insert({ ...row, company_id: input.companyId })
      .select("id")
      .single();
    if (error) throw error;
    revalidar();
    return { ok: true, data: { id: data.id as string } };
  } catch (error) {
    return falha(error);
  }
}

/**
 * Exclui o centro de custo. Linhas da tabela e exceções que apontavam para ele
 * ficam SEM centro (SET NULL) — a tela avisa quantas antes de confirmar.
 */
export async function excluirCentroCusto(input: { companyId: string; id: string }): Promise<DpCadastroResult> {
  try {
    await requireDpEmpresa(input.companyId);
    const { error } = await createAdminClient().from("dp_centros_custo").delete().eq("id", input.id).eq("company_id", input.companyId);
    if (error) throw error;
    revalidar();
    return { ok: true, data: undefined };
  } catch (error) {
    return falha(error);
  }
}

/** Centro de custo PADRÃO de uma linha da tabela salarial (null = sem padrão). */
export async function definirCentroDaLinha(input: { companyId: string; linhaId: string; centroId: string | null }): Promise<DpCadastroResult> {
  try {
    const user = await requireDpEmpresa(input.companyId);
    const admin = createAdminClient();
    if (input.centroId) {
      const { data } = await admin.from("dp_centros_custo").select("id").eq("id", input.centroId).eq("company_id", input.companyId).maybeSingle();
      if (!data) throw new Error("Centro de custo não é desta empresa.");
    }
    const { error } = await admin
      .from("dp_tabela_salarial")
      .update({ centro_custo_id: input.centroId, updated_by: user.id, updated_at: new Date().toISOString() })
      .eq("id", input.linhaId)
      .eq("company_id", input.companyId);
    if (error) throw error;
    revalidar();
    return { ok: true, data: undefined };
  } catch (error) {
    return falha(error);
  }
}
