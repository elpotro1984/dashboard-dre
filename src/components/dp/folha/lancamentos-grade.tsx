"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CopyPlus, Save, Undo2 } from "lucide-react";

import { useToast } from "@/components/ui/toaster";
import { herdarMesAnterior, salvarLancamentosEmLote } from "@/lib/dp/actions-folha";
import { calcularFolhaPessoa, grupoContratoFolha, ROTULO_SITUACAO, type DpSituacaoFolha } from "@/lib/dp/folha/motor";
import { rotuloCompetencia, somarMeses, type DpFolhaParametros } from "@/lib/dp/folha/parametros";
import type { DpFolhaPessoa } from "@/lib/dp/folha/queries";
import type { DpCamposGrade } from "@/lib/dp/folha/validacao";

import { SeloTabela } from "./promocao";
import { inputCls, NumCampo, NumCampoOpcional } from "./campos";
import { brl0 } from "./formato";

type CampoNum = Exclude<keyof DpCamposGrade, "situacao">;
/** Os três que o sistema preenche sozinho: campo vazio = automático, com o valor em cinza. */
type CampoAuto = "diasFerias" | "diasTrabalhados" | "inssFerias" | "vtDiasDesconto";
const AUTO = new Set<CampoNum>(["diasFerias", "diasTrabalhados", "inssFerias", "vtDiasDesconto"]);
const COLUNAS: Array<{ k: CampoNum; rotulo: string; casas?: number }> = [
  { k: "diasFerias", rotulo: "Dias férias", casas: 2 },
  { k: "diasTrabalhados", rotulo: "Dias trab.", casas: 2 },
  { k: "outrosProventos", rotulo: "Outros proventos" },
  { k: "inssFerias", rotulo: "INSS férias" },
  { k: "coparticipacao", rotulo: "Copart." },
  { k: "outrosDescontos", rotulo: "Outros desc." },
  { k: "comissao", rotulo: "Comissão" },
  { k: "vtDiasDesconto", rotulo: "Dias VT desc.", casas: 2 },
];

function camposDe(p: DpFolhaPessoa): DpCamposGrade {
  const { ajustes: _ajustes, ...resto } = p.lancamento;
  void _ajustes;
  return resto;
}

const igual = (a: DpCamposGrade, b: DpCamposGrade) => (Object.keys(a) as Array<keyof DpCamposGrade>).every((k) => a[k] === b[k]);

/**
 * A grade do mês: as colunas variáveis da aba CONTROLE, editáveis linha a
 * linha como na planilha (Enter desce para a próxima pessoa na mesma coluna),
 * com o 5º dia útil e o total recalculados ao vivo pelo mesmo motor do
 * servidor. Um "Salvar" grava tudo o que mudou; os ajustes manuais de cada
 * pessoa são preservados.
 */
export function DpLancamentosGrade({
  pessoas,
  visiveis,
  parametros,
  competencia,
  companyId,
  editavel,
  onAbrir,
}: {
  /** TODAS as pessoas da folha — o filtro da tela só esconde linhas, não descarta o que foi digitado. */
  pessoas: DpFolhaPessoa[];
  visiveis: Set<number>;
  parametros: DpFolhaParametros;
  competencia: string;
  companyId: string;
  editavel: boolean;
  onAbrir: (solidesId: number) => void;
}) {
  const [edits, setEdits] = useState<Map<number, DpCamposGrade>>(() => new Map(pessoas.map((p) => [p.solidesId, camposDe(p)])));
  const [pending, start] = useTransition();
  const router = useRouter();
  const { showToast } = useToast();

  const original = useMemo(() => new Map(pessoas.map((p) => [p.solidesId, camposDe(p)])), [pessoas]);
  const sujos = useMemo(
    () => Array.from(edits).filter(([id, c]) => original.has(id) && !igual(c, original.get(id)!)).map(([id]) => id),
    [edits, original],
  );

  // Dados novos do servidor (salvou pela janela da pessoa, refresh): linhas NÃO
  // editadas acompanham; as editadas e não salvas ficam como o DP digitou.
  useEffect(() => {
    setEdits((atual) => {
      const novo = new Map<number, DpCamposGrade>();
      for (const p of pessoas) {
        const a = atual.get(p.solidesId);
        const antes = a && !sujos.includes(p.solidesId) ? null : a;
        novo.set(p.solidesId, antes ?? camposDe(p));
      }
      return novo;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pessoas]);

  useEffect(() => {
    if (sujos.length === 0) return;
    const aviso = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", aviso);
    return () => window.removeEventListener("beforeunload", aviso);
  }, [sujos.length]);

  const set = (id: number, k: keyof DpCamposGrade, v: DpCamposGrade[keyof DpCamposGrade]) =>
    setEdits((m) => {
      const n = new Map(m);
      n.set(id, { ...(n.get(id) as DpCamposGrade), [k]: v });
      return n;
    });

  const salvar = () =>
    start(async () => {
      const res = await salvarLancamentosEmLote({
        companyId,
        competencia,
        itens: sujos.map((id) => ({ solidesId: id, campos: edits.get(id)! })),
      });
      if (!res.ok) {
        showToast({ title: "Não salvo", description: res.error, variant: "destructive" });
        return;
      }
      const nomes = new Map(pessoas.map((p) => [p.solidesId, p.nome]));
      if (res.data.erros.length) {
        showToast({
          title: `${res.data.gravados} salvo(s), ${res.data.erros.length} com erro`,
          description: res.data.erros.map((e) => `${nomes.get(e.solidesId) ?? e.solidesId}: ${e.erro}`).join(" · "),
          variant: "destructive",
        });
      } else showToast({ title: "Mês salvo", description: `${res.data.gravados} pessoa(s) atualizadas.`, variant: "success" });
      router.refresh();
    });

  const herdar = () =>
    start(async () => {
      const res = await herdarMesAnterior({ companyId, competencia });
      if (!res.ok) showToast({ title: "Não concluído", description: res.error, variant: "destructive" });
      else
        showToast({
          title: res.data.trazidos ? `${res.data.trazidos} pessoa(s) afastada(s) ou de licença trazida(s)` : "Nada a trazer",
          description: `De ${rotuloCompetencia(somarMeses(competencia, -1))}: só a situação, e só para quem ainda não tem lançamento neste mês. Descontos que se repetem ficam como fixos no cadastro da pessoa.`,
          variant: "success",
        });
      router.refresh();
    });

  const pular = (col: string, linha: number) => {
    const alvo = document.querySelector<HTMLInputElement>(`[data-grade-col="${col}"][data-grade-linha="${linha}"]`);
    alvo?.focus();
    alvo?.select();
  };

  const total = { quinto: 0, geral: 0 };
  const linhas = pessoas.filter((p) => visiveis.has(p.solidesId)).map((p) => {
    const c = edits.get(p.solidesId) ?? camposDe(p);
    const r = calcularFolhaPessoa(
      {
        solidesId: p.solidesId,
        nome: p.nome,
        setor: p.cadastro.setorFolha ?? p.setor,
        centroCusto: p.centroCusto,
        empresaId: companyId,
        contrato: grupoContratoFolha(p.tipoContrato),
        salario: p.salario,
        nascimento: p.nascimento,
        admissao: p.admissao,
        desligamento: p.desligamento,
        desligamentoEstimado: p.desligamentoEstimado,
        salarioOrigem: p.salarioOrigem,
        salarioAviso: p.salarioAviso,
        tabelaAviso: p.alertaTabela,
        cadastro: p.cadastro,
        lancamento: { ...c, ajustes: p.lancamento.ajustes },
      },
      parametros,
      competencia,
    );
    total.quinto += r.quintoDiaUtil;
    total.geral += r.totalGeral;
    return { p, c, r };
  });

  return (
    <div className="space-y-3">
      {editavel && (
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            disabled={pending || sujos.length === 0}
            onClick={salvar}
            className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
          >
            <Save className="h-4 w-4" /> {pending ? "Salvando…" : `Salvar${sujos.length ? ` (${sujos.length})` : ""}`}
          </button>
          <button
            type="button"
            disabled={pending || sujos.length === 0}
            onClick={() => setEdits(new Map(original))}
            className="inline-flex items-center gap-1.5 rounded-md border border-input px-3 py-1.5 text-sm hover:bg-muted disabled:opacity-50"
          >
            <Undo2 className="h-4 w-4" /> Descartar
          </button>
          <button
            type="button"
            disabled={pending || sujos.length > 0}
            onClick={herdar}
            title={sujos.length ? "Salve ou descarte as alterações antes" : undefined}
            className="inline-flex items-center gap-1.5 rounded-md border border-input px-3 py-1.5 text-sm hover:bg-muted disabled:opacity-50"
          >
            <CopyPlus className="h-4 w-4" /> Trazer de {rotuloCompetencia(somarMeses(competencia, -1))}
          </button>
          <span className="text-xs text-ink-muted">Enter desce para a próxima pessoa. Os valores ao lado se recalculam enquanto você digita.</span>
        </div>
      )}
      <div className="overflow-x-auto">
        <table className="w-full min-w-[1250px] text-sm">
          <thead className="text-left text-ink-muted">
            <tr className="border-b border-border">
              <th className="py-2 pr-2 font-medium">Colaborador</th>
              <th className="w-36 py-2 pr-2 font-medium">Situação</th>
              {COLUNAS.map((c) => (
                <th key={c.k} className="w-24 py-2 pr-2 text-right font-medium">
                  {c.rotulo}
                </th>
              ))}
              <th className="py-2 pr-2 text-right font-medium">5º dia útil</th>
              <th className="py-2 text-right font-medium">Total geral</th>
            </tr>
          </thead>
          <tbody>
            {linhas.map(({ p, c, r }, i) => {
              const sujo = sujos.includes(p.solidesId);
              return (
                <tr
                  key={p.solidesId}
                  className={`border-b border-border ${sujo ? "bg-amber-500/5" : p.alertaTabela && editavel ? "bg-red-500/10" : ""}`}
                  title={p.alertaTabela && editavel ? p.alertaTabela : undefined}
                >
                  <td className="py-1 pr-2">
                    <button type="button" className="text-left font-medium text-ink-primary hover:underline" onClick={() => onAbrir(p.solidesId)}>
                      {p.nome}
                    </button>
                    {sujo && <span className="ml-1 text-xs text-amber-700 dark:text-amber-400">não salvo</span>}
                    {p.alertaTabela && editavel && <SeloTabela />}
                    {r.recorrentes.length > 0 && (
                      <span className="ml-1 text-xs text-ink-muted" title={r.recorrentes.map((x) => `${x.descricao}${x.parcela ? ` ${x.parcela}` : ""}`).join(" · ")}>
                        · {r.recorrentes.length} fixo(s)
                      </span>
                    )}
                    {Object.keys(p.lancamento.ajustes).length > 0 && (
                      <span className="ml-1 text-xs text-ink-muted">· {Object.keys(p.lancamento.ajustes).length} ajuste(s)</span>
                    )}
                  </td>
                  <td className="py-1 pr-2">
                    <select
                      className={inputCls}
                      disabled={!editavel}
                      value={c.situacao}
                      onChange={(e) => set(p.solidesId, "situacao", e.target.value as DpSituacaoFolha)}
                      aria-label={`Situação de ${p.nome}`}
                    >
                      {(Object.keys(ROTULO_SITUACAO) as DpSituacaoFolha[]).map((s) => (
                        <option key={s} value={s}>
                          {ROTULO_SITUACAO[s]}
                        </option>
                      ))}
                    </select>
                  </td>
                  {COLUNAS.map((col) => (
                    <td key={col.k} className="py-1 pr-2">
                      {AUTO.has(col.k) ? (
                        <NumCampoOpcional
                          valor={c[col.k as CampoAuto]}
                          auto={r.automatico[col.k as CampoAuto]}
                          onChange={(v) => set(p.solidesId, col.k, v)}
                          disabled={!editavel}
                          casas={col.casas ?? 2}
                          ariaLabel={`${col.rotulo} de ${p.nome}`}
                          extra={{
                            "data-grade-col": col.k,
                            "data-grade-linha": i,
                            onKeyDown: (e) => {
                              if (e.key === "Enter") {
                                e.preventDefault();
                                pular(col.k, e.shiftKey ? i - 1 : i + 1);
                              }
                            },
                          }}
                        />
                      ) : (
                      <NumCampo
                        valor={c[col.k] as number}
                        onChange={(v) => set(p.solidesId, col.k, v)}
                        disabled={!editavel}
                        casas={col.casas ?? 2}
                        ariaLabel={`${col.rotulo} de ${p.nome}`}
                        className="text-right"
                        extra={{
                          "data-grade-col": col.k,
                          "data-grade-linha": i,
                          onKeyDown: (e) => {
                            if (e.key === "Enter") {
                              e.preventDefault();
                              pular(col.k, e.shiftKey ? i - 1 : i + 1);
                            }
                          },
                        }}
                      />
                      )}
                    </td>
                  ))}
                  <td className="py-1 pr-2 text-right font-medium tabular-nums">{brl0(r.quintoDiaUtil)}</td>
                  <td className="py-1 text-right tabular-nums">{brl0(r.totalGeral)}</td>
                </tr>
              );
            })}
            <tr className="font-semibold">
              <td className="py-2 pr-2" colSpan={2 + COLUNAS.length}>
                Total ({linhas.length})
              </td>
              <td className="py-2 pr-2 text-right tabular-nums">{brl0(total.quinto)}</td>
              <td className="py-2 text-right tabular-nums">{brl0(total.geral)}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}
