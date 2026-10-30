"use server";

import { revalidatePath } from "next/cache";

import { createClient } from "@/lib/supabase/server";
import { createAdminClientIfAvailable } from "@/lib/supabase/admin";
import { autorizarLeitura, getOrcamentoAdmin, SEM_ACESSO_ADMIN } from "@/lib/orcamento/auth";
import { isValidBudgetYear } from "@/lib/orcamento/years";
import { isSchemaMissing } from "@/lib/orcamento/errors";
import { reprocessBudgetEntriesForCompany } from "@/lib/budget/reprocess";
import {
  getPreviaOrcamento,
  type PreviaDreLinha,
} from "@/lib/orcamento/actions/previa-orcamento";
import { rotuloDaConta } from "@/lib/orcamento/previa-budget-labels";
import { SETOR_TODOS } from "@/lib/orcamento/setor-filtro";
import { orcaPorSetor } from "@/lib/orcamento/setor-gravacao";
import { entraNoNumero } from "@/lib/orcamento/validacao-diretoria";
import { registrarAlteracao } from "@/lib/orcamento/actions/trilha";
import {
  TRAVA_FINALIZADO,
  chaveFinalizacao,
  isMetodoFinalizavel,
  sourceFinalizacao,
  type AlvoFinalizacao,
  type Finalizacao,
} from "@/lib/orcamento/finalizacao";
import type { OrcamentoMetodo } from "@/lib/orcamento/metodos";

/**
 * FINALIZAR ORÇAMENTO — o fecho por (método × categoria × setor).
 *
 * Um clique do administrador faz duas coisas ao mesmo tempo, e é essa soma que
 * dá sentido ao botão: trava a fatia para TODO MUNDO (inclusive para ele) e
 * manda ao Budget do Financeiro o que a diretoria aprovou naquela fatia.
 *
 * ── Por que a publicação é por FATIA, e não a empresa inteira ──────────────
 * O publicador antigo apagava tudo do módulo e republicava — o que apagaria as
 * finalizações anteriores a cada clique. Aqui cada fatia tem uma `source`
 * determinística própria em `budget_uploads_raw`, e o `reprocess` do Financeiro
 * SOMA todas as sources. É isso que faz "cada finalização ir preenchendo" o
 * orçamento em vez de substituí-lo.
 *
 * ── Por que não grava `budget_entries` direto ──────────────────────────────
 * Mesma razão do publicador antigo: `reprocessBudgetEntriesForCompany` apaga e
 * reconstrói `budget_entries` do ano a partir de `budget_uploads_raw`. Escrita
 * direta seria destruída no próximo upload de planilha, em silêncio.
 */

const PATH = "/orcamento";

function db() {
  return createAdminClientIfAvailable();
}

function normalizarAlvo(alvo: AlvoFinalizacao): AlvoFinalizacao | null {
  if (!isMetodoFinalizavel(alvo.metodo)) return null;
  return {
    metodo: alvo.metodo,
    // O pessoal usa categoria vazia (a fatia é o quadro do setor inteiro).
    categoryCode: alvo.metodo === "pessoal" ? "" : (alvo.categoryCode ?? "").trim(),
    setorId: alvo.setorId ?? null,
  };
}

function lerLinha(r: Record<string, unknown>): Finalizacao {
  return {
    id: r.id as string,
    metodo: r.metodo as OrcamentoMetodo,
    categoryCode: (r.category_code as string) ?? "",
    setorId: (r.setor_id as string | null) ?? null,
    totalPublicado: Number(r.total_publicado ?? 0),
    itensPublicados: Number(r.itens_publicados ?? 0),
    itensFora: Number(r.itens_fora ?? 0),
    finalizadoEm: (r.finalizado_em as string) ?? "",
  };
}

/**
 * As fatias fechadas da empresa/ano.
 *
 * Leitura para QUALQUER usuário do módulo que alcance a empresa — o gestor
 * precisa ver que a fatia está fechada, senão ele digita e leva a recusa só ao
 * salvar. Quem FECHA é só o admin.
 *
 * Tabela ausente devolve lista vazia: a validação e a finalização não podem ser
 * o motivo de uma tela de construção parar de carregar.
 */
export async function getFinalizacoes(
  companyId: string,
  year: number,
): Promise<{ items: Finalizacao[]; error?: string }> {
  if (!companyId || !isValidBudgetYear(year)) return { items: [] };

  const supabase = db() ?? (await createClient());
  const auth = await autorizarLeitura(supabase, companyId, year);
  if (!auth.ok) return { items: [], error: auth.error };

  const { data, error } = await supabase
    .from("orcamento_finalizacoes")
    .select("id, metodo, category_code, setor_id, total_publicado, itens_publicados, itens_fora, finalizado_em")
    .eq("company_id", companyId)
    .eq("year", year);
  if (error) {
    if (isSchemaMissing(error.message)) return { items: [] };
    return { items: [], error: error.message };
  }
  return { items: ((data ?? []) as Array<Record<string, unknown>>).map(lerLinha) };
}

interface FatiaCalculada {
  /** conta da DRE → 12 meses aprovados. */
  porConta: Map<string, { code: string; name: string; meses: number[] }>;
  /** Abertura para o drilldown: conta × mês × nome da despesa. */
  detalhe: Array<{ dre_account_id: string; month: number; nome: string; valor: number }>;
  itensPublicados: number;
  itensFora: number;
  totalPublicado: number;
  /** Havia algo orçado na fatia, aprovado ou não? Distingue os dois erros. */
  havia: boolean;
}

/**
 * Monta a fatia a partir da MESMA Prévia que a tela mostra.
 *
 * Recorta pelos ITENS (cada um sabe o seu setor e o seu estado), e não pelo
 * `mesesAprovados` da fonte: aquele já vem somado de todos os setores do
 * escopo, e usá-lo publicaria o orçamento dos colegas junto.
 */
function montarFatia(
  linhas: readonly PreviaDreLinha[],
  alvo: AlvoFinalizacao,
  /**
   * A empresa orça por setor? Sem setor, a categoria é UMA fatia só e o setor
   * gravado no item não decide nada: Média, Valor fixo, Planejamento e Viagens
   * gravam no balde "Não atribuído", o Pessoal grava nulo, e cada tela passa
   * ao Finalizar o setor que ela tem (nulo ou o balde). Comparar os dois
   * deixava a fatia "vazia" com contratos dentro — e com a finalização de
   * categoria vazia (30/10/2026), oferecia fechá-la com R$ 0.
   */
  porSetor: boolean,
): FatiaCalculada {
  const porConta = new Map<string, { code: string; name: string; meses: number[] }>();
  const detalhe: FatiaCalculada["detalhe"] = [];
  let itensPublicados = 0;
  let itensFora = 0;
  let totalPublicado = 0;
  let havia = false;

  for (const linha of linhas ?? []) {
    // SÓ AS FOLHAS: as linhas-resumo acumulam as fontes dos filhos, e varrer
    // todas contaria a mesma despesa na folha, no pai e no avô.
    if (linha.hasChildren || linha.isCalculado) continue;
    for (const fonte of linha.fontes) {
      if (fonte.metodo !== alvo.metodo) continue;
      if (fonte.categoryCode !== alvo.categoryCode) continue;
      for (const item of fonte.itens) {
        if (porSetor && (item.setorId ?? null) !== alvo.setorId) continue;
        havia = true;
        // A Prévia já decidiu se o item entra (`noAprovado`, com a chave de
        // aprovação do diretor da empresa); o estado é só a reserva.
        const entra = item.noAprovado ?? entraNoNumero(item.estado ?? "pendente");
        if (!entra) {
          itensFora += 1;
          continue;
        }
        itensPublicados += 1;
        const meses = item.meses ?? [];
        let alvoConta = porConta.get(linha.id);
        if (!alvoConta) {
          alvoConta = { code: linha.code, name: linha.name, meses: Array<number>(12).fill(0) };
          porConta.set(linha.id, alvoConta);
        }
        for (let m = 0; m < 12; m += 1) {
          const v = Number(meses[m] ?? 0);
          if (!Number.isFinite(v) || v === 0) continue;
          alvoConta.meses[m] += v;
          totalPublicado += v;
          detalhe.push({ dre_account_id: linha.id, month: m + 1, nome: item.nome, valor: v });
        }
      }
    }
  }

  return { porConta, detalhe, itensPublicados, itensFora, totalPublicado, havia };
}

export interface FinalizacaoResultado {
  totalPublicado: number;
  itensPublicados: number;
  itensFora: number;
  contas: number;
  linhasGravadas: number;
}

export async function finalizarFatia(params: {
  companyId: string;
  year: number;
  metodo: string;
  categoryCode?: string;
  setorId?: string | null;
  /** Só para a trilha: como a fatia se chama na tela. */
  rotulo?: string;
  /**
   * Fechar a fatia mesmo SEM nada orçado — a categoria fica com R$ 0 no ano e
   * travada. Só depois de o usuário confirmar na tela (ver `vazio` no retorno).
   */
  permitirVazio?: boolean;
}): Promise<{
  ok?: true;
  data?: FinalizacaoResultado;
  error?: string;
  needsMigration?: boolean;
  /** Recusado só por estar vazia: a tela pergunta e reenvia com `permitirVazio`. */
  vazio?: true;
}> {
  const admin = await getOrcamentoAdmin();
  if (!admin) return { error: SEM_ACESSO_ADMIN };
  const { companyId, year } = params;
  if (!companyId) return { error: "Selecione uma empresa." };
  if (!isValidBudgetYear(year)) return { error: "Ano do orçamento inválido." };

  const alvo = normalizarAlvo({
    metodo: params.metodo as OrcamentoMetodo,
    categoryCode: params.categoryCode ?? "",
    setorId: params.setorId ?? null,
  });
  if (!alvo) return { error: "Método inválido para finalização." };

  const supabase = db() ?? (await createClient());
  const porSetor = await orcaPorSetor(supabase, companyId, year);

  // Sem setor, a categoria é UMA fatia — mas a tela pode chamá-la pelo setor
  // nulo ou pelo balde, conforme a linha. Duas finalizações da mesma categoria
  // (uma em cada chave) publicariam em duas `source` e o Budget SOMARIA as duas.
  // Aconteceu em 30/10/2026 na Salvaterra Mall (zeradas, por sorte).
  if (!porSetor) {
    const { data: outra } = await supabase
      .from("orcamento_finalizacoes")
      .select("id")
      .eq("company_id", companyId)
      .eq("year", year)
      .eq("metodo", alvo.metodo)
      .eq("category_code", alvo.categoryCode)
      .limit(1);
    if ((outra ?? []).length > 0) {
      return { error: "Esta categoria já está finalizada. Reabra-a antes de finalizar de novo." };
    }
  }

  // A Prévia do escopo INTEIRO: o recorte por setor é feito item a item logo
  // abaixo, e pedi-la já filtrada esconderia o setor nulo em empresa que orça
  // por setor (são consultas diferentes, não um subconjunto).
  const previa = await getPreviaOrcamento(companyId, year, SETOR_TODOS);
  if (previa.needsMigration) return { needsMigration: true };
  if (previa.error || !previa.data) {
    return { error: previa.error ?? "Não consegui calcular a prévia para publicar." };
  }

  const fatia = montarFatia(previa.data.linhas, alvo, porSetor);
  // VAZIA: nada orçado (a média sem realizado, a categoria sem despesa). Fechar
  // assim é legítimo — é dizer "esta categoria fica com zero no ano" e travá-la
  // (pedido do dono do projeto em 30/10/2026: sem isto a categoria vazia nunca
  // fechava e o método nunca chegava a 100%). Mas só com confirmação: a mesma
  // recusa também aparece quando a tela aponta para o setor errado, e aí fechar
  // calado esconderia o defeito. Nada vai ao Budget; os deletes por `source`
  // abaixo só limpam o que uma finalização anterior tenha deixado.
  if (!fatia.havia) {
    if (!params.permitirVazio) {
      return { error: "Não há nada orçado nesta categoria para este setor.", vazio: true };
    }
  } else if (fatia.itensPublicados === 0) {
    return {
      error: previa.data.resumo.aprovacaoDiretor
        ? "Nada foi aprovado pela diretoria nesta categoria — só o aprovado vai para o Budget. " +
          "Aprove os itens (na linha de cada um) antes de finalizar."
        : // Sem diretor o pendente entra: zero publicado só acontece com tudo
          // reprovado ou devolvido para revisão.
          "Todos os itens desta categoria estão reprovados ou em revisão — nada vai para o Budget. " +
          "Ajuste os itens antes de finalizar.",
    };
  }

  const source = sourceFinalizacao(alvo);

  // Refinalizar sobrescreve a PRÓPRIA fatia: apaga por source, nunca por
  // empresa/ano. Apagar mais do que isto derrubaria as outras finalizações.
  const { error: delRaw } = await supabase
    .from("budget_uploads_raw")
    .delete()
    .eq("company_id", companyId)
    .eq("year", year)
    .eq("source", source);
  if (delRaw) {
    if (isSchemaMissing(delRaw.message)) return { needsMigration: true };
    return { error: delRaw.message };
  }
  await supabase
    .from("orcamento_budget_detalhe")
    .delete()
    .eq("company_id", companyId)
    .eq("year", year)
    .eq("source", source);

  const rows: Array<Record<string, unknown>> = [];
  const mapeamentos: Array<{ company_id: string; label: string; dre_account_id: string }> = [];
  for (const [accountId, conta] of Array.from(fatia.porConta.entries())) {
    const label = rotuloDaConta(conta.code, conta.name);
    mapeamentos.push({ company_id: companyId, label, dre_account_id: accountId });
    conta.meses.forEach((valor: number, i: number) => {
      const amount = Math.round(valor * 100) / 100;
      if (amount === 0) return;
      rows.push({ company_id: companyId, year, month: i + 1, label, amount, source });
    });
  }

  const LOTE = 400;
  for (let i = 0; i < rows.length; i += LOTE) {
    const { error } = await supabase
      .from("budget_uploads_raw")
      .upsert(rows.slice(i, i + LOTE), { onConflict: "company_id,year,month,label,source" });
    if (error) return { error: error.message };
  }

  // O rótulo já nasce ligado à conta que a Prévia resolveu — upsert porque a
  // conta da categoria pode ter mudado no Mapeamento do Financeiro.
  if (mapeamentos.length > 0) {
    const { error } = await supabase
      .from("budget_account_mappings")
      .upsert(mapeamentos, { onConflict: "company_id,label" });
    if (error) return { error: error.message };
  }

  // Abertura do drilldown. Fora de qualquer número do Financeiro — só leitura.
  const detalheRows = fatia.detalhe.map((d) => ({ company_id: companyId, year, source, ...d }));
  for (let i = 0; i < detalheRows.length; i += LOTE) {
    const { error } = await supabase
      .from("orcamento_budget_detalhe")
      .insert(detalheRows.slice(i, i + LOTE));
    if (error) {
      if (isSchemaMissing(error.message)) return { needsMigration: true };
      return { error: error.message };
    }
  }

  // A TRAVA. INSERT e não upsert: o índice é por expressão (setor nulo é
  // legítimo) e `ignoreDuplicates` não funciona sobre ele — 23505 aqui só pode
  // ser outra pessoa finalizando a mesma fatia no mesmo instante.
  const { error: insErr } = await supabase.from("orcamento_finalizacoes").insert({
    company_id: companyId,
    year,
    metodo: alvo.metodo,
    category_code: alvo.categoryCode,
    setor_id: alvo.setorId,
    total_publicado: Math.round(fatia.totalPublicado * 100) / 100,
    itens_publicados: fatia.itensPublicados,
    itens_fora: fatia.itensFora,
    finalizado_por: admin.userId,
  });
  if (insErr) {
    if (isSchemaMissing(insErr.message)) return { needsMigration: true };
    if (/duplicate key|unique/i.test(insErr.message)) {
      return { error: "Esta categoria acabou de ser finalizada por outra pessoa." };
    }
    return { error: insErr.message };
  }

  await reprocessBudgetEntriesForCompany(supabase, companyId, { years: [year] });

  await registrarAlteracao({
    companyId,
    year,
    setorId: alvo.setorId,
    metodo: alvo.metodo,
    alvoTipo: "finalizacao",
    alvoId: source,
    alvoRotulo: params.rotulo || alvo.categoryCode || alvo.metodo,
    acao: "finalizou",
    antes: null,
    depois: {
      total: fatia.totalPublicado,
      itens: fatia.itensPublicados,
      fora: fatia.itensFora,
    },
    autorId: admin.userId,
    autorPapel: "admin",
  });

  revalidatePath(PATH);
  return {
    ok: true,
    data: {
      totalPublicado: fatia.totalPublicado,
      itensPublicados: fatia.itensPublicados,
      itensFora: fatia.itensFora,
      contas: fatia.porConta.size,
      linhasGravadas: rows.length,
    },
  };
}

export async function reabrirFatia(params: {
  companyId: string;
  year: number;
  metodo: string;
  categoryCode?: string;
  setorId?: string | null;
  rotulo?: string;
}): Promise<{ ok?: true; error?: string }> {
  const admin = await getOrcamentoAdmin();
  if (!admin) return { error: SEM_ACESSO_ADMIN };
  const { companyId, year } = params;
  if (!companyId) return { error: "Selecione uma empresa." };
  if (!isValidBudgetYear(year)) return { error: "Ano do orçamento inválido." };

  const alvo = normalizarAlvo({
    metodo: params.metodo as OrcamentoMetodo,
    categoryCode: params.categoryCode ?? "",
    setorId: params.setorId ?? null,
  });
  if (!alvo) return { error: "Método inválido." };

  const supabase = db() ?? (await createClient());
  const source = sourceFinalizacao(alvo);

  // Sem setor a categoria é UMA fatia, mas pode estar gravada no setor nulo ou
  // no balde (a tela chama pela chave da linha). Reabrir desfaz as duas — senão
  // a que a tela não enxerga continuaria travando e publicando.
  const alvos: AlvoFinalizacao[] = [alvo];
  if (!(await orcaPorSetor(supabase, companyId, year))) {
    const { data: outras } = await supabase
      .from("orcamento_finalizacoes")
      .select("setor_id")
      .eq("company_id", companyId)
      .eq("year", year)
      .eq("metodo", alvo.metodo)
      .eq("category_code", alvo.categoryCode);
    for (const r of (outras ?? []) as { setor_id: string | null }[]) {
      const s = r.setor_id ?? null;
      if (!alvos.some((a) => a.setorId === s)) alvos.push({ ...alvo, setorId: s });
    }
  }

  // A ORDEM importa: primeiro solta a trava, depois desfaz a publicação. Se o
  // processo morresse no meio da ordem inversa, a fatia ficaria travada com o
  // Budget já limpo — e o admin não teria como reabrir o que já está aberto.
  for (const a of alvos) {
    const { error: delFim } = await supabase
      .from("orcamento_finalizacoes")
      .delete()
      .eq("company_id", companyId)
      .eq("year", year)
      .eq("metodo", a.metodo)
      .eq("category_code", a.categoryCode)
      .filter("setor_id", a.setorId ? "eq" : "is", a.setorId ?? null);
    if (delFim) {
      if (isSchemaMissing(delFim.message)) return { error: "Finalização não encontrada." };
      return { error: delFim.message };
    }
  }

  for (const a of alvos) {
    const src = sourceFinalizacao(a);
    const { error: delRaw } = await supabase
      .from("budget_uploads_raw")
      .delete()
      .eq("company_id", companyId)
      .eq("year", year)
      .eq("source", src);
    if (delRaw) return { error: delRaw.message };

    await supabase
      .from("orcamento_budget_detalhe")
      .delete()
      .eq("company_id", companyId)
      .eq("year", year)
      .eq("source", src);
  }

  await reprocessBudgetEntriesForCompany(supabase, companyId, { years: [year] });

  await registrarAlteracao({
    companyId,
    year,
    setorId: alvo.setorId,
    metodo: alvo.metodo,
    alvoTipo: "finalizacao",
    alvoId: source,
    alvoRotulo: params.rotulo || alvo.categoryCode || alvo.metodo,
    acao: "reabriu",
    antes: null,
    depois: null,
    autorId: admin.userId,
    autorPapel: "admin",
  });

  revalidatePath(PATH);
  return { ok: true };
}

/**
 * A fatia desta escrita está finalizada? Devolve a recusa ou `null`.
 *
 * Chamada pelas actions de escrita dos quatro métodos, no mesmo lugar em que já
 * mora `travaDaValidacao` — e com uma diferença deliberada: aqui **admin e
 * diretoria NÃO passam**. Finalizar é um fecho, não uma alçada; quem precisa
 * mexer reabre antes, e aí o fecho fica visível na tela em vez de ser
 * contornado em silêncio.
 *
 * Tabela ausente (migration pendente) não trava nada: a finalização não pode
 * ser o motivo de o módulo parar de aceitar escrita.
 */
export async function travaDeFinalizacao(params: {
  companyId: string;
  year: number;
  metodo: string;
  categoryCode?: string;
  setorId?: string | null;
}): Promise<string | null> {
  const alvo = normalizarAlvo({
    metodo: params.metodo as OrcamentoMetodo,
    categoryCode: params.categoryCode ?? "",
    setorId: params.setorId ?? null,
  });
  if (!alvo || !params.companyId || !isValidBudgetYear(params.year)) return null;

  const supabase = db() ?? (await createClient());
  let q = supabase
    .from("orcamento_finalizacoes")
    .select("id")
    .eq("company_id", params.companyId)
    .eq("year", params.year)
    .eq("metodo", alvo.metodo)
    .eq("category_code", alvo.categoryCode);
  // Sem setor a categoria é uma fatia só, gravada no nulo OU no balde: a trava
  // vale com qualquer das duas — senão a escrita que chega pela outra chave
  // passaria por cima de uma categoria fechada.
  if (await orcaPorSetor(supabase, params.companyId, params.year)) {
    // `.eq(col, null)` vira `eq.null` no PostgREST e não casa com nada.
    q = alvo.setorId ? q.eq("setor_id", alvo.setorId) : q.is("setor_id", null);
  }

  const { data, error } = await q.limit(1);
  if (error || !data || data.length === 0) return null;
  return TRAVA_FINALIZADO;
}

/**
 * As chaves das fatias fechadas, para uma operação em LOTE saber o que pular.
 *
 * `recalcularTodasMedias` varre a empresa inteira: sem isto ela derrubaria a
 * operação por causa de uma categoria fechada, ou — pior — recalcularia por
 * cima do que já foi publicado. Com isto ela recalcula o resto e reporta
 * quantas pulou.
 */
export async function chavesFinalizadas(companyId: string, year: number): Promise<string[]> {
  if (!companyId || !isValidBudgetYear(year)) return [];
  const supabase = db() ?? (await createClient());
  const { data, error } = await supabase
    .from("orcamento_finalizacoes")
    .select("metodo, category_code, setor_id")
    .eq("company_id", companyId)
    .eq("year", year);
  if (error || !data) return [];
  return (data as Array<Record<string, unknown>>).map((r) =>
    chaveFinalizacao({
      metodo: r.metodo as OrcamentoMetodo,
      categoryCode: (r.category_code as string) ?? "",
      setorId: (r.setor_id as string | null) ?? null,
    }),
  );
}
