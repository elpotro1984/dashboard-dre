import "server-only";

import {
  CAIXINHAS,
  SETORES_DA_CAIXINHA,
  STATUS_CONSUMIDO,
  STATUS_PENDENTE,
  inicioDoCiclo,
  montarSaldo,
  novaLeitura,
  planilhaAtrasada,
  rangeQueCobre,
  somarConsumo,
  valorDaCelula,
  type CaixinhaConfig,
  type LeituraGravada,
  type RequisicaoDaCaixinha,
  type SaldoCaixinha,
} from "@/lib/ctrl/caixinha";
import { dayKeyBR, todayBR } from "@/lib/ctrl/datetime";
import { fetchSheetValues } from "@/lib/sheets/client";
import { createAdminClient } from "@/lib/supabase/admin";

// Leitura da planilha + do banco para a caixinha (regras em caixinha.ts).
// Tudo com o admin client: a tabela de leituras não tem policy, e um
// solicitante sob RLS não enxerga as requisições dos outros setores — que são
// justamente as que consomem a caixinha (uma só para os setores da lista).

// Planilha do Google informada pelo dono do projeto em 28/10/2026. A primeira
// era um .xlsx guardado no Drive, que a API do Sheets recusa ("must not be an
// Office file") — foi convertida para planilha nativa, e por isso o id mudou.
// Override por env sem deploy (mesmo padrão da Sirena).
const DEFAULT_SPREADSHEET_ID = "1xVHtuP3imV8KQnOKppqd4DgjIWGmqW6_Y_v7avFtLPs";
const ABA = "Control Hub";

function spreadsheetId(): string {
  return process.env.CAIXINHA_PUXADA_SHEET_ID?.trim() || DEFAULT_SPREADSHEET_ID;
}

/** Falha de leitura em português, para a tela; o erro técnico vai ao log. */
function motivoDaFalha(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err);
  if (/must not be an Office file/i.test(msg)) {
    return "a planilha é um arquivo Excel; converta para planilha do Google";
  }
  if (/\b(403|404)\b/.test(msg)) {
    return "a planilha não está compartilhada com a conta de serviço do Control Hub";
  }
  if (/Unable to parse range/i.test(msg)) return `a aba "${ABA}" não foi encontrada`;
  if (/vazia ou sem número/.test(msg)) return "a célula do saldo está vazia ou sem número";
  if (/GOOGLE_SHEETS_SERVICE_ACCOUNT_JSON/.test(msg)) return "a conta de serviço do Google não está configurada";
  return "o Google não respondeu";
}

type Db = ReturnType<typeof createAdminClient>;

function tabelaAusente(error: { code?: string; message?: string } | null): boolean {
  return (
    error?.code === "42P01" ||
    error?.code === "PGRST205" ||
    /ctrl_caixinha_leituras/.test(error?.message ?? "")
  );
}

async function ultimaLeitura(
  db: Db,
  chave: string,
): Promise<{ leitura: LeituraGravada | null; tabelaOk: boolean }> {
  const { data, error } = await db
    .from("ctrl_caixinha_leituras")
    .select("valor, corte, lido_em")
    .eq("caixinha", chave)
    .order("lido_em", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) {
    if (tabelaAusente(error)) {
      console.error("[caixinha] tabela ctrl_caixinha_leituras ausente — migration 20261028120000 pendente");
      return { leitura: null, tabelaOk: false };
    }
    throw new Error(`leitura de ctrl_caixinha_leituras: ${error.message}`);
  }
  if (!data) return { leitura: null, tabelaOk: true };
  return {
    leitura: {
      valor: Number(data.valor),
      corte: String(data.corte),
      lidoEm: dayKeyBR(data.lido_em as string),
    },
    tabelaOk: true,
  };
}

async function lerPlanilha(caixinha: CaixinhaConfig): Promise<number> {
  const range = rangeQueCobre(CAIXINHAS.map((c) => c.celula));
  const rows = await fetchSheetValues(spreadsheetId(), `'${ABA}'!${range}`);
  const valor = valorDaCelula(rows, caixinha.celula);
  if (valor === null) {
    throw new Error(`Célula ${caixinha.celula} da aba "${ABA}" vazia ou sem número`);
  }
  return valor;
}

async function requisicoesDesde(db: Db, caixinha: CaixinhaConfig, corte: string): Promise<RequisicaoDaCaixinha[]> {
  // Sem vencimento, quem decide é a criação — por isso o filtro do banco é
  // largo (vence a partir do corte OU sem vencimento) e somarConsumo fecha a
  // conta com a data de criação em Brasília.
  const setores = SETORES_DA_CAIXINHA.map((s) => s.id);
  const status = [...STATUS_CONSUMIDO, ...STATUS_PENDENTE];

  const { data, error } = await db
    .from("ctrl_requests")
    .select("amount, status, due_date, created_at, sector_id")
    .eq("expense_type_id", caixinha.expenseTypeId)
    .eq("is_rateio", false)
    .in("sector_id", setores)
    .is("deleted_at", null)
    .in("status", status)
    .or(`due_date.gte.${corte},due_date.is.null`);
  if (error) throw new Error(`leitura de ctrl_requests: ${error.message}`);

  // Rateio: o `sector_id` da requisição é só o 1º setor, e o `amount` é o total.
  // O que sai da caixinha é a PARCELA de cada setor da lista — a mesma leitura
  // da verificação de orçamento (performBudgetVerification).
  const { data: partes, error: erroPartes } = await db
    .from("ctrl_request_sectors")
    .select("amount, sector_id, ctrl_requests!inner(status, due_date, created_at, expense_type_id, deleted_at)")
    .in("sector_id", setores)
    .eq("ctrl_requests.expense_type_id", caixinha.expenseTypeId)
    .is("ctrl_requests.deleted_at", null)
    .in("ctrl_requests.status", status);
  if (erroPartes) throw new Error(`leitura de ctrl_request_sectors: ${erroPartes.message}`);

  const doRateio = (partes ?? []).flatMap((p) => {
    const embed = (p as { ctrl_requests: unknown }).ctrl_requests;
    const mae = (Array.isArray(embed) ? embed[0] : embed) as
      | { status: string; due_date: string | null; created_at: string }
      | null;
    if (!mae) return [];
    return [{ amount: p.amount, sector_id: p.sector_id, status: mae.status, due_date: mae.due_date, created_at: mae.created_at }];
  });

  return [...((data ?? []) as RequisicaoDaCaixinha[]), ...(doRateio as RequisicaoDaCaixinha[])];
}

export async function lerSaldoCaixinha(caixinha: CaixinhaConfig, userId: string): Promise<SaldoCaixinha> {
  const db = createAdminClient();
  const hoje = todayBR();
  const { leitura: ultima, tabelaOk } = await ultimaLeitura(db, caixinha.chave);

  let saldoPlanilha: number | null = null;
  let vigente: LeituraGravada | null = null;
  let origem: SaldoCaixinha["origem"] = null;
  let erroPlanilha: string | null = null;

  try {
    const valor = await lerPlanilha(caixinha);
    saldoPlanilha = valor;
    origem = "agora";
    if (!tabelaOk) {
      // Sem histórico não há como saber se a planilha está atrasada: o corte
      // fica no dia 1º do mês de hoje, como se ela estivesse em dia.
      vigente = { valor, corte: inicioDoCiclo(hoje), lidoEm: hoje };
    } else {
      const nova = novaLeitura(ultima, valor, hoje);
      if (nova) {
        const { error } = await db.from("ctrl_caixinha_leituras").insert({
          caixinha: caixinha.chave,
          valor: nova.valor,
          corte: nova.corte,
          lido_por: userId,
        });
        // A gravação é o histórico, não o número: falhar aqui não impede de
        // mostrar o saldo (a próxima leitura tenta gravar de novo).
        if (error) console.error("[caixinha] falha ao gravar leitura:", error.message);
        vigente = { ...nova, lidoEm: hoje };
      } else {
        vigente = ultima;
      }
    }
  } catch (err) {
    console.error(`[caixinha] falha ao ler a planilha (${caixinha.chave}):`, err instanceof Error ? err.message : err);
    erroPlanilha = motivoDaFalha(err);
    if (ultima) {
      saldoPlanilha = ultima.valor;
      vigente = ultima;
      origem = "anterior";
    }
  }

  const corte = vigente?.corte ?? inicioDoCiclo(hoje);
  const consumo = somarConsumo(await requisicoesDesde(db, caixinha, corte), corte);

  return montarSaldo({
    caixinha,
    saldoPlanilha,
    corte,
    origem,
    lidoEm: vigente?.lidoEm ?? null,
    atrasada: vigente ? planilhaAtrasada(vigente, hoje) : false,
    erroPlanilha,
    consumo,
  });
}
