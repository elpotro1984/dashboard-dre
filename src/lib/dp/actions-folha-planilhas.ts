"use server";

import { revalidatePath } from "next/cache";
import * as XLSX from "xlsx";

import { DP_PATH } from "@/lib/auth/dp";
import { requireDpEmpresa } from "@/lib/dp/auth";
import { competenciaValida } from "@/lib/dp/folha/parametros";
import {
  CAMPOS_CONFERENCIA,
  CAMPOS_VALORES,
  casarPlanilha,
  conferir,
  lerPlanilhaGenerica,
  planejarValores,
  sugerirMapeamento,
  type DpCampoValor,
  type DpMapeamentoPlanilha,
  type DpPessoaDaFolha,
  type DpPlanilhaLida,
  type DpResultadoConferencia,
} from "@/lib/dp/folha/planilha-generica";
import { folhaFechada, getFolhaEmpresa, type DpFolhaEmpresa } from "@/lib/dp/folha/queries";
import { linhaLancamento, validarLancamento } from "@/lib/dp/folha/validacao";
import { createAdminClient } from "@/lib/supabase/admin";

// Planilhas de FORA na folha: o resumo da CONTABILIDADE (conferência) e
// valores do mês vindos de terceiros (fatura da operadora, comissões). Toda
// action confere a empresa (requireDpEmpresa); o arquivo nunca é guardado — só
// o mapeamento das colunas, por empresa, para o DP apontar uma vez só.

export type DpPlanilhaResult<T> = { ok: true; data: T } | { ok: false; error: string };

type Admin = ReturnType<typeof createAdminClient>;
type TipoLayout = "contabilidade" | "valores";

function falha(error: unknown): { ok: false; error: string } {
  const e = error as { code?: string; message?: string } | null;
  if (e?.code === "PGRST205" || e?.code === "42P01") {
    return { ok: false, error: "Folha ainda não instalada no banco (migration 20261019130000)." };
  }
  return { ok: false, error: e?.message || "Erro inesperado." };
}

async function lerArquivo(form: FormData): Promise<DpPlanilhaLida> {
  const file = form.get("file");
  if (!(file instanceof File)) throw new Error("Envie a planilha (.xlsx, .xls ou .csv).");
  if (file.size > 15 * 1024 * 1024) throw new Error("Planilha maior que 15 MB.");
  let wb: XLSX.WorkBook;
  try {
    wb = XLSX.read(await file.arrayBuffer(), { type: "array", cellDates: true });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "";
    if (/password|encrypt/i.test(msg)) throw new Error("A planilha está protegida por senha — tire a senha no Excel e envie de novo.");
    throw new Error("Não consegui ler o arquivo. É .xlsx, .xls ou .csv? (PDF não é lido.)");
  }
  // A aba com mais linhas preenchidas: relatório às vezes traz capa na 1ª.
  const nomes = wb.SheetNames.slice().sort(
    (a, b) => (wb.Sheets[b]?.["!ref"] ? XLSX.utils.decode_range(wb.Sheets[b]["!ref"]!).e.r : 0) - (wb.Sheets[a]?.["!ref"] ? XLSX.utils.decode_range(wb.Sheets[a]["!ref"]!).e.r : 0),
  );
  const matriz = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[nomes[0]], { header: 1, defval: "" });
  const lida = lerPlanilhaGenerica(matriz);
  if ("erro" in lida) throw new Error(lida.erro);
  return lida;
}

async function layoutSalvo(admin: Admin, companyId: string, tipo: TipoLayout): Promise<Record<string, unknown> | null> {
  const { data } = await admin.from("dp_folha_layouts").select("mapeamento").eq("company_id", companyId).eq("tipo", tipo).maybeSingle();
  return (data?.mapeamento as Record<string, unknown> | undefined) ?? null;
}

async function salvarLayout(admin: Admin, companyId: string, tipo: TipoLayout, mapeamento: unknown, userId: string) {
  const { error } = await admin
    .from("dp_folha_layouts")
    .upsert({ company_id: companyId, tipo, mapeamento, updated_by: userId, updated_at: new Date().toISOString() }, { onConflict: "company_id,tipo" });
  if (error) console.error("[dp] salvar layout:", error.message);
}

/** Pessoas da folha com o CPF — lido aqui, no servidor (o CPF não vai para a tela da folha). */
async function pessoasComCpf(admin: Admin, folha: DpFolhaEmpresa): Promise<DpPessoaDaFolha[]> {
  const ids = folha.pessoas.filter((p) => p.solidesId > 0).map((p) => p.solidesId);
  const { data } = ids.length ? await admin.from("dp_colaboradores").select("solides_id, cpf").in("solides_id", ids) : { data: [] };
  const cpf = new Map((data ?? []).map((r) => [Number(r.solides_id), (r.cpf as string | null) ?? null]));
  return folha.pessoas.map((p) => ({ solidesId: p.solidesId, nome: p.nome, cpf: p.avulso ? p.avulso.cpf : cpf.get(p.solidesId) ?? null }));
}

function exigirCompetencia(c: string) {
  if (!competenciaValida(c)) throw new Error("Competência inválida.");
}

function lerMapeamento(form: FormData): Record<string, unknown> {
  try {
    const m = JSON.parse(String(form.get("mapeamento") ?? "{}"));
    return m && typeof m === "object" ? m : {};
  } catch {
    throw new Error("Mapeamento de colunas inválido.");
  }
}

export interface DpColunasPlanilha {
  cabecalho: string[];
  linhas: number;
  /** O mapeamento guardado para esta empresa (ou a sugestão pelos nomes das colunas). */
  mapeamento: Record<string, unknown>;
  salvo: boolean;
}

/** 1º passo: as colunas da planilha e o mapeamento sugerido. Nada é gravado. */
export async function lerColunasPlanilha(form: FormData): Promise<DpPlanilhaResult<DpColunasPlanilha>> {
  try {
    const companyId = String(form.get("companyId") ?? "");
    await requireDpEmpresa(companyId);
    const tipo = form.get("tipo") === "valores" ? "valores" : "contabilidade";
    const lida = await lerArquivo(form);
    const admin = createAdminClient();
    const salvo = await layoutSalvo(admin, companyId, tipo);
    const sug = sugerirMapeamento(lida.cabecalho);
    return {
      ok: true,
      data: {
        cabecalho: lida.cabecalho,
        linhas: lida.linhas.length,
        mapeamento:
          salvo ??
          (tipo === "contabilidade"
            ? { ...sug }
            : { identificador: sug.identificador, tipoIdentificador: sug.tipoIdentificador }),
        salvo: Boolean(salvo),
      },
    };
  } catch (error) {
    return falha(error);
  }
}

function validarMapeamentoConferencia(m: Record<string, unknown>): DpMapeamentoPlanilha {
  const identificador = String(m.identificador ?? "").trim();
  if (!identificador) throw new Error("Escolha a coluna que identifica a pessoa (CPF ou nome).");
  const campos: DpMapeamentoPlanilha["campos"] = {};
  const entrada = (m.campos && typeof m.campos === "object" ? m.campos : {}) as Record<string, unknown>;
  for (const k of CAMPOS_CONFERENCIA) {
    const col = String(entrada[k] ?? "").trim();
    if (col) campos[k] = col;
  }
  if (Object.keys(campos).length === 0) throw new Error("Aponte pelo menos uma coluna para conferir.");
  return { identificador, tipoIdentificador: m.tipoIdentificador === "cpf" ? "cpf" : "nome", campos };
}

/**
 * CONFERÊNCIA com a folha da contabilidade: casa cada linha do resumo dela com
 * a pessoa da folha daqui e compara campo a campo. Só leitura — guarda apenas o
 * mapeamento das colunas, para o mês seguinte ser um clique.
 */
export async function conferirContabilidade(form: FormData): Promise<DpPlanilhaResult<DpResultadoConferencia>> {
  try {
    const companyId = String(form.get("companyId") ?? "");
    const user = await requireDpEmpresa(companyId);
    const competencia = String(form.get("competencia") ?? "");
    exigirCompetencia(competencia);
    const mapeamento = validarMapeamentoConferencia(lerMapeamento(form));
    const tol = Number(String(form.get("tolerancia") ?? "0.05").replace(",", "."));
    const tolerancia = Number.isFinite(tol) && tol >= 0 && tol <= 1000 ? tol : 0.05;
    const lida = await lerArquivo(form);
    const admin = createAdminClient();
    const folha = await getFolhaEmpresa(admin, companyId, competencia);
    const pessoas = await pessoasComCpf(admin, folha);
    const casamento = casarPlanilha(lida, mapeamento.identificador, mapeamento.tipoIdentificador, Object.values(mapeamento.campos) as string[], pessoas);
    if (casamento.casadas.size === 0) {
      throw new Error(
        mapeamento.tipoIdentificador === "cpf"
          ? "Nenhum CPF da planilha casou com a folha desta empresa. A coluna escolhida é mesmo a do CPF?"
          : "Nenhum nome da planilha casou com a folha desta empresa. A coluna escolhida é mesmo a do nome?",
      );
    }
    await salvarLayout(admin, companyId, "contabilidade", mapeamento, user.id);
    return { ok: true, data: conferir(folha.linhas, casamento, mapeamento, tolerancia) };
  } catch (error) {
    return falha(error);
  }
}

export interface DpValoresPlanilhaResumo {
  campo: DpCampoValor;
  mudancas: Array<{ nome: string; antes: number | null; depois: number }>;
  naoEncontradas: string[];
  ambiguas: string[];
  repetidas: number;
  aplicado: boolean;
}

/**
 * VALORES DO MÊS de uma planilha de fora (fatura da operadora → coparticipação,
 * relatório de vendas → comissão…). Prévia sem `confirmar`; com ele, grava nos
 * lançamentos do mês, preservando os ajustes manuais e o resto de cada pessoa.
 */
export async function lancarValoresPlanilha(form: FormData): Promise<DpPlanilhaResult<DpValoresPlanilhaResumo>> {
  try {
    const companyId = String(form.get("companyId") ?? "");
    const user = await requireDpEmpresa(companyId);
    const competencia = String(form.get("competencia") ?? "");
    exigirCompetencia(competencia);
    const m = lerMapeamento(form);
    const identificador = String(m.identificador ?? "").trim();
    const coluna = String(m.coluna ?? "").trim();
    const campo = String(m.campo ?? "") as DpCampoValor;
    const modo = m.modo === "somar" ? "somar" : "substituir";
    if (!identificador) throw new Error("Escolha a coluna que identifica a pessoa (CPF ou nome).");
    if (!coluna) throw new Error("Escolha a coluna do valor.");
    if (!(CAMPOS_VALORES as readonly string[]).includes(campo)) throw new Error("Escolha em que campo da folha o valor entra.");
    const tipoIdentificador = m.tipoIdentificador === "cpf" ? "cpf" : "nome";
    const confirmar = form.get("confirmar") === "1";

    const lida = await lerArquivo(form);
    const admin = createAdminClient();
    if (await folhaFechada(admin, companyId, competencia)) throw new Error("A folha deste mês está fechada — reabra antes de lançar valores.");
    const folha = await getFolhaEmpresa(admin, companyId, competencia);
    const pessoas = await pessoasComCpf(admin, folha);
    const casamento = casarPlanilha(lida, identificador, tipoIdentificador, [coluna], pessoas);
    const porId = new Map(folha.pessoas.map((p) => [p.solidesId, p]));
    const mudancas = planejarValores(casamento, coluna, campo, modo, new Map(folha.pessoas.map((p) => [p.solidesId, p.lancamento])));
    const resumo: DpValoresPlanilhaResumo = {
      campo,
      mudancas: mudancas.map((x) => ({ nome: porId.get(x.solidesId)?.nome ?? String(x.solidesId), antes: x.antes, depois: x.depois })),
      naoEncontradas: casamento.naoEncontradas,
      ambiguas: casamento.ambiguas,
      repetidas: casamento.repetidas,
      aplicado: false,
    };
    if (confirmar && mudancas.length) {
      const agora = new Date().toISOString();
      const linhas = mudancas.map((x) => {
        const p = porId.get(x.solidesId)!;
        const l = validarLancamento({ ...p.lancamento, [campo]: x.depois });
        return {
          competencia,
          solides_id: x.solidesId,
          ...linhaLancamento(l),
          observacao: p.observacaoMes,
          updated_by: user.id,
          updated_at: agora,
        };
      });
      const { error } = await admin.from("dp_folha_lancamentos").upsert(linhas, { onConflict: "competencia,solides_id" });
      if (error) throw error;
      resumo.aplicado = true;
      revalidatePath(DP_PATH, "layout");
    }
    await salvarLayout(admin, companyId, "valores", { identificador, tipoIdentificador, coluna, campo, modo }, user.id);
    return { ok: true, data: resumo };
  } catch (error) {
    return falha(error);
  }
}
