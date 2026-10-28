import "server-only";

import {
  CAIXINHAS,
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
import { describeGoogleReadError, fetchSheetOrOfficeValues } from "@/lib/sheets/sheet-or-office";
import { createAdminClient } from "@/lib/supabase/admin";

// Leitura da planilha + do banco para a caixinha (regras em caixinha.ts).
// Tudo com o admin client: a tabela de leituras não tem policy, e um
// solicitante sob RLS não enxerga as requisições dos outros setores — que são
// justamente as que consomem a caixinha (ela é uma só para todos os setores).

// Planilha informada pelo dono do projeto em 28/10/2026 — um .xlsx no Drive,
// lido pela API do Drive (ver sheet-or-office.ts). Override por env sem deploy,
// para o dia em que ela for convertida para planilha do Google (o id muda).
const DEFAULT_SPREADSHEET_ID = "14dUiZ6Zvt6imA6vjL9PKLh3PF0uUimCT";
const ABA = "Control Hub";

function spreadsheetId(): string {
  return process.env.CAIXINHA_PUXADA_SHEET_ID?.trim() || DEFAULT_SPREADSHEET_ID;
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
  const rows = await fetchSheetOrOfficeValues(spreadsheetId(), ABA, range);
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
  const { data, error } = await db
    .from("ctrl_requests")
    .select("amount, status, due_date, created_at")
    .eq("expense_type_id", caixinha.expenseTypeId)
    .is("deleted_at", null)
    .in("status", [...STATUS_CONSUMIDO, ...STATUS_PENDENTE])
    .or(`due_date.gte.${corte},due_date.is.null`);
  if (error) throw new Error(`leitura de ctrl_requests: ${error.message}`);
  return (data ?? []) as RequisicaoDaCaixinha[];
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
      // fica no dia 10 do ciclo de hoje, como se ela estivesse em dia.
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
    erroPlanilha = describeGoogleReadError(err);
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
