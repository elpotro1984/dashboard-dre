"use client";

import { useMemo, useState } from "react";
import { Download, Loader2 } from "lucide-react";

import {
  importarFornecedoresValorFixo,
  previaFornecedoresValorFixo,
  type PreviaFornecedores,
} from "@/lib/orcamento/actions/valor-fixo-fornecedores";
import type { IndiceOption } from "@/lib/orcamento/actions/valor-fixo";
import type { IndiceKey } from "@/lib/orcamento/indices";
import { formatBRL } from "@/lib/orcamento/format";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

const MESES = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
const MESES_LONGO = [
  "Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho",
  "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro",
];

const chave = (code: string, fornecedor: string) => `${code}|${fornecedor}`;

/**
 * "Puxar fornecedores de {ano-base}": lê quem recebeu em cada categoria do Valor
 * fixo no ano-base e cria um contrato por fornecedor escolhido, com o ÚLTIMO
 * valor mensal pago como valor atual. Nada é gravado antes do clique final —
 * a janela é a conferência. Vêm marcados os que pagaram em 2+ meses (cara de
 * contrato fixo); o pagamento avulso aparece, desmarcado.
 */
export function ValorFixoFornecedoresBotao({
  companyId,
  year,
  setorId,
  indices,
  desabilitado,
  motivoDesabilitado,
  onImportou,
}: {
  companyId: string;
  year: number;
  setorId: string | null;
  indices: IndiceOption[];
  desabilitado?: boolean;
  motivoDesabilitado?: string;
  onImportou: () => void;
}) {
  const [aberto, setAberto] = useState(false);
  const [carregando, setCarregando] = useState(false);
  const [gravando, setGravando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [resultado, setResultado] = useState<string | null>(null);
  const [previa, setPrevia] = useState<PreviaFornecedores | null>(null);
  const [marcados, setMarcados] = useState<Set<string>>(new Set());
  const [indiceKey, setIndiceKey] = useState<IndiceKey | "">("");
  const [mesReajuste, setMesReajuste] = useState<number | "">("");

  async function abrir() {
    setAberto(true);
    setCarregando(true);
    setErro(null);
    setResultado(null);
    setPrevia(null);
    const res = await previaFornecedoresValorFixo(companyId, year, setorId);
    setCarregando(false);
    if (res.error || !res.data) {
      setErro(res.error ?? "Não consegui ler os fornecedores.");
      return;
    }
    setPrevia(res.data);
    setMarcados(marcarRecorrentes(res.data));
  }

  function marcarRecorrentes(p: PreviaFornecedores) {
    const s = new Set<string>();
    p.categorias.forEach((c) => {
      if (c.fechada) return;
      c.fornecedores.forEach((f) => {
        if (f.recorrente && !f.jaCadastrado && f.valorAtual != null) {
          s.add(chave(c.categoryCode, f.fornecedor));
        }
      });
    });
    return s;
  }

  function alternar(k: string) {
    setMarcados((antes) => {
      const s = new Set(antes);
      if (s.has(k)) s.delete(k);
      else s.add(k);
      return s;
    });
  }

  const disponiveis = useMemo(() => {
    const out: string[] = [];
    previa?.categorias.forEach((c) => {
      if (c.fechada) return;
      c.fornecedores.forEach((f) => {
        if (!f.jaCadastrado) out.push(chave(c.categoryCode, f.fornecedor));
      });
    });
    return out;
  }, [previa]);

  async function importar() {
    if (!previa) return;
    const itens = previa.categorias.flatMap((c) =>
      c.fornecedores
        .filter((f) => marcados.has(chave(c.categoryCode, f.fornecedor)))
        .map((f) => ({
          categoryCode: c.categoryCode,
          categoryName: c.categoryName,
          fornecedor: f.fornecedor,
          valorBase: f.valorAtual,
        })),
    );
    setGravando(true);
    setErro(null);
    const res = await importarFornecedoresValorFixo(companyId, year, setorId, itens, {
      indiceKey: indiceKey || null,
      mesReajuste: mesReajuste === "" ? null : mesReajuste,
    });
    setGravando(false);
    if (res.error) {
      setErro(res.error);
      return;
    }
    onImportou();
    const partes = [`${res.criados ?? 0} contrato(s) criado(s)`];
    if (res.pulados) partes.push(`${res.pulados} já existia(m)`);
    if (res.falhas && res.falhas.length > 0) {
      // Nomeia o que não entrou: sumir com a falha faria o admin achar que
      // todos os fornecedores viraram contrato.
      setErro(
        res.falhas.map((f) => `${f.categoryName} · ${f.fornecedor}: ${f.erro}`).join("\n"),
      );
      partes.push(`${res.falhas.length} não entrou(aram)`);
    } else {
      setAberto(false);
    }
    setResultado(partes.join(" · "));
  }

  const baseYear = year - 1;
  const totalMarcados = marcados.size;

  return (
    <>
      <div className="space-y-1">
        <button
          type="button"
          onClick={() => void abrir()}
          disabled={desabilitado}
          title={desabilitado ? motivoDesabilitado : undefined}
          className="inline-flex h-10 items-center gap-1.5 rounded-md border px-3 text-sm font-medium hover:bg-muted disabled:opacity-50"
        >
          <Download className="h-4 w-4" />
          Puxar fornecedores de {baseYear}
        </button>
        {resultado && !aberto && (
          <p className="text-[11px] text-emerald-600">{resultado}</p>
        )}
      </div>

      <Dialog open={aberto} onOpenChange={(o) => !gravando && setAberto(o)}>
        <DialogContent className="sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle>Fornecedores de {baseYear} → contratos</DialogTitle>
            <DialogDescription>
              Quem recebeu em cada categoria em {baseYear}. O valor atual de cada contrato é o{" "}
              <strong>último mês pago</strong> (não a média — um reajuste no meio do ano a
              deixaria abaixo do que se paga hoje). Vêm marcados os que pagaram em 2 ou mais
              meses; confira antes de adicionar.
              {previa && previa.mesesFechados > 0 && previa.mesesFechados < 12 && (
                <> Considerados os meses fechados (jan–{MESES[previa.mesesFechados - 1] ?? "—"}).</>
              )}
            </DialogDescription>
          </DialogHeader>

          {carregando ? (
            <div className="flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Lendo o realizado de {baseYear}…
            </div>
          ) : previa ? (
            <div className="space-y-3">
              <div className="flex flex-wrap items-end gap-3 rounded-md border bg-muted/20 p-3 text-sm">
                <label className="space-y-1">
                  <span className="block text-xs font-medium text-muted-foreground">
                    Correção para todos
                  </span>
                  <select
                    value={indiceKey}
                    onChange={(e) => setIndiceKey(e.target.value as IndiceKey | "")}
                    className="rounded-md border bg-background px-2 py-1.5 text-sm"
                  >
                    <option value="">Sem correção</option>
                    {indices.map((i) => (
                      <option key={i.key} value={i.key}>
                        {i.label}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="space-y-1">
                  <span className="block text-xs font-medium text-muted-foreground">
                    Mês do reajuste
                  </span>
                  <select
                    value={mesReajuste}
                    onChange={(e) => setMesReajuste(e.target.value === "" ? "" : Number(e.target.value))}
                    className="rounded-md border bg-background px-2 py-1.5 text-sm"
                  >
                    <option value="">Sem reajuste no ano</option>
                    {MESES_LONGO.map((m, i) => (
                      <option key={m} value={i + 1}>
                        {m}
                      </option>
                    ))}
                  </select>
                </label>
                <span className="ml-auto flex gap-2 text-xs">
                  <button
                    type="button"
                    onClick={() => setMarcados(marcarRecorrentes(previa))}
                    className="rounded border px-2 py-1 hover:bg-muted"
                  >
                    Só os recorrentes
                  </button>
                  <button
                    type="button"
                    onClick={() => setMarcados(new Set(disponiveis))}
                    className="rounded border px-2 py-1 hover:bg-muted"
                  >
                    Marcar todos
                  </button>
                  <button
                    type="button"
                    onClick={() => setMarcados(new Set())}
                    className="rounded border px-2 py-1 hover:bg-muted"
                  >
                    Desmarcar
                  </button>
                </span>
              </div>

              <div className="max-h-[50vh] space-y-3 overflow-y-auto pr-1">
                {previa.categorias.map((c) => (
                  <div key={c.categoryCode} className="rounded-md border">
                    <div className="flex items-baseline justify-between gap-2 border-b bg-muted/30 px-3 py-1.5">
                      <span className="text-sm font-semibold">{c.categoryName}</span>
                      <span className="text-[11px] text-muted-foreground">{c.categoryCode}</span>
                    </div>
                    {c.fechada ? (
                      <p className="px-3 py-2 text-xs text-muted-foreground">
                        Finalizada — reabra a categoria para acrescentar contratos.
                      </p>
                    ) : c.fornecedores.length === 0 ? (
                      <p className="px-3 py-2 text-xs text-muted-foreground">
                        Nenhum pagamento nesta categoria em {baseYear}.
                      </p>
                    ) : (
                      <ul className="divide-y">
                        {c.fornecedores.map((f) => {
                          const k = chave(c.categoryCode, f.fornecedor);
                          const bloqueado = f.jaCadastrado;
                          return (
                            <li key={k}>
                              <label
                                className={cn(
                                  "flex cursor-pointer items-center gap-3 px-3 py-1.5 text-sm",
                                  bloqueado && "cursor-default opacity-60",
                                )}
                              >
                                <input
                                  type="checkbox"
                                  checked={!bloqueado && marcados.has(k)}
                                  disabled={bloqueado}
                                  onChange={() => alternar(k)}
                                />
                                <span className="min-w-0 flex-1 truncate" title={f.fornecedor}>
                                  {f.fornecedor}
                                </span>
                                <span className="shrink-0 text-[11px] text-muted-foreground">
                                  {bloqueado
                                    ? "já cadastrado"
                                    : f.ultimoMes == null
                                      ? "só no mês em curso"
                                      : `${f.mesesPagos} ${f.mesesPagos === 1 ? "mês" : "meses"} · último em ${MESES[f.ultimoMes - 1]}`}
                                </span>
                                <span className="w-28 shrink-0 text-right font-medium tabular-nums">
                                  {f.valorAtual != null ? `${formatBRL(f.valorAtual)}/mês` : "—"}
                                </span>
                                <span
                                  className="w-28 shrink-0 text-right text-[11px] tabular-nums text-muted-foreground"
                                  title={`Total pago em ${baseYear}`}
                                >
                                  {formatBRL(f.totalAno)} no ano
                                </span>
                              </label>
                            </li>
                          );
                        })}
                      </ul>
                    )}
                  </div>
                ))}
              </div>
            </div>
          ) : null}

          {erro && (
            <p className="whitespace-pre-line rounded-md bg-destructive/10 px-3 py-2 text-xs text-destructive">
              {erro}
            </p>
          )}

          <DialogFooter className="gap-2 sm:gap-0">
            <button
              type="button"
              onClick={() => setAberto(false)}
              disabled={gravando}
              className="rounded-md border px-3 py-1.5 text-sm hover:bg-muted disabled:opacity-50"
            >
              Cancelar
            </button>
            <button
              type="button"
              onClick={() => void importar()}
              disabled={gravando || carregando || totalMarcados === 0}
              className="inline-flex items-center gap-1.5 rounded-md bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
            >
              {gravando && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              Adicionar {totalMarcados} contrato(s)
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
