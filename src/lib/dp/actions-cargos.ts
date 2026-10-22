"use server";

import { revalidatePath } from "next/cache";
import * as XLSX from "xlsx";

import { DP_CARGOS_PATH } from "@/lib/auth/dp";
import { exigirEmpresa, requireDpEmpresa } from "@/lib/dp/auth";
import { chaveNome } from "@/lib/dp/cargos";
import { getDpTabela, listDpCentrosCusto, listDpEmpresasComQuadro } from "@/lib/dp/cargos-queries";
import { podeVerEmpresa } from "@/lib/dp/escopo";
import { lerPercentual, ordemEntre, parseTabelaPlanilha, planejarCopia, planejarImportacao } from "@/lib/dp/tabela-salarial";
import { createAdminClient } from "@/lib/supabase/admin";

// Escrita da tabela salarial e do de-para Sólides → linha. Toda action passa
// por requireDpEmpresa(companyId) — concessão E a empresa no escopo de quem
// clica (a analista só alcança as liberadas a ela) — e grava com o admin
// client: as tabelas dp_* não têm policy de escrita. dp-escrita.test.ts cobra.

export type DpCargoResult<T = undefined> = { ok: true; data: T } | { ok: false; error: string };

type Admin = ReturnType<typeof createAdminClient>;

function falha(error: unknown): { ok: false; error: string } {
  const e = error as { code?: string; message?: string } | null;
  if (e?.code === "23505") return { ok: false, error: "Já existe outra linha com o mesmo setor e cargo nesta empresa." };
  if (e?.code === "PGRST205" || e?.code === "42P01" || e?.code === "PGRST202") {
    return { ok: false, error: "Tabela salarial ainda não instalada no banco (migration 20261002130000)." };
  }
  return { ok: false, error: e?.message || "Erro inesperado." };
}

function texto(v: string, max = 120): string {
  const t = (v ?? "").replace(/\s+/g, " ").trim();
  if (t.length > max) throw new Error(`Texto passa de ${max} caracteres.`);
  return t;
}

function salarioValido(v: number): number {
  if (!Number.isFinite(v) || v < 0) throw new Error("Salário inválido.");
  if (v > 10_000_000) throw new Error("Salário fora do esperado — confira o valor.");
  return Math.round(v * 100) / 100;
}

function campos(input: { setor: string; cargo: string; salario: number }) {
  const setor = texto(input.setor);
  const cargo = texto(input.cargo);
  if (!cargo) throw new Error("Informe o cargo.");
  return {
    setor,
    setor_chave: chaveNome(setor),
    cargo,
    cargo_chave: chaveNome(cargo),
    salario: salarioValido(input.salario),
  };
}

async function empresaExiste(admin: Admin, companyId: string) {
  const { data } = await admin.from("companies").select("id").eq("id", companyId).maybeSingle();
  if (!data) throw new Error("Empresa não encontrada.");
}

function revalidar() {
  revalidatePath(DP_CARGOS_PATH);
}

export async function criarLinha(input: {
  companyId: string;
  setor: string;
  cargo: string;
  salario: number;
  /** Insere logo abaixo desta linha; ausente = no fim da tabela. */
  depoisDeId?: string | null;
}): Promise<DpCargoResult<{ id: string }>> {
  try {
    const user = await requireDpEmpresa(input.companyId);
    const admin = createAdminClient();
    await empresaExiste(admin, input.companyId);
    const tabela = await getDpTabela(admin, input.companyId);
    const i = input.depoisDeId ? tabela.findIndex((l) => l.id === input.depoisDeId) : -1;
    const ordem =
      i >= 0
        ? ordemEntre(tabela[i].ordem, tabela[i + 1]?.ordem ?? null)
        : ordemEntre(tabela.length ? tabela[tabela.length - 1].ordem : null, null);
    const { data, error } = await admin
      .from("dp_tabela_salarial")
      .insert({ ...campos(input), company_id: input.companyId, ordem, updated_by: user.id })
      .select("id")
      .single();
    if (error) throw error;
    revalidar();
    return { ok: true, data: { id: data.id as string } };
  } catch (error) {
    return falha(error);
  }
}

export async function salvarLinha(input: {
  companyId: string;
  id: string;
  setor: string;
  cargo: string;
  salario: number;
}): Promise<DpCargoResult> {
  try {
    const user = await requireDpEmpresa(input.companyId);
    const { error } = await createAdminClient()
      .from("dp_tabela_salarial")
      .update({ ...campos(input), updated_by: user.id, updated_at: new Date().toISOString() })
      .eq("id", input.id)
      .eq("company_id", input.companyId);
    if (error) throw error;
    revalidar();
    return { ok: true, data: undefined };
  } catch (error) {
    return falha(error);
  }
}

/** Exclui a linha; quem estava vinculado a ela volta a "cargo sem linha na tabela" (cascata). */
export async function excluirLinha(input: { companyId: string; id: string }): Promise<DpCargoResult> {
  try {
    await requireDpEmpresa(input.companyId);
    const { error } = await createAdminClient()
      .from("dp_tabela_salarial")
      .delete()
      .eq("id", input.id)
      .eq("company_id", input.companyId);
    if (error) throw error;
    revalidar();
    return { ok: true, data: undefined };
  } catch (error) {
    return falha(error);
  }
}

/** Palavra que a tela pede para digitar antes de apagar a tabela inteira. */
const CONFIRMACAO_APAGAR = "APAGAR";

/**
 * Apaga TODAS as linhas da tabela salarial da empresa. Os vínculos com a
 * Sólides vão junto (cascata) — todo mundo volta a "cargo sem linha na
 * tabela". O histórico de reajustes é mantido: ele registra o que aconteceu,
 * não depende das linhas. A confirmação digitada é conferida AQUI também, não
 * só no botão: é o único gesto do módulo que apaga tudo de uma vez.
 */
export async function apagarTabela(input: { companyId: string; confirmacao: string }): Promise<DpCargoResult<{ apagadas: number }>> {
  try {
    await requireDpEmpresa(input.companyId);
    if (input.confirmacao.trim().toUpperCase() !== CONFIRMACAO_APAGAR) {
      throw new Error(`Digite ${CONFIRMACAO_APAGAR} para confirmar.`);
    }
    const admin = createAdminClient();
    await empresaExiste(admin, input.companyId);
    const { data, error } = await admin.from("dp_tabela_salarial").delete().eq("company_id", input.companyId).select("id");
    if (error) throw error;
    revalidar();
    return { ok: true, data: { apagadas: (data ?? []).length } };
  } catch (error) {
    return falha(error);
  }
}

/** Sobe ou desce uma linha, trocando a ordem com a vizinha. */
export async function moverLinha(input: { companyId: string; id: string; direcao: "cima" | "baixo" }): Promise<DpCargoResult> {
  try {
    await requireDpEmpresa(input.companyId);
    const admin = createAdminClient();
    const tabela = await getDpTabela(admin, input.companyId);
    const i = tabela.findIndex((l) => l.id === input.id);
    const j = input.direcao === "cima" ? i - 1 : i + 1;
    if (i < 0 || j < 0 || j >= tabela.length) return { ok: true, data: undefined };
    const a = tabela[i];
    const b = tabela[j];
    // Ordens iguais (linhas inseridas ao mesmo tempo) não se trocam: afasta meio ponto.
    const novaA = a.ordem === b.ordem ? b.ordem + (input.direcao === "cima" ? -0.5 : 0.5) : b.ordem;
    const novaB = a.ordem === b.ordem ? b.ordem : a.ordem;
    for (const [id, ordem] of [[a.id, novaA], [b.id, novaB]] as const) {
      const { error } = await admin.from("dp_tabela_salarial").update({ ordem }).eq("id", id).eq("company_id", input.companyId);
      if (error) throw error;
    }
    revalidar();
    return { ok: true, data: undefined };
  } catch (error) {
    return falha(error);
  }
}

/** "Ordenar por setor e cargo" (número do fim do nome em ordem numérica): renumera no banco. */
export async function ordenarTabela(input: { companyId: string }): Promise<DpCargoResult> {
  try {
    await requireDpEmpresa(input.companyId);
    const { error } = await createAdminClient().rpc("dp_ordenar_tabela", { p_company_id: input.companyId });
    if (error) throw error;
    revalidar();
    return { ok: true, data: undefined };
  } catch (error) {
    return falha(error);
  }
}

/**
 * Reajuste % sobre TODOS os salários da tabela da empresa. Sempre >= 0
 * (`lerPercentual` aqui e o CHECK da função no banco). Tudo ou nada: o UPDATE e
 * o registro em dp_tabela_reajustes rodam na mesma transação.
 */
export async function aplicarReajuste(input: {
  companyId: string;
  percentual: string;
}): Promise<DpCargoResult<{ linhas: number; antes: number; depois: number; percentual: number }>> {
  try {
    const user = await requireDpEmpresa(input.companyId);
    const lido = lerPercentual(input.percentual);
    if ("erro" in lido) throw new Error(lido.erro);
    const admin = createAdminClient();
    await empresaExiste(admin, input.companyId);
    const { data, error } = await admin.rpc("dp_aplicar_reajuste", {
      p_company_id: input.companyId,
      p_percentual: lido.ok,
      p_user_id: user.id,
    });
    if (error) throw error;
    const r = (Array.isArray(data) ? data[0] : data) as { linhas: number; total_antes: number; total_depois: number } | null;
    revalidar();
    return {
      ok: true,
      data: {
        linhas: Number(r?.linhas ?? 0),
        antes: Number(r?.total_antes ?? 0),
        depois: Number(r?.total_depois ?? 0),
        percentual: lido.ok,
      },
    };
  } catch (error) {
    return falha(error);
  }
}

export interface DpImportacaoResultado {
  inseridas: number;
  atualizadas: number;
  iguais: number;
  foraDaPlanilha: number;
  problemas: string[];
}

/**
 * Importa a planilha `Setor | Cargo | Salário` de UMA empresa (coluna Step,
 * se vier, é juntada ao nome do cargo — ver @/lib/dp/tabela-salarial).
 * Aditiva e idempotente (ver `planejarImportacao`): atualiza o salário do que
 * já existe, acrescenta o novo e NÃO apaga o que ficou fora da planilha.
 * Falha por linha, nunca pelo arquivo.
 */
export async function importarTabela(form: FormData): Promise<DpCargoResult<DpImportacaoResultado>> {
  try {
    const companyId = String(form.get("companyId") ?? "");
    const user = await requireDpEmpresa(companyId);
    const file = form.get("file");
    if (!(file instanceof File)) throw new Error("Envie a planilha (.xlsx).");
    if (file.size > 5 * 1024 * 1024) throw new Error("Planilha maior que 5 MB.");
    const admin = createAdminClient();
    await empresaExiste(admin, companyId);

    let data: unknown[][];
    try {
      const wb = XLSX.read(await file.arrayBuffer(), { type: "array" });
      const ws = wb.Sheets[wb.SheetNames[0]];
      if (!ws) throw new Error("Planilha vazia.");
      data = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, blankrows: true, defval: "" });
    } catch {
      throw new Error("Não consegui ler o arquivo. Ele é um .xlsx (ou .xls/.csv)?");
    }
    const lido = parseTabelaPlanilha(data);
    if ("erro" in lido) throw new Error(lido.erro);

    const existentes = await getDpTabela(admin, companyId);
    const plano = planejarImportacao(lido.ok.linhas, existentes);
    const agora = new Date().toISOString();

    for (const a of plano.atualizar) {
      const { error } = await admin
        .from("dp_tabela_salarial")
        .update({ salario: a.salario, updated_by: user.id, updated_at: agora })
        .eq("id", a.id)
        .eq("company_id", companyId);
      if (error) throw error;
    }
    if (plano.inserir.length > 0) {
      // Novas entram no fim, na ordem em que estão na planilha.
      let ordem = existentes.length ? existentes[existentes.length - 1].ordem : 0;
      const rows = plano.inserir.map((l) => {
        ordem += 1;
        return { ...campos(l), company_id: companyId, ordem, updated_by: user.id };
      });
      const { error } = await admin.from("dp_tabela_salarial").insert(rows);
      if (error) throw error;
    }
    revalidar();
    return {
      ok: true,
      data: {
        inseridas: plano.inserir.length,
        atualizadas: plano.atualizar.length,
        iguais: plano.iguais,
        foraDaPlanilha: plano.foraDaPlanilha,
        problemas: lido.ok.problemas,
      },
    };
  } catch (error) {
    return falha(error);
  }
}

export interface DpOrigemCopia {
  companyId: string;
  nome: string;
  linhas: number;
}

/**
 * De onde dá para copiar a tabela: as empresas que ESTA pessoa vê (a analista
 * só as dela), que têm tabela, menos a própria. Contagem exata por empresa —
 * uma leitura das linhas de todas truncaria em 1.000 (a VE Franqueadora sozinha
 * tem 660).
 */
export async function listarOrigensDeCopia(input: { companyId: string }): Promise<DpCargoResult<DpOrigemCopia[]>> {
  try {
    const user = await requireDpEmpresa(input.companyId);
    const admin = createAdminClient();
    const empresas = (await listDpEmpresasComQuadro(admin)).filter((e) => e.id !== input.companyId && podeVerEmpresa(user, e.id));
    const contagens = await Promise.all(
      empresas.map(async (e) => {
        const { count, error } = await admin.from("dp_tabela_salarial").select("id", { count: "exact", head: true }).eq("company_id", e.id);
        if (error) throw error;
        return { companyId: e.id, nome: e.name, linhas: count ?? 0 };
      }),
    );
    return { ok: true, data: contagens.filter((c) => c.linhas > 0).sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR")) };
  } catch (error) {
    return falha(error);
  }
}

export interface DpPreviaCopia {
  origemNome: string;
  linhasOrigem: number;
  linhasDestino: number;
  novas: number;
  iguais: number;
  diferentes: number;
  /** Salários trocados pelos da origem (só com `atualizarSalarios`). */
  atualizadas: number;
  soNoDestino: number;
  comCentro: number;
  centrosSemPar: string[];
  aplicado: boolean;
}

/**
 * Copia a tabela salarial de outra empresa para ESTA (a do seletor do topo).
 * Sem `confirmar`, só a prévia — nada é gravado. Regra em `planejarCopia`:
 * aditiva (insere o novo, nunca apaga), salário de linha que já existe só muda
 * com `atualizarSalarios`, centro de custo pelo NOME (é cadastro por empresa).
 * O de-para com a Sólides e o histórico de reajustes são da empresa e não vêm.
 * A origem também passa pelo escopo: a analista não copia de empresa que não vê.
 */
export async function copiarTabelaDeEmpresa(input: {
  companyId: string;
  origemId: string;
  atualizarSalarios: boolean;
  confirmar: boolean;
}): Promise<DpCargoResult<DpPreviaCopia>> {
  try {
    const user = await requireDpEmpresa(input.companyId);
    exigirEmpresa(user, input.origemId);
    if (!input.origemId || input.origemId === input.companyId) throw new Error("Escolha uma OUTRA empresa para copiar.");
    const admin = createAdminClient();
    await empresaExiste(admin, input.companyId);
    const [{ data: origemEmp }, origem, destino, centrosOrigem, centrosDestino] = await Promise.all([
      admin.from("companies").select("name").eq("id", input.origemId).maybeSingle(),
      getDpTabela(admin, input.origemId),
      getDpTabela(admin, input.companyId),
      listDpCentrosCusto(admin, input.origemId),
      listDpCentrosCusto(admin, input.companyId),
    ]);
    if (!origemEmp) throw new Error("Empresa de origem não encontrada.");
    const origemNome = origemEmp.name as string;
    if (origem.length === 0) throw new Error(`A tabela salarial de ${origemNome} está vazia — nada a copiar.`);
    const nomeCentro = new Map(centrosOrigem.map((c) => [c.id, c.nome]));
    const plano = planejarCopia(
      origem.map((l) => ({ setor: l.setor, cargo: l.cargo, salario: l.salario, centroNome: l.centroCustoId ? nomeCentro.get(l.centroCustoId) ?? null : null })),
      destino,
      centrosDestino,
      input.atualizarSalarios,
    );
    const previa: DpPreviaCopia = {
      origemNome,
      linhasOrigem: origem.length,
      linhasDestino: destino.length,
      novas: plano.inserir.length,
      iguais: plano.iguais,
      diferentes: plano.diferentes,
      atualizadas: plano.atualizar.length,
      soNoDestino: plano.soNoDestino,
      comCentro: plano.comCentro,
      centrosSemPar: plano.centrosSemPar,
      aplicado: false,
    };
    if (!input.confirmar) return { ok: true, data: previa };
    if (plano.inserir.length === 0 && plano.atualizar.length === 0) throw new Error("Nada a copiar: a tabela daqui já tem todas as linhas de " + origemNome + ".");

    const agora = new Date().toISOString();
    // Em lotes, para 600 linhas não virarem 600 idas sequenciais ao banco.
    for (let i = 0; i < plano.atualizar.length; i += 25) {
      const lote = plano.atualizar.slice(i, i + 25);
      const res = await Promise.all(
        lote.map((a) =>
          admin.from("dp_tabela_salarial").update({ salario: a.salario, updated_by: user.id, updated_at: agora }).eq("id", a.id).eq("company_id", input.companyId),
        ),
      );
      const erro = res.find((r) => r.error)?.error;
      if (erro) throw erro;
    }
    if (plano.inserir.length > 0) {
      // Novas entram no fim, na ordem da origem.
      let ordem = destino.length ? destino[destino.length - 1].ordem : 0;
      const rows = plano.inserir.map((l) => {
        ordem += 1;
        return { ...campos(l), centro_custo_id: l.centroCustoId, company_id: input.companyId, ordem, updated_by: user.id };
      });
      const { error } = await admin.from("dp_tabela_salarial").insert(rows);
      if (error) throw error;
    }
    revalidar();
    return { ok: true, data: { ...previa, aplicado: true } };
  } catch (error) {
    return falha(error);
  }
}

/**
 * De-para de UM ou VÁRIOS cargos da Sólides → linha da tabela desta empresa.
 * `linhaId` null remove o vínculo. Cada linha é conferida contra a empresa:
 * vínculo para linha de outra empresa enquadraria a pessoa na tabela errada.
 */
export async function vincularCargosSolides(input: {
  companyId: string;
  itens: Array<{ solidesCargoId: number; solidesCargoNome: string; linhaId: string | null }>;
}): Promise<DpCargoResult<{ gravados: number }>> {
  try {
    const user = await requireDpEmpresa(input.companyId);
    const admin = createAdminClient();
    if (input.itens.length === 0) return { ok: true, data: { gravados: 0 } };
    if (input.itens.length > 500) throw new Error("Lote grande demais.");

    const linhaIds = Array.from(new Set(input.itens.map((i) => i.linhaId).filter((v): v is string => Boolean(v))));
    if (linhaIds.length > 0) {
      const { data, error } = await admin
        .from("dp_tabela_salarial")
        .select("id")
        .eq("company_id", input.companyId)
        .in("id", linhaIds);
      if (error) throw error;
      if ((data ?? []).length !== linhaIds.length) throw new Error("Linha da tabela não pertence a esta empresa.");
    }

    const remover = input.itens.filter((i) => !i.linhaId).map((i) => i.solidesCargoId);
    if (remover.length > 0) {
      const { error } = await admin
        .from("dp_cargo_vinculos")
        .delete()
        .eq("company_id", input.companyId)
        .in("solides_cargo_id", remover);
      if (error) throw error;
    }
    const agora = new Date().toISOString();
    const gravar = input.itens
      .filter((i) => i.linhaId && Number.isInteger(i.solidesCargoId))
      .map((i) => ({
        company_id: input.companyId,
        solides_cargo_id: i.solidesCargoId,
        solides_cargo_nome: i.solidesCargoNome.trim() || `Cargo ${i.solidesCargoId}`,
        linha_id: i.linhaId as string,
        updated_by: user.id,
        updated_at: agora,
      }));
    if (gravar.length > 0) {
      const { error } = await admin.from("dp_cargo_vinculos").upsert(gravar, { onConflict: "company_id,solides_cargo_id" });
      if (error) throw error;
    }
    revalidar();
    return { ok: true, data: { gravados: gravar.length + remover.length } };
  } catch (error) {
    return falha(error);
  }
}
