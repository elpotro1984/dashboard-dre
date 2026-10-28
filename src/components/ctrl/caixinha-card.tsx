"use client";

import { AlertTriangle, Loader2, Wallet } from "lucide-react";

import { SETORES_DA_CAIXINHA_TEXTO, type SaldoCaixinha } from "@/lib/ctrl/caixinha";

// Saldo da caixinha da Puxada, ao lado da Verificação Orçamentária. É só
// leitura: não bloqueia o envio nem muda a aprovação (regras em
// @/lib/ctrl/caixinha). Mostrado como cascata — planilha, o que já saiu, o que
// está em aprovação e esta requisição — para o solicitante ver de onde vem o
// número final.

const fmt = new Intl.NumberFormat("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const brl = (n: number) => `${n < 0 ? "−" : ""}R$ ${fmt.format(Math.abs(n))}`;
/** '2026-10-10' → '10/10'. */
const diaMes = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;
const plural = (n: number, um: string, varios: string) => `${n} ${n === 1 ? um : varios}`;

export function CaixinhaCard({
  saldo,
  loading,
  error,
  valorDaRequisicao,
  ocorrencias,
  setorForaDaCaixinha,
}: {
  saldo: SaldoCaixinha | null;
  loading: boolean;
  error: string | null;
  /**
   * O que esta requisição tira da caixinha, em reais: só a parte dos setores da
   * caixinha, com a recorrência já multiplicada (valorQueConsome).
   */
  valorDaRequisicao: number;
  /** Quantas requisições este envio cria (recorrência); 1 no caso comum. */
  ocorrencias: number;
  /** O setor escolhido (ou nenhum setor do rateio) consome a caixinha. */
  setorForaDaCaixinha: boolean;
}) {
  if (!loading && !error && !saldo) return null;

  return (
    <div className="space-y-2 rounded-lg bg-sky-50 p-4 ring-1 ring-sky-200 dark:bg-sky-950/20 dark:ring-sky-800">
      <div className="flex items-center gap-2">
        <Wallet className="h-4 w-4 shrink-0 text-sky-600 dark:text-sky-400" />
        <span className="text-sm font-bold text-sky-800 dark:text-sky-200">
          {saldo?.rotulo ?? "Caixinha da Puxada"}
        </span>
        <span className="ml-auto rounded-full bg-sky-100 px-2 py-0.5 text-[11px] font-semibold text-sky-700 ring-1 ring-sky-300 dark:bg-sky-900/40 dark:text-sky-300 dark:ring-sky-700">
          Informativo
        </span>
      </div>

      {loading && (
        <p className="flex items-center gap-2 text-xs text-muted-foreground">
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          Consultando a planilha da caixinha…
        </p>
      )}

      {!loading && error && <p className="text-xs text-destructive">{error}</p>}

      {!loading && saldo && <Detalhe saldo={saldo} valor={valorDaRequisicao} ocorrencias={ocorrencias} />}

      {!loading && setorForaDaCaixinha && (
        <p className="text-xs font-medium text-sky-800 dark:text-sky-200">
          Esta requisição não sai da caixinha: só consomem os setores {SETORES_DA_CAIXINHA_TEXTO}.
        </p>
      )}
    </div>
  );
}

function Detalhe({ saldo, valor, ocorrencias }: { saldo: SaldoCaixinha; valor: number; ocorrencias: number }) {
  const desde = diaMes(saldo.corte);
  const esta = valor > 0 ? valor : 0;

  if (saldo.saldoPlanilha === null || saldo.disponivel === null || saldo.projetado === null) {
    return (
      <div className="space-y-1 text-xs">
        <p className="text-destructive">
          Não foi possível ler a planilha da caixinha{saldo.erroPlanilha ? `: ${saldo.erroPlanilha}` : ""}.
        </p>
        <p className="text-muted-foreground">
          Desde {desde} já saíram {brl(saldo.consumido)} ({plural(saldo.qtdConsumido, "aprovada", "aprovadas")})
          {saldo.qtdPendente > 0 && <> e há {brl(saldo.pendente)} em aprovação</>}.
        </p>
      </div>
    );
  }

  const final = saldo.projetado - esta;

  return (
    <div className="space-y-2">
      <div className="rounded-md bg-white/70 p-3 text-xs dark:bg-background/50">
        <div className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-1.5">
          <span className="text-muted-foreground">Saldo na planilha</span>
          <span className="text-right font-semibold">{brl(saldo.saldoPlanilha)}</span>

          <span className="text-muted-foreground">
            Aprovadas desde {desde} ({saldo.qtdConsumido})
          </span>
          <span className="text-right font-semibold">{brl(-saldo.consumido)}</span>

          <span className="font-medium">Disponível agora</span>
          <span className={`text-right font-bold ${saldo.disponivel >= 0 ? "text-green-600" : "text-red-600"}`}>
            {brl(saldo.disponivel)}
          </span>
        </div>

        {(saldo.qtdPendente > 0 || esta > 0) && (
          <>
            <div className="my-2 border-t" />
            <div className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-1.5">
              {saldo.qtdPendente > 0 && (
                <>
                  <span className="text-muted-foreground">Em aprovação ({saldo.qtdPendente})</span>
                  <span className="text-right font-semibold">{brl(-saldo.pendente)}</span>
                </>
              )}
              {esta > 0 && (
                <>
                  <span className="text-muted-foreground">
                    Esta requisição{ocorrencias > 1 ? ` (${ocorrencias} meses)` : ""}
                  </span>
                  <span className="text-right font-semibold">{brl(-esta)}</span>
                </>
              )}
              <span className="font-medium">{esta > 0 ? "Saldo depois desta requisição" : "Saldo se as em aprovação passarem"}</span>
              <span className={`text-right font-bold ${final >= 0 ? "text-green-600" : "text-red-600"}`}>
                {brl(final)}
              </span>
            </div>
          </>
        )}
      </div>

      {final < 0 && (
        <p className="flex items-start gap-1.5 text-xs font-medium text-red-700 dark:text-red-300">
          <AlertTriangle className="mt-px h-3.5 w-3.5 shrink-0" />
          A caixinha não cobre {esta > 0 ? "esta requisição" : "o que está em aprovação"}. O envio não é bloqueado.
        </p>
      )}

      {saldo.origem === "anterior" && (
        <p className="text-xs text-amber-700 dark:text-amber-300">
          Planilha indisponível agora{saldo.erroPlanilha ? ` (${saldo.erroPlanilha})` : ""} — usando o último
          valor lido{saldo.lidoEm ? `, de ${diaMes(saldo.lidoEm)}` : ""}.
        </p>
      )}
      {saldo.atrasada && (
        <p className="text-xs text-amber-700 dark:text-amber-300">
          A planilha ainda não trouxe o fechamento do dia 10. Até ela ser atualizada, o Control Hub segue descontando
          tudo que vence desde {desde}.
        </p>
      )}
      <p className="text-[11px] text-muted-foreground">
        Só descontam as requisições dos setores {SETORES_DA_CAIXINHA_TEXTO}. A planilha é fechada todo dia 10; até
        lá, o Control Hub desconta o que vence a partir de {desde}. Não bloqueia o envio nem muda a aprovação.
      </p>
    </div>
  );
}
