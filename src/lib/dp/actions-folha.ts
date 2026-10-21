"use server";

import { revalidatePath } from "next/cache";
import * as XLSX from "xlsx";

import { DP_PATH } from "@/lib/auth/dp";
import { exigirEmpresa, requireDpEmpresa, requireDpGestor } from "@/lib/dp/auth";
import { indexarRegras, resolverEmpresa } from "@/lib/dp/empresa";
import { podeVerEmpresa } from "@/lib/dp/escopo";
import { ajustesDaPlanilha, casarNome, lerControle, lerData, lerNumero, normalizarNome, type DpPessoaParaCasar } from "@/lib/dp/folha/importacao";
import { LANCAMENTO_PADRAO, type DpFolhaCadastro, type DpFolhaLancamento } from "@/lib/dp/folha/motor";
import { competenciaValida, rotuloCompetencia, somarMeses, validarParametros, type DpFolhaParametros } from "@/lib/dp/folha/parametros";
import {
  empresaDoSolidesId,
  folhaFechada,
  listAvulsos,
  getFolhaEmpresa,
  listParametrosVigencias,
  parametrosDaCompetencia,
} from "@/lib/dp/folha/queries";
import {
  herdarDoMesAnterior,
  linhaCadastro,
  linhaLancamento,
  mesclarLancamento,
  validarCadastro,
  validarLancamento,
  type DpCamposGrade,
} from "@/lib/dp/folha/validacao";
import { chaveNome } from "@/lib/dp/cargos";
import { getDpCargosPagina } from "@/lib/dp/cargos-queries";
import { listDpRegras } from "@/lib/dp/queries";
import { contratoDaPlanilha, empresasPorRotulo, validarAvulso, type DpAvulsoEntrada } from "@/lib/dp/folha/avulsos";
import { createAdminClient } from "@/lib/supabase/admin";

// Escrita da FOLHA GERENCIAL. Toda action de uma empresa passa por
// requireDpEmpresa(companyId) e confere que a PESSOA é daquela empresa (pela
// mesma regra de empresa das telas) — senão uma analista gravaria na folha de
// outra empresa passando o companyId dela e o solidesId de outra pessoa.
// Folha FECHADA não aceita escrita: reabre-se antes (só o gestor).

export type DpFolhaResult<T = undefined> = { ok: true; data: T } | { ok: false; error: string };

type Admin = ReturnType<typeof createAdminClient>;

function falha(error: unknown): { ok: false; error: string } {
  const e = error as { code?: string; message?: string } | null;
  if (e?.code === "PGRST205" || e?.code === "42P01") {
    return { ok: false, error: "Folha ainda não instalada no banco (migration 20261019130000)." };
  }
  return { ok: false, error: e?.message || "Erro inesperado." };
}

function revalidar() {
  revalidatePath(DP_PATH, "layout");
}

function exigirCompetencia(c: string): void {
  if (!competenciaValida(c)) throw new Error("Competência inválida.");
}

async function pessoaDaEmpresa(admin: Admin, solidesId: number, companyId: string): Promise<void> {
  if (!Number.isInteger(solidesId)) throw new Error("Colaborador inválido.");
  const empresa = await empresaDoSolidesId(admin, solidesId);
  if (empresa !== companyId) throw new Error("Este colaborador não é desta empresa.");
}

async function exigirAberta(admin: Admin, companyId: string, competencia: string): Promise<void> {
  if (await folhaFechada(admin, companyId, competencia)) {
    throw new Error(`A folha de ${rotuloCompetencia(competencia)} desta empresa está fechada — reabra antes de alterar.`);
  }
}

async function parametrosVigentes(admin: Admin, competencia: string): Promise<DpFolhaParametros> {
  return parametrosDaCompetencia(await listParametrosVigencias(admin), competencia).parametros;
}

/** O fixo da folha da pessoa (plano, odonto, VA, VT…). Vale para os meses ABERTOS; os fechados são retrato. */
export async function salvarCadastroFolha(input: {
  companyId: string;
  competencia: string;
  solidesId: number;
  cadastro: DpFolhaCadastro;
}): Promise<DpFolhaResult> {
  try {
    const user = await requireDpEmpresa(input.companyId);
    exigirCompetencia(input.competencia);
    const admin = createAdminClient();
    await pessoaDaEmpresa(admin, input.solidesId, input.companyId);
    const c = validarCadastro(input.cadastro, await parametrosVigentes(admin, input.competencia));
    const { error } = await admin
      .from("dp_folha_cadastro")
      .upsert({ solides_id: input.solidesId, ...linhaCadastro(c), updated_by: user.id, updated_at: new Date().toISOString() }, { onConflict: "solides_id" });
    if (error) throw error;
    revalidar();
    return { ok: true, data: undefined };
  } catch (error) {
    return falha(error);
  }
}

/** As variáveis do mês da pessoa, com os ajustes manuais. */
export async function salvarLancamentoFolha(input: {
  companyId: string;
  competencia: string;
  solidesId: number;
  lancamento: DpFolhaLancamento;
  observacao: string | null;
}): Promise<DpFolhaResult> {
  try {
    const user = await requireDpEmpresa(input.companyId);
    exigirCompetencia(input.competencia);
    const admin = createAdminClient();
    await pessoaDaEmpresa(admin, input.solidesId, input.companyId);
    await exigirAberta(admin, input.companyId, input.competencia);
    const l = validarLancamento(input.lancamento);
    const { error } = await admin.from("dp_folha_lancamentos").upsert(
      {
        competencia: input.competencia,
        solides_id: input.solidesId,
        ...linhaLancamento(l),
        observacao: (input.observacao ?? "").trim().slice(0, 500) || null,
        updated_by: user.id,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "competencia,solides_id" },
    );
    if (error) throw error;
    revalidar();
    return { ok: true, data: undefined };
  } catch (error) {
    return falha(error);
  }
}

/** Quem da lista é desta empresa — uma leitura só para o lote inteiro. */
async function solidesIdsDaEmpresa(admin: Admin, companyId: string): Promise<Set<number>> {
  const [{ data, error }, regras] = await Promise.all([
    admin.from("dp_colaboradores").select("solides_id, unidade_id, departamento_id"),
    listDpRegras(admin),
  ]);
  if (error) throw error;
  const idx = indexarRegras(regras);
  return new Set(
    (data ?? [])
      .filter(
        (r) =>
          resolverEmpresa(
            {
              unidadeId: r.unidade_id === null ? null : Number(r.unidade_id),
              departamentoId: r.departamento_id === null ? null : Number(r.departamento_id),
            },
            idx,
          ).companyId === companyId,
      )
      .map((r) => Number(r.solides_id))
      .concat((await listAvulsos(admin, companyId)).filter((a) => a.unificadoCom === null).map((a) => a.pessoaId)),
  );
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function lancamentoDoBanco(r: any): DpFolhaLancamento {
  return {
    situacao: r.situacao,
    diasTrabalhados: Number(r.dias_trabalhados),
    outrosProventos: Number(r.outros_proventos),
    diasFerias: Number(r.dias_ferias),
    inssFerias: Number(r.inss_ferias),
    coparticipacao: Number(r.coparticipacao),
    outrosDescontos: Number(r.outros_descontos),
    comissao: Number(r.comissao),
    vtDiasDesconto: Number(r.vt_dias_desconto),
    ajustes: r.ajustes && typeof r.ajustes === "object" ? r.ajustes : {},
  };
}

/**
 * A GRADE do mês: grava de uma vez as linhas que o DP editou — é o que
 * substitui digitar a coluna inteira na aba CONTROLE. Preserva os ajustes
 * manuais e a observação de cada pessoa. Falha POR LINHA (volta o nome e o
 * motivo); as linhas certas são gravadas mesmo assim.
 */
export async function salvarLancamentosEmLote(input: {
  companyId: string;
  competencia: string;
  itens: Array<{ solidesId: number; campos: DpCamposGrade }>;
}): Promise<DpFolhaResult<{ gravados: number; erros: Array<{ solidesId: number; erro: string }> }>> {
  try {
    const user = await requireDpEmpresa(input.companyId);
    exigirCompetencia(input.competencia);
    if (input.itens.length > 1000) throw new Error("Lote grande demais.");
    const admin = createAdminClient();
    await exigirAberta(admin, input.companyId, input.competencia);
    const daEmpresa = await solidesIdsDaEmpresa(admin, input.companyId);
    const ids = input.itens.map((i) => i.solidesId);
    const { data: gravados, error } = ids.length
      ? await admin.from("dp_folha_lancamentos").select("*").eq("competencia", input.competencia).in("solides_id", ids)
      : { data: [], error: null };
    if (error) throw error;
    const porId = new Map((gravados ?? []).map((r) => [Number(r.solides_id), lancamentoDoBanco(r)]));

    const erros: Array<{ solidesId: number; erro: string }> = [];
    const linhas: Array<Record<string, unknown>> = [];
    const agora = new Date().toISOString();
    for (const it of input.itens) {
      try {
        if (!daEmpresa.has(it.solidesId)) throw new Error("Este colaborador não é desta empresa.");
        const l = validarLancamento(mesclarLancamento(porId.get(it.solidesId) ?? null, it.campos));
        linhas.push({ competencia: input.competencia, solides_id: it.solidesId, ...linhaLancamento(l), updated_by: user.id, updated_at: agora });
      } catch (e) {
        erros.push({ solidesId: it.solidesId, erro: e instanceof Error ? e.message : "Erro inesperado." });
      }
    }
    if (linhas.length) {
      const { error: eUp } = await admin.from("dp_folha_lancamentos").upsert(linhas, { onConflict: "competencia,solides_id" });
      if (eUp) throw eUp;
    }
    revalidar();
    return { ok: true, data: { gravados: linhas.length, erros } };
  } catch (error) {
    return falha(error);
  }
}

/**
 * Começa o mês a partir do anterior: traz a SITUAÇÃO (afastado/licença) de quem
 * tinha lançamento no mês anterior e ainda não tem neste. Valores que se
 * repetem são fixos no cadastro (`recorrentes`). Nunca sobrescreve o que já foi
 * lançado no mês.
 */
export async function herdarMesAnterior(input: { companyId: string; competencia: string }): Promise<DpFolhaResult<{ trazidos: number }>> {
  try {
    const user = await requireDpEmpresa(input.companyId);
    exigirCompetencia(input.competencia);
    const admin = createAdminClient();
    await exigirAberta(admin, input.companyId, input.competencia);
    const daEmpresa = await solidesIdsDaEmpresa(admin, input.companyId);
    const anterior = somarMeses(input.competencia, -1);
    const [{ data: ant, error: e1 }, { data: atual, error: e2 }] = await Promise.all([
      admin.from("dp_folha_lancamentos").select("*").eq("competencia", anterior),
      admin.from("dp_folha_lancamentos").select("solides_id").eq("competencia", input.competencia),
    ]);
    if (e1) throw e1;
    if (e2) throw e2;
    const jaTem = new Set((atual ?? []).map((r) => Number(r.solides_id)));
    const agora = new Date().toISOString();
    const linhas = (ant ?? [])
      .filter((r) => daEmpresa.has(Number(r.solides_id)) && !jaTem.has(Number(r.solides_id)))
      .map((r) => {
        const l = herdarDoMesAnterior(lancamentoDoBanco(r), { ...LANCAMENTO_PADRAO, ajustes: {} });
        return { competencia: input.competencia, solides_id: Number(r.solides_id), ...linhaLancamento(l), updated_by: user.id, updated_at: agora };
      })
      // Só vale a pena gravar quem tinha algo a herdar (afastado / licença).
      .filter((r) => r.situacao !== "normal");
    if (linhas.length) {
      const { error } = await admin.from("dp_folha_lancamentos").insert(linhas);
      if (error) throw error;
    }
    revalidar();
    return { ok: true, data: { trazidos: linhas.length } };
  } catch (error) {
    return falha(error);
  }
}

/**
 * Centro de custo da pessoa, escolhido na folha. Grava a EXCEÇÃO do cadastro do
 * DP (dp_colaborador_ajustes) — o mesmo lugar da ficha —, preservando a
 * exceção de linha da tabela salarial. `centroId` null volta ao automático
 * (padrão da linha).
 */
export async function definirCentroCustoFolha(input: { companyId: string; solidesId: number; centroId: string | null }): Promise<DpFolhaResult> {
  try {
    const user = await requireDpEmpresa(input.companyId);
    const admin = createAdminClient();
    await pessoaDaEmpresa(admin, input.solidesId, input.companyId);
    if (input.centroId) {
      const { data } = await admin.from("dp_centros_custo").select("id").eq("id", input.centroId).eq("company_id", input.companyId).maybeSingle();
      if (!data) throw new Error("O centro de custo escolhido não é desta empresa.");
    }
    if (input.solidesId < 0) {
      // Avulso não está no espelho: o centro de custo fica no próprio cadastro dele.
      const { error } = await admin
        .from("dp_folha_avulsos")
        .update({ centro_custo_id: input.centroId, updated_by: user.id, updated_at: new Date().toISOString() })
        .eq("pessoa_id", input.solidesId)
        .eq("company_id", input.companyId);
      if (error) throw error;
      revalidar();
      return { ok: true, data: undefined };
    }
    const { error } = await admin.from("dp_colaborador_ajustes").upsert(
      {
        solides_id: input.solidesId,
        centro_custo_id: input.centroId,
        centro_motivo: input.centroId ? "definido no cadastro da folha" : null,
        updated_by: user.id,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "solides_id" },
    );
    if (error) throw error;
    revalidar();
    return { ok: true, data: undefined };
  } catch (error) {
    return falha(error);
  }
}

// ── pessoas FORA da Sólides ────────────────────────────────────────────────

function linhaAvulso(a: DpAvulsoEntrada) {
  return {
    nome: a.nome,
    cpf: a.cpf,
    setor: a.setor,
    tipo_contrato: a.tipoContrato,
    salario: a.salario,
    data_nascimento: a.nascimento,
    data_admissao: a.admissao,
    data_desligamento: a.desligamento,
    observacao: a.observacao,
  };
}

/** Inclui (sem `pessoaId`) ou altera uma pessoa da folha que não existe na Sólides. */
export async function salvarAvulso(input: { companyId: string; pessoaId?: number; dados: DpAvulsoEntrada }): Promise<DpFolhaResult<{ pessoaId: number }>> {
  try {
    const user = await requireDpEmpresa(input.companyId);
    const dados = validarAvulso(input.dados);
    const admin = createAdminClient();
    const agora = new Date().toISOString();
    if (input.pessoaId !== undefined) {
      if (!(input.pessoaId < 0)) throw new Error("Pessoa inválida.");
      const { data, error } = await admin
        .from("dp_folha_avulsos")
        .update({ ...linhaAvulso(dados), updated_by: user.id, updated_at: agora })
        .eq("pessoa_id", input.pessoaId)
        .eq("company_id", input.companyId)
        .is("unificado_com", null)
        .select("pessoa_id");
      if (error) throw error;
      if (!data?.length) throw new Error("Pessoa não encontrada nesta empresa.");
      revalidar();
      return { ok: true, data: { pessoaId: input.pessoaId } };
    }
    const { data, error } = await admin
      .from("dp_folha_avulsos")
      .insert({ ...linhaAvulso(dados), company_id: input.companyId, created_by: user.id, updated_by: user.id })
      .select("pessoa_id")
      .single();
    if (error) throw error;
    revalidar();
    return { ok: true, data: { pessoaId: Number(data.pessoa_id) } };
  } catch (error) {
    return falha(error);
  }
}

/**
 * Exclui o avulso — só quando ele nunca teve mês lançado. Com histórico, a
 * saída é DESLIGAR (data de desligamento): apagar levaria junto a memória de
 * meses que a contabilidade já recebeu.
 */
export async function excluirAvulso(input: { companyId: string; pessoaId: number }): Promise<DpFolhaResult> {
  try {
    await requireDpEmpresa(input.companyId);
    if (!(input.pessoaId < 0)) throw new Error("Pessoa inválida.");
    const admin = createAdminClient();
    const { count, error: eC } = await admin
      .from("dp_folha_lancamentos")
      .select("solides_id", { count: "exact", head: true })
      .eq("solides_id", input.pessoaId);
    if (eC) throw eC;
    if ((count ?? 0) > 0) throw new Error("Esta pessoa já tem mês lançado — informe a data de desligamento em vez de excluir.");
    const { error } = await admin.from("dp_folha_avulsos").delete().eq("pessoa_id", input.pessoaId).eq("company_id", input.companyId);
    if (error) throw error;
    await admin.from("dp_folha_cadastro").delete().eq("solides_id", input.pessoaId);
    revalidar();
    return { ok: true, data: undefined };
  } catch (error) {
    return falha(error);
  }
}

/**
 * A pessoa apareceu na Sólides: UNIFICA. O cadastro da folha e os meses ABERTOS
 * passam para o id da Sólides (sem sobrescrever o que já houver lá), as
 * rescisões também, e o avulso sai da folha (fica marcado com quem herdou).
 * Meses FECHADOS não mudam: o retrato é do jeito que foi fechado.
 */
export async function unificarAvulso(input: { companyId: string; pessoaId: number; solidesId: number }): Promise<DpFolhaResult<{ meses: number }>> {
  try {
    const user = await requireDpEmpresa(input.companyId);
    if (!(input.pessoaId < 0) || !(input.solidesId > 0)) throw new Error("Pessoa inválida.");
    const admin = createAdminClient();
    if ((await empresaDoSolidesId(admin, input.pessoaId)) !== input.companyId) throw new Error("Pessoa não encontrada nesta empresa.");
    await pessoaDaEmpresa(admin, input.solidesId, input.companyId);

    const [{ data: cadAv }, { data: cadSol }, { data: lancAv }, { data: lancSol }, { data: fechadas }] = await Promise.all([
      admin.from("dp_folha_cadastro").select("*").eq("solides_id", input.pessoaId).maybeSingle(),
      admin.from("dp_folha_cadastro").select("solides_id").eq("solides_id", input.solidesId).maybeSingle(),
      admin.from("dp_folha_lancamentos").select("*").eq("solides_id", input.pessoaId),
      admin.from("dp_folha_lancamentos").select("competencia").eq("solides_id", input.solidesId),
      admin.from("dp_folha_fechamentos").select("competencia").eq("company_id", input.companyId),
    ]);
    const agora = new Date().toISOString();
    if (cadAv && !cadSol) {
      const { error } = await admin.from("dp_folha_cadastro").insert({ ...cadAv, solides_id: input.solidesId, updated_by: user.id, updated_at: agora });
      if (error) throw error;
    }
    const jaTem = new Set((lancSol ?? []).map((r) => r.competencia as string));
    const fechado = new Set((fechadas ?? []).map((r) => r.competencia as string));
    const mover = (lancAv ?? []).filter((r) => !jaTem.has(r.competencia as string) && !fechado.has(r.competencia as string));
    if (mover.length) {
      const { error } = await admin
        .from("dp_folha_lancamentos")
        .insert(mover.map((r) => ({ ...r, solides_id: input.solidesId, updated_by: user.id, updated_at: agora })));
      if (error) throw error;
    }
    const abertos = (lancAv ?? []).filter((r) => !fechado.has(r.competencia as string)).map((r) => r.competencia as string);
    if (abertos.length) {
      const { error } = await admin.from("dp_folha_lancamentos").delete().eq("solides_id", input.pessoaId).in("competencia", abertos);
      if (error) throw error;
    }
    await admin.from("dp_folha_rescisoes").update({ solides_id: input.solidesId }).eq("solides_id", input.pessoaId).eq("company_id", input.companyId);
    const { error } = await admin
      .from("dp_folha_avulsos")
      .update({ unificado_com: input.solidesId, updated_by: user.id, updated_at: agora })
      .eq("pessoa_id", input.pessoaId);
    if (error) throw error;
    revalidar();
    return { ok: true, data: { meses: mover.length } };
  } catch (error) {
    return falha(error);
  }
}

/**
 * FECHA a folha da empresa no mês: grava o RETRATO (linhas calculadas,
 * rescisões e os parâmetros usados). Depois disso, mudar parâmetro, cadastro
 * ou a Sólides não mexe mais nesse mês. Analista fecha a empresa dela;
 * reabrir é só do gestor.
 */
export async function fecharFolha(input: { companyId: string; competencia: string }): Promise<DpFolhaResult<{ pessoas: number }>> {
  try {
    const user = await requireDpEmpresa(input.companyId);
    exigirCompetencia(input.competencia);
    const admin = createAdminClient();
    const folha = await getFolhaEmpresa(admin, input.companyId, input.competencia);
    if (folha.fechamento) throw new Error("Esta folha já está fechada.");
    if (folha.linhas.length === 0) throw new Error("Não há ninguém na folha desta empresa neste mês.");
    const { error } = await admin.from("dp_folha_fechamentos").insert({
      company_id: input.companyId,
      competencia: input.competencia,
      resultado: { vigencia: folha.vigencia, parametros: folha.parametros, linhas: folha.linhas, rescisoes: folha.rescisoes },
      fechado_por: user.id,
    });
    if (error) {
      if (error.code === "23505") throw new Error("Alguém acabou de fechar esta folha.");
      throw error;
    }
    revalidar();
    return { ok: true, data: { pessoas: folha.linhas.length } };
  } catch (error) {
    return falha(error);
  }
}

export async function reabrirFolha(input: { companyId: string; competencia: string }): Promise<DpFolhaResult> {
  try {
    const user = await requireDpGestor();
    exigirEmpresa(user, input.companyId);
    exigirCompetencia(input.competencia);
    const { error } = await createAdminClient()
      .from("dp_folha_fechamentos")
      .delete()
      .eq("company_id", input.companyId)
      .eq("competencia", input.competencia);
    if (error) throw error;
    revalidar();
    return { ok: true, data: undefined };
  } catch (error) {
    return falha(error);
  }
}

export async function salvarRescisao(input: {
  companyId: string;
  competencia: string;
  id?: string;
  dataPagamento: string | null;
  tipo: string;
  setor: string;
  valor: number;
  solidesId: number | null;
  nome: string;
  observacao: string | null;
}): Promise<DpFolhaResult> {
  try {
    const user = await requireDpEmpresa(input.companyId);
    exigirCompetencia(input.competencia);
    const admin = createAdminClient();
    await exigirAberta(admin, input.companyId, input.competencia);
    if (input.solidesId !== null) await pessoaDaEmpresa(admin, input.solidesId, input.companyId);
    const nome = input.nome.trim();
    if (!nome) throw new Error("Informe o nome do colaborador.");
    if (!Number.isFinite(input.valor) || input.valor < 0) throw new Error("Valor inválido.");
    if (input.dataPagamento && !/^\d{4}-\d{2}-\d{2}$/.test(input.dataPagamento)) throw new Error("Data inválida.");
    const row = {
      company_id: input.companyId,
      competencia: input.competencia,
      data_pagamento: input.dataPagamento || null,
      tipo: input.tipo.trim().slice(0, 120),
      setor: input.setor.trim().slice(0, 120),
      valor: Math.round(input.valor * 100) / 100,
      solides_id: input.solidesId,
      nome: nome.slice(0, 200),
      observacao: (input.observacao ?? "").trim().slice(0, 500) || null,
    };
    const { error } = input.id
      ? await admin.from("dp_folha_rescisoes").update(row).eq("id", input.id).eq("company_id", input.companyId)
      : await admin.from("dp_folha_rescisoes").insert({ ...row, created_by: user.id });
    if (error) throw error;
    revalidar();
    return { ok: true, data: undefined };
  } catch (error) {
    return falha(error);
  }
}

export async function excluirRescisao(input: { companyId: string; competencia: string; id: string }): Promise<DpFolhaResult> {
  try {
    await requireDpEmpresa(input.companyId);
    exigirCompetencia(input.competencia);
    const admin = createAdminClient();
    await exigirAberta(admin, input.companyId, input.competencia);
    const { error } = await admin.from("dp_folha_rescisoes").delete().eq("id", input.id).eq("company_id", input.companyId);
    if (error) throw error;
    revalidar();
    return { ok: true, data: undefined };
  } catch (error) {
    return falha(error);
  }
}

/** Parâmetros de uma vigência (cria ou substitui). Só o gestor: é premissa do grupo inteiro. */
export async function salvarParametrosFolha(input: { vigencia: string; dados: DpFolhaParametros }): Promise<DpFolhaResult> {
  try {
    const user = await requireDpGestor();
    exigirCompetencia(input.vigencia);
    const dados = validarParametros(input.dados);
    const { error } = await createAdminClient()
      .from("dp_folha_parametros")
      .upsert({ vigencia: input.vigencia, dados, updated_by: user.id, updated_at: new Date().toISOString() }, { onConflict: "vigencia" });
    if (error) throw error;
    revalidar();
    return { ok: true, data: undefined };
  } catch (error) {
    return falha(error);
  }
}

export async function excluirVigenciaFolha(input: { vigencia: string }): Promise<DpFolhaResult> {
  try {
    await requireDpGestor();
    exigirCompetencia(input.vigencia);
    const { error } = await createAdminClient().from("dp_folha_parametros").delete().eq("vigencia", input.vigencia);
    if (error) throw error;
    revalidar();
    return { ok: true, data: undefined };
  } catch (error) {
    return falha(error);
  }
}

// ── importação da planilha de folha ────────────────────────────────────────

export interface DpImportacaoFolhaResumo {
  linhas: number;
  casadas: number;
  parciais: Array<{ planilha: string; solides: string }>;
  naoEncontradas: string[];
  ambiguas: Array<{ planilha: string; candidatos: string[] }>;
  foraDoEscopo: number;
  /** Não encontradas na Sólides que viram (ou viraram) pessoas FORA da Sólides. */
  avulsosNovos: number;
  /** Não encontradas cuja empresa não deu para deduzir — ficam listadas, não criadas. */
  avulsosSemEmpresa: string[];
  /** Casadas, mas a Sólides não diz de que empresa são (de-para pendente): o cadastro entra, a folha só depois. */
  semEmpresa: number;
  /** Setor da planilha diferente do departamento da Sólides: vira o "setor da folha". */
  setoresDaFolha: number;
  /** Centros de custo da planilha que não existiam no cadastro do DP (por empresa). */
  centrosNovos: number;
  /** Pessoas que recebem o centro de custo da planilha (quem já tinha centro definido fica como está). */
  pessoasComCentro: number;
  porEmpresa: Array<{ empresa: string; pessoas: number }>;
  jaTinhamCadastro: number;
  comAjustes: number;
  mesesFechados: number;
  avisos: Array<{ texto: string; vezes: number }>;
  aplicado: boolean;
}

/**
 * Lê a planilha de folha do DP (abas CONTROLE e, se houver, SALÁRIO) e grava o
 * CADASTRO DA FOLHA de cada pessoa casada e — se pedido — o LANÇAMENTO da
 * competência, com os valores digitados na aba SALÁRIO como ajustes manuais.
 * Sem `confirmar`, só devolve a prévia (nada é gravado). Casa contra os
 * colaboradores que a pessoa pode ver; quem é de empresa fora do escopo é
 * contado, nunca gravado.
 */
export async function importarPlanilhaFolha(form: FormData): Promise<DpFolhaResult<DpImportacaoFolhaResumo>> {
  try {
    const companyId = String(form.get("companyId") ?? "");
    const user = await requireDpEmpresa(companyId);
    const competencia = String(form.get("competencia") ?? "");
    exigirCompetencia(competencia);
    const comMes = form.get("comMes") === "1";
    const criarAvulsos = form.get("criarAvulsos") === "1";
    const confirmar = form.get("confirmar") === "1";
    const file = form.get("file");
    if (!(file instanceof File)) throw new Error("Envie a planilha (.xlsx).");
    if (file.size > 15 * 1024 * 1024) throw new Error("Planilha maior que 15 MB.");

    let wb: XLSX.WorkBook;
    try {
      wb = XLSX.read(await file.arrayBuffer(), { type: "array", cellDates: true });
    } catch (e) {
      const msg = e instanceof Error ? e.message : "";
      if (/password|encrypt/i.test(msg)) {
        throw new Error("A planilha está protegida por senha. Abra no Excel, tire a senha (Arquivo › Informações › Proteger pasta de trabalho) e envie de novo.");
      }
      throw new Error("Não consegui ler o arquivo. Ele é um .xlsx?");
    }
    const nomeAba = (alvo: string) => wb.SheetNames.find((n) => normalizarNome(n) === normalizarNome(alvo));
    const abaControle = nomeAba("CONTROLE") ?? wb.SheetNames[0];
    const matriz = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[abaControle], { header: 1, defval: "" });

    const admin = createAdminClient();
    const parametros = await parametrosVigentes(admin, competencia);
    const lido = lerControle(matriz, parametros);
    if ("erro" in lido) throw new Error(lido.erro);

    // Ajustes = células DIGITADAS (sem fórmula) da aba SALÁRIO.
    let ajustes = new Map<string, DpFolhaLancamento["ajustes"]>();
    const abaSalario = nomeAba("SALÁRIO");
    if (comMes && abaSalario) {
      const ws = wb.Sheets[abaSalario];
      const m = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, defval: "" });
      const iCab = m.findIndex((row) => (row ?? []).some((c) => typeof c === "string" && normalizarNome(c) === "funcionarios"));
      if (iCab >= 0) {
        const cab = (m[iCab] ?? []).map((c) => String(c ?? "").trim());
        const linhasAj: Array<{ nome: string; celulas: Record<string, { valor: number; digitado: boolean }> }> = [];
        for (let r = iCab + 1; r < m.length; r++) {
          const nome = String((m[r] ?? [])[0] ?? "").trim();
          if (!nome) continue;
          const celulas: Record<string, { valor: number; digitado: boolean }> = {};
          cab.forEach((h, j) => {
            const cell = ws[XLSX.utils.encode_cell({ r, c: j })];
            if (h && cell && typeof cell.v === "number") celulas[h] = { valor: cell.v, digitado: !cell.f };
          });
          linhasAj.push({ nome, celulas });
        }
        ajustes = ajustesDaPlanilha(linhasAj, rotuloCompetencia(competencia));
      }
    }

    // Candidatos: colaboradores ATIVOS, com a empresa pela regra de sempre.
    const [{ data: colabs, error: eCol }, regras, { data: comps }] = await Promise.all([
      admin.from("dp_colaboradores").select("id, solides_id, nome, unidade_id, departamento_id, departamento_nome").eq("ativo", true),
      listDpRegras(admin),
      admin.from("companies").select("id, name"),
    ]);
    if (eCol) throw eCol;
    const idx = indexarRegras(regras);
    const nomeEmpresa = new Map((comps ?? []).map((c) => [c.id as string, c.name as string]));
    const empresaDe = new Map<number, string | null>();
    const setorSolides = new Map((colabs ?? []).map((r) => [Number(r.solides_id), String(r.departamento_nome ?? "").replace(/\s+-\s+.*$/, "").trim()]));
    const colabIdDe = new Map((colabs ?? []).map((r) => [Number(r.solides_id), r.id as string]));
    const pessoas: DpPessoaParaCasar[] = (colabs ?? []).map((r) => {
      const e = resolverEmpresa(
        {
          unidadeId: r.unidade_id === null ? null : Number(r.unidade_id),
          departamentoId: r.departamento_id === null ? null : Number(r.departamento_id),
        },
        idx,
      );
      empresaDe.set(Number(r.solides_id), e.companyId);
      return { solidesId: Number(r.solides_id), nome: r.nome as string };
    });

    // Avulsos já cadastrados (das empresas que a pessoa vê) também casam: reimportar
    // atualiza o avulso em vez de criar outro.
    const { data: avs, error: eAv } = await admin.from("dp_folha_avulsos").select("pessoa_id, nome, company_id").is("unificado_com", null);
    if (eAv) throw eAv;
    for (const a of avs ?? []) {
      empresaDe.set(Number(a.pessoa_id), a.company_id as string);
      pessoas.push({ solidesId: Number(a.pessoa_id), nome: a.nome as string });
    }

    const resumo: DpImportacaoFolhaResumo = {
      linhas: lido.ok.length,
      casadas: 0,
      parciais: [],
      naoEncontradas: [],
      ambiguas: [],
      foraDoEscopo: 0,
      avulsosNovos: 0,
      avulsosSemEmpresa: [],
      semEmpresa: 0,
      setoresDaFolha: 0,
      centrosNovos: 0,
      pessoasComCentro: 0,
      porEmpresa: [],
      jaTinhamCadastro: 0,
      comAjustes: 0,
      mesesFechados: 0,
      avisos: [],
      aplicado: false,
    };
    const porEmpresa = new Map<string, number>();
    const avisos = new Map<string, number>();
    const gravarCadastro: Array<Record<string, unknown>> = [];
    const gravarMes: Array<Record<string, unknown>> = [];
    const usados = new Set<number>();
    const fechadas = new Map<string, boolean>();
    // Centro de custo da planilha → por EMPRESA (o cadastro de centros do DP é por empresa).
    const centroPedido: Array<{ solidesId: number; empresa: string; nome: string }> = [];
    const centroAvulso: Array<{ pessoaId: number; empresa: string; chave: string; nome: string }> = [];

    // Empresa de quem NÃO casou: aprendida da "EMPRESA REGISTRADA" de quem casou.
    const casados = lido.ok
      .map((l) => ({ l, c: casarNome(l.nome, pessoas) }))
      .filter((x): x is { l: (typeof lido.ok)[number]; c: { tipo: "exato" | "parcial"; solidesId: number; nomeSolides: string } } => x.c.tipo === "exato" || x.c.tipo === "parcial");
    const empresaDoRotulo = empresasPorRotulo(
      casados.flatMap(({ l, c }) => {
        const e = empresaDe.get(c.solidesId);
        return e ? [{ rotulo: l.empresaPlanilha, companyId: e }] : [];
      }),
    );
    const novosAvulsos: Array<{ l: (typeof lido.ok)[number]; empresa: string }> = [];

    for (const l of lido.ok) {
      const c = casarNome(l.nome, pessoas);
      if (c.tipo === "nenhum") {
        resumo.naoEncontradas.push(l.nome);
        if (criarAvulsos || !confirmar) {
          const emp = empresaDoRotulo.get(normalizarNome(l.empresaPlanilha)) ?? null;
          if (!emp) resumo.avulsosSemEmpresa.push(l.nome);
          // A mesma pessoa duas vezes na planilha vira UM avulso.
          else if (novosAvulsos.some((x) => normalizarNome(x.l.nome) === normalizarNome(l.nome))) continue;
          else if (podeVerEmpresa(user, emp)) novosAvulsos.push({ l, empresa: emp });
          else resumo.foraDoEscopo++;
        }
        continue;
      }
      if (c.tipo === "ambiguo") {
        resumo.ambiguas.push({ planilha: l.nome, candidatos: c.candidatos });
        continue;
      }
      const emp = empresaDe.get(c.solidesId) ?? null;
      // Sem empresa: só o gestor alcança (podeVerEmpresa(gestor, null) = true); a analista conta como fora.
      if (!podeVerEmpresa(user, emp)) {
        resumo.foraDoEscopo++;
        continue;
      }
      if (usados.has(c.solidesId)) {
        resumo.ambiguas.push({ planilha: l.nome, candidatos: [`${c.nomeSolides} (já casado com outra linha)`] });
        continue;
      }
      usados.add(c.solidesId);
      resumo.casadas++;
      if (c.tipo === "parcial") resumo.parciais.push({ planilha: l.nome, solides: c.nomeSolides });
      if (emp) porEmpresa.set(emp, (porEmpresa.get(emp) ?? 0) + 1);
      else resumo.semEmpresa++;
      for (const a of l.avisos) avisos.set(a, (avisos.get(a) ?? 0) + 1);

      // O setor da planilha é a classificação da folha; só vira override quando difere da Sólides.
      const setorPl = l.setorPlanilha.trim();
      const setorFolha = setorPl && normalizarNome(setorPl) !== normalizarNome(setorSolides.get(c.solidesId) ?? "") ? setorPl : null;
      if (setorFolha) resumo.setoresDaFolha++;
      if (emp && l.centroPlanilha.trim()) {
        if (c.solidesId < 0) centroAvulso.push({ pessoaId: c.solidesId, empresa: emp, chave: chaveNome(l.centroPlanilha.trim()), nome: l.centroPlanilha.trim() });
        else centroPedido.push({ solidesId: c.solidesId, empresa: emp, nome: l.centroPlanilha.trim() });
      }
      const cadastro = validarCadastro({ ...l.cadastro, setorFolha }, parametros);
      gravarCadastro.push({ solides_id: c.solidesId, ...linhaCadastro(cadastro), updated_by: user.id, updated_at: new Date().toISOString() });
      if (comMes) {
        if (emp && !fechadas.has(emp)) fechadas.set(emp, await folhaFechada(admin, emp, competencia));
        if (emp && fechadas.get(emp)) {
          resumo.mesesFechados++;
          continue;
        }
        const aj = ajustes.get(normalizarNome(l.nome)) ?? {};
        if (Object.keys(aj).length) resumo.comAjustes++;
        const lanc = validarLancamento({ ...l.lancamento, ajustes: aj });
        gravarMes.push({
          competencia,
          solides_id: c.solidesId,
          ...linhaLancamento(lanc),
          updated_by: user.id,
          updated_at: new Date().toISOString(),
        });
      }
    }

    if (gravarCadastro.length) {
      const { data: existentes } = await admin
        .from("dp_folha_cadastro")
        .select("solides_id")
        .in("solides_id", gravarCadastro.map((g) => g.solides_id as number));
      resumo.jaTinhamCadastro = (existentes ?? []).length;
    }
    // Centros: quais faltam criar e quem ainda não tem centro definido (o que já está definido no DP não é tocado).
    const empresasComCentro = Array.from(new Set(centroPedido.map((x) => x.empresa)));
    const paginas = new Map(
      await Promise.all(empresasComCentro.map(async (e) => [e, await getDpCargosPagina(admin, e).catch(() => null)] as const)),
    );
    const centrosACriar = new Map<string, { company_id: string; nome: string; nome_chave: string }>();
    const atribuir: Array<{ solidesId: number; empresa: string; chave: string }> = [];
    for (const x of centroPedido) {
      const pag = paginas.get(x.empresa);
      const chave = chaveNome(x.nome);
      const existe = pag?.centros.find((c) => chaveNome(c.nome) === chave);
      if (!existe) centrosACriar.set(`${x.empresa}|${chave}`, { company_id: x.empresa, nome: x.nome, nome_chave: chave });
      const enq = pag?.enquadramento.find((r) => r.colaboradorId === colabIdDe.get(x.solidesId));
      if (!enq?.centroId) atribuir.push({ solidesId: x.solidesId, empresa: x.empresa, chave });
    }
    resumo.centrosNovos = centrosACriar.size;
    resumo.avulsosNovos = novosAvulsos.length;
    resumo.pessoasComCentro = atribuir.length;
    resumo.porEmpresa = Array.from(porEmpresa, ([id, n]) => ({ empresa: nomeEmpresa.get(id) ?? id, pessoas: n })).sort((a, b) => b.pessoas - a.pessoas);
    resumo.avisos = Array.from(avisos, ([texto, vezes]) => ({ texto, vezes })).sort((a, b) => b.vezes - a.vezes);

    if (confirmar && criarAvulsos && novosAvulsos.length) {
      // Cria as pessoas fora da Sólides com os dados da própria planilha e grava
      // o cadastro e o mês delas como o das casadas.
      const cab = matriz.find((row) => (row ?? []).some((c) => typeof c === "string" && normalizarNome(c) === "funcionarios")) ?? [];
      const iSal = cab.findIndex((c) => typeof c === "string" && normalizarNome(c) === "salario bruto carteira");
      const iDn = cab.findIndex((c) => typeof c === "string" && normalizarNome(c) === "dn beneficiario");
      const agora = new Date().toISOString();
      for (const { l, empresa } of novosAvulsos) {
        const row = (matriz[l.linha - 1] ?? []) as unknown[];
        const dados = validarAvulso({
          nome: l.nome,
          cpf: null,
          setor: l.setorPlanilha || null,
          tipoContrato: contratoDaPlanilha(l.contratoPlanilha),
          salario: iSal >= 0 && row[iSal] !== "" ? lerNumero(row[iSal]) : null,
          nascimento: iDn >= 0 ? lerData(row[iDn]) : null,
          admissao: null,
          desligamento: null,
          observacao: "incluída pela importação da planilha de folha (não existe na Sólides)",
        });
        const { data: novo, error } = await admin
          .from("dp_folha_avulsos")
          .insert({ ...linhaAvulso(dados), company_id: empresa, created_by: user.id, updated_by: user.id })
          .select("pessoa_id")
          .single();
        if (error) throw error;
        const pid = Number(novo.pessoa_id);
        gravarCadastro.push({ solides_id: pid, ...linhaCadastro(validarCadastro(l.cadastro, parametros)), updated_by: user.id, updated_at: agora });
        if (comMes && !(fechadas.get(empresa) ?? (await folhaFechada(admin, empresa, competencia)))) {
          const aj = ajustes.get(normalizarNome(l.nome)) ?? {};
          gravarMes.push({ competencia, solides_id: pid, ...linhaLancamento(validarLancamento({ ...l.lancamento, ajustes: aj })), updated_by: user.id, updated_at: agora });
        }
        if (l.centroPlanilha.trim()) centroAvulso.push({ pessoaId: pid, empresa, chave: chaveNome(l.centroPlanilha.trim()), nome: l.centroPlanilha.trim() });
      }
    }

    if (confirmar) {
      if (gravarCadastro.length) {
        const { error } = await admin.from("dp_folha_cadastro").upsert(gravarCadastro, { onConflict: "solides_id" });
        if (error) throw error;
      }
      if (gravarMes.length) {
        const { error } = await admin.from("dp_folha_lancamentos").upsert(gravarMes, { onConflict: "competencia,solides_id" });
        if (error) throw error;
      }
      // Centros pedidos pelos avulsos também precisam existir.
      for (const x of centroAvulso) {
        const pag = paginas.get(x.empresa) ?? (await getDpCargosPagina(admin, x.empresa).catch(() => null));
        paginas.set(x.empresa, pag);
        if (!pag?.centros.some((c) => chaveNome(c.nome) === x.chave)) {
          centrosACriar.set(`${x.empresa}|${x.chave}`, { company_id: x.empresa, nome: x.nome, nome_chave: x.chave });
        }
      }
      if (centrosACriar.size) {
        const { error } = await admin
          .from("dp_centros_custo")
          .insert(Array.from(centrosACriar.values()).map((c) => ({ ...c, codigo: "", updated_by: user.id })));
        if (error && error.code !== "23505") throw error;
      }
      if (atribuir.length) {
        const { data: todos, error: eC } = await admin
          .from("dp_centros_custo")
          .select("id, company_id, nome_chave")
          .in("company_id", empresasComCentro);
        if (eC) throw eC;
        const idDe = new Map((todos ?? []).map((c) => [`${c.company_id}|${c.nome_chave}`, c.id as string]));
        const agora = new Date().toISOString();
        const linhas = atribuir
          .map((a) => ({ solides_id: a.solidesId, centro: idDe.get(`${a.empresa}|${a.chave}`) }))
          .filter((a): a is { solides_id: number; centro: string } => Boolean(a.centro))
          .map((a) => ({
            solides_id: a.solides_id,
            centro_custo_id: a.centro,
            centro_motivo: "planilha de folha do DP",
            updated_by: user.id,
            updated_at: agora,
          }));
        if (linhas.length) {
          const { error } = await admin.from("dp_colaborador_ajustes").upsert(linhas, { onConflict: "solides_id" });
          if (error) throw error;
        }
      }
      if (centroAvulso.length) {
        const emps = Array.from(new Set(centroAvulso.map((x) => x.empresa)));
        const { data: todos, error: eC } = await admin.from("dp_centros_custo").select("id, company_id, nome_chave").in("company_id", emps);
        if (eC) throw eC;
        const idDe = new Map((todos ?? []).map((c) => [`${c.company_id}|${c.nome_chave}`, c.id as string]));
        for (const x of centroAvulso) {
          const id = idDe.get(`${x.empresa}|${x.chave}`);
          if (!id) continue;
          const { error } = await admin
            .from("dp_folha_avulsos")
            .update({ centro_custo_id: id })
            .eq("pessoa_id", x.pessoaId)
            .is("centro_custo_id", null);
          if (error) throw error;
        }
      }
      resumo.aplicado = true;
      revalidar();
    }
    return { ok: true, data: resumo };
  } catch (error) {
    return falha(error);
  }
}
