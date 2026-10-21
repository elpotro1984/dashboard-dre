"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, Pencil, Plus, Trash2, X } from "lucide-react";

import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useToast } from "@/components/ui/toaster";
import {
  definirCentroCustoFolha,
  excluirAvulso,
  salvarAvulso,
  salvarCadastroFolha,
  salvarLancamentoFolha,
  unificarAvulso,
} from "@/lib/dp/actions-folha";
import type { DpAvulsoEntrada } from "@/lib/dp/folha/avulsos";
import {
  calcularFolhaPessoa,
  COLUNAS_AJUSTAVEIS,
  COLUNAS_FOLHA,
  grupoContratoFolha,
  ROTULO_COLUNA,
  ROTULO_SITUACAO,
  type DpColunaAjustavel,
  type DpColunaFolha,
  type DpFolhaCadastro,
  type DpFolhaLancamento,
  type DpFolhaResultado,
  type DpRecorrente,
  type DpSituacaoFolha,
} from "@/lib/dp/folha/motor";
import { ROTULO_PLANO, type DpFolhaParametros, type DpPlanoTipo } from "@/lib/dp/folha/parametros";
import type { DpFolhaPessoa } from "@/lib/dp/folha/queries";

import { DpAvulsoCampos } from "./avulso-form";
import { inputCls, NumCampo, NumCampoOpcional } from "./campos";
import { brl } from "./formato";

const SOMAS: DpColunaFolha[] = ["totalEntradas", "totalFerias", "totalDescontos", "saldo", "quintoDiaUtil", "totalBeneficio", "totalExtras", "totalGeral"];
const AJUSTAVEL = new Set<string>(COLUNAS_AJUSTAVEIS);

function Campo({ rotulo, children, dica }: { rotulo: string; children: React.ReactNode; dica?: string }) {
  return (
    <label className="block space-y-0.5">
      <span className="text-xs font-medium text-ink-muted">{rotulo}</span>
      {children}
      {dica && <span className="block text-[11px] text-ink-muted">{dica}</span>}
    </label>
  );
}

/**
 * Uma pessoa na folha do mês: o variável do mês, o cadastro fixo da folha e o
 * cálculo AO VIVO com a memória de cada valor (o motor é puro e roda aqui
 * também — o número que a tela mostra enquanto se digita é o mesmo que o
 * servidor grava). Folha fechada: só leitura, com o retrato gravado.
 */
export function DpFolhaPessoaDialog({
  pessoa,
  linhaFechada,
  parametros,
  competencia,
  companyId,
  centros,
  editavel,
  onClose,
}: {
  pessoa: DpFolhaPessoa;
  /** Na folha fechada, o retrato gravado (não se recalcula). */
  linhaFechada: DpFolhaResultado | null;
  parametros: DpFolhaParametros;
  competencia: string;
  companyId: string;
  /** Centros de custo da empresa (cadastro do DP). */
  centros: Array<{ id: string; rotulo: string }>;
  editavel: boolean;
  onClose: () => void;
}) {
  const [lanc, setLanc] = useState<DpFolhaLancamento>(() => structuredClone(pessoa.lancamento));
  const [cad, setCad] = useState<DpFolhaCadastro>(() => structuredClone(pessoa.cadastro));
  const [obs, setObs] = useState(pessoa.observacaoMes ?? "");
  const [centroId, setCentroId] = useState<string | null>(pessoa.centroId);
  const [av, setAv] = useState<DpAvulsoEntrada | null>(() =>
    pessoa.avulso
      ? {
          nome: pessoa.avulso.nome,
          cpf: pessoa.avulso.cpf,
          setor: pessoa.avulso.setor,
          tipoContrato: pessoa.avulso.tipoContrato,
          salario: pessoa.avulso.salario,
          nascimento: pessoa.avulso.nascimento,
          admissao: pessoa.avulso.admissao,
          desligamento: pessoa.avulso.desligamento,
          observacao: pessoa.avulso.observacao,
        }
      : null,
  );
  const centroRotulo = centros.find((c) => c.id === centroId)?.rotulo ?? null;
  const [ajustando, setAjustando] = useState<DpColunaAjustavel | null>(null);
  const [ajValor, setAjValor] = useState(0);
  const [ajMotivo, setAjMotivo] = useState("");
  const [pending, start] = useTransition();
  const router = useRouter();
  const { showToast } = useToast();

  const r = useMemo(
    () =>
      linhaFechada ??
      calcularFolhaPessoa(
        {
          solidesId: pessoa.solidesId,
          nome: av?.nome ?? pessoa.nome,
          setor: av ? av.setor : cad.setorFolha ?? pessoa.setor,
          centroCusto: centroRotulo,
          empresaId: companyId,
          contrato: grupoContratoFolha(av ? av.tipoContrato : pessoa.tipoContrato),
          salario: av ? av.salario : pessoa.salario,
          nascimento: av ? av.nascimento : pessoa.nascimento,
          admissao: av ? av.admissao : pessoa.admissao,
          desligamento: av ? av.desligamento : pessoa.desligamento,
          desligamentoEstimado: av ? false : pessoa.desligamentoEstimado,
          cadastro: cad,
          lancamento: lanc,
        },
        parametros,
        competencia,
      ),
    [linhaFechada, pessoa, companyId, cad, lanc, parametros, competencia, centroRotulo, av],
  );

  const setL = <K extends keyof DpFolhaLancamento>(k: K, v: DpFolhaLancamento[K]) => setLanc((x) => ({ ...x, [k]: v }));
  const setC = <K extends keyof DpFolhaCadastro>(k: K, v: DpFolhaCadastro[K]) => setCad((x) => ({ ...x, [k]: v }));
  const ro = !editavel;

  const salvar = () =>
    start(async () => {
      if (av && pessoa.avulso) {
        const r0 = await salvarAvulso({ companyId, pessoaId: pessoa.solidesId, dados: av });
        if (!r0.ok) {
          showToast({ title: "Não salvo", description: r0.error, variant: "destructive" });
          return;
        }
      }
      const [a, b, c] = await Promise.all([
        salvarCadastroFolha({ companyId, competencia, solidesId: pessoa.solidesId, cadastro: cad }),
        salvarLancamentoFolha({ companyId, competencia, solidesId: pessoa.solidesId, lancamento: lanc, observacao: obs }),
        centroId !== pessoa.centroId
          ? definirCentroCustoFolha({ companyId, solidesId: pessoa.solidesId, centroId })
          : Promise.resolve({ ok: true as const, data: undefined }),
      ]);
      const erro = !a.ok ? a.error : !b.ok ? b.error : !c.ok ? c.error : null;
      if (erro) {
        showToast({ title: "Não salvo", description: erro, variant: "destructive" });
        return;
      }
      showToast({ title: "Folha atualizada", description: pessoa.nome, variant: "success" });
      router.refresh();
      onClose();
    });

  const abrirAjuste = (col: DpColunaAjustavel) => {
    setAjustando(col);
    setAjValor(lanc.ajustes[col]?.valor ?? r[col]);
    setAjMotivo(lanc.ajustes[col]?.motivo ?? "");
  };
  const aplicarAjuste = () => {
    if (!ajustando || !ajMotivo.trim()) return;
    setLanc((x) => ({ ...x, ajustes: { ...x.ajustes, [ajustando]: { valor: ajValor, motivo: ajMotivo.trim() } } }));
    setAjustando(null);
  };
  const removerAjuste = (col: DpColunaAjustavel) =>
    setLanc((x) => {
      const ajustes = { ...x.ajustes };
      delete ajustes[col];
      return { ...x, ajustes };
    });

  const acaoAvulso = (fn: () => Promise<{ ok: boolean; error?: string }>, ok: string) =>
    start(async () => {
      const res = await fn();
      if (!res.ok) {
        showToast({ title: "Não concluído", description: res.error, variant: "destructive" });
        return;
      }
      showToast({ title: ok, variant: "success" });
      router.refresh();
      onClose();
    });

  const depsSolidesForaDoPlano = pessoa.dependentesSolides.filter(
    (d) => d.nascimento && !cad.planoDependentes.some((p) => p.nascimento === d.nascimento && p.nome === d.nome),
  );

  return (
    <Dialog open onOpenChange={(o) => !o && !pending && onClose()}>
      <DialogContent className="max-h-[92vh] max-w-6xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{pessoa.nome}</DialogTitle>
          <DialogDescription>
            {[pessoa.setor, pessoa.centroCusto && `centro de custo ${pessoa.centroCusto}`, pessoa.tipoContrato ?? "sem tipo de contrato"]
              .filter(Boolean)
              .join(" · ")}{" "}
            · salário na Sólides {pessoa.salario === null ? "não informado" : brl(pessoa.salario)}
            {!editavel && " · folha fechada — reabra para alterar"}
          </DialogDescription>
        </DialogHeader>

        {pessoa.unificarCom && editavel && (
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-sky-500/30 bg-sky-500/5 px-3 py-2 text-sm">
            <span>
              Esta pessoa agora está na Sólides como <strong>{pessoa.unificarCom.nome}</strong>. Unifique para não pagar duas vezes: o
              cadastro e os meses abertos passam para o registro da Sólides.
            </span>
            <button
              type="button"
              disabled={pending}
              onClick={() => acaoAvulso(() => unificarAvulso({ companyId, pessoaId: pessoa.solidesId, solidesId: pessoa.unificarCom!.solidesId }), "Unificado com a Sólides")}
              className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
            >
              Unificar
            </button>
          </div>
        )}

        {r.avisos.length > 0 && (
          <ul className="space-y-1 rounded-md border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-sm text-amber-900 dark:text-amber-200">
            {r.avisos.map((a) => (
              <li key={a} className="flex gap-2">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /> {a}
              </li>
            ))}
          </ul>
        )}

        <div className="grid gap-6 lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)]">
          <div className="space-y-5">
            {av && (
              <section className="space-y-2 rounded-md border border-amber-500/30 bg-amber-500/5 p-3">
                <div className="flex items-center justify-between gap-2">
                  <h3 className="text-sm font-semibold text-ink-primary">Dados da pessoa (fora da Sólides)</h3>
                  {editavel && (
                    <button
                      type="button"
                      disabled={pending}
                      onClick={() => acaoAvulso(() => excluirAvulso({ companyId, pessoaId: pessoa.solidesId }), "Pessoa excluída da folha")}
                      className="text-xs text-red-700 hover:underline disabled:opacity-50 dark:text-red-400"
                    >
                      Excluir
                    </button>
                  )}
                </div>
                <p className="text-xs text-ink-muted">Quem saiu: informe o desligamento (meses com lançamento não se excluem).</p>
                <DpAvulsoCampos v={av} onChange={setAv} disabled={ro} />
              </section>
            )}

            <section className="space-y-2">
              <h3 className="text-sm font-semibold text-ink-primary">Neste mês</h3>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                <Campo rotulo="Situação">
                  <select className={inputCls} disabled={ro} value={lanc.situacao} onChange={(e) => setL("situacao", e.target.value as DpSituacaoFolha)}>
                    {(Object.keys(ROTULO_SITUACAO) as DpSituacaoFolha[]).map((s) => (
                      <option key={s} value={s}>
                        {ROTULO_SITUACAO[s]}
                      </option>
                    ))}
                  </select>
                </Campo>
                <Campo rotulo="Dias de férias">
                  <NumCampo valor={lanc.diasFerias} onChange={(v) => setL("diasFerias", v)} disabled={ro} />
                </Campo>
                <Campo rotulo="Dias trabalhados" dica="Vazio = automático (admissão/desligamento − férias)">
                  <NumCampoOpcional
                    valor={lanc.diasTrabalhados}
                    auto={r.automatico?.diasTrabalhados ?? 30}
                    onChange={(v) => setL("diasTrabalhados", v)}
                    disabled={ro}
                  />
                </Campo>
                <Campo rotulo="Outros proventos" dica="Insuf. de saldo etc.; entra no salário">
                  <NumCampo valor={lanc.outrosProventos} onChange={(v) => setL("outrosProventos", v)} disabled={ro} />
                </Campo>
                <Campo rotulo="INSS do recibo de férias" dica="Vazio = calculado como no recibo">
                  <NumCampoOpcional
                    valor={lanc.inssFerias}
                    auto={r.automatico?.inssFerias ?? 0}
                    onChange={(v) => setL("inssFerias", v)}
                    disabled={ro}
                  />
                </Campo>
                <Campo rotulo="Coparticipação">
                  <NumCampo valor={lanc.coparticipacao} onChange={(v) => setL("coparticipacao", v)} disabled={ro} />
                </Campo>
                <Campo rotulo="Outros descontos">
                  <NumCampo valor={lanc.outrosDescontos} onChange={(v) => setL("outrosDescontos", v)} disabled={ro} />
                </Campo>
                <Campo rotulo="Comissão / meta">
                  <NumCampo valor={lanc.comissao} onChange={(v) => setL("comissao", v)} disabled={ro} />
                </Campo>
                <Campo
                  rotulo="Dias de VT a descontar"
                  dica={`Vazio = automático (${r.automatico?.diasUteisMes ?? "—"} dias úteis no mês)`}
                >
                  <NumCampoOpcional
                    valor={lanc.vtDiasDesconto}
                    auto={r.automatico?.vtDiasDesconto ?? 0}
                    onChange={(v) => setL("vtDiasDesconto", v)}
                    disabled={ro}
                  />
                </Campo>
              </div>
              <Campo rotulo="Observação do mês">
                <input className={inputCls} disabled={ro} value={obs} onChange={(e) => setObs(e.target.value)} maxLength={500} />
              </Campo>
            </section>

            <section className="space-y-2">
              <h3 className="text-sm font-semibold text-ink-primary">Cadastro da folha</h3>
              <p className="text-xs text-ink-muted">Vale para todos os meses abertos. Nome, salário, contrato, nascimento e dependentes vêm da Sólides.</p>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                <Campo rotulo="Plano de saúde">
                  <select className={inputCls} disabled={ro} value={cad.planoSaude} onChange={(e) => setC("planoSaude", e.target.value as DpPlanoTipo | "nenhum")}>
                    {(Object.keys(ROTULO_PLANO) as Array<DpPlanoTipo | "nenhum">).map((k) => (
                      <option key={k} value={k}>
                        {ROTULO_PLANO[k]}
                      </option>
                    ))}
                  </select>
                </Campo>
                <Campo rotulo="Odonto (vidas)">
                  <NumCampo valor={cad.odontoVidas} onChange={(v) => setC("odontoVidas", Math.round(v))} disabled={ro} casas={0} />
                </Campo>
                <Campo rotulo="Dependentes de IR">
                  <NumCampo valor={cad.dependentesIr} onChange={(v) => setC("dependentesIr", Math.round(v))} disabled={ro} casas={0} />
                </Campo>
                <Campo rotulo="Salário-família (cotas)">
                  <NumCampo valor={cad.salarioFamiliaCotas} onChange={(v) => setC("salarioFamiliaCotas", Math.round(v))} disabled={ro} casas={0} />
                </Campo>
                <Campo rotulo="Alimentação (mensal)">
                  <NumCampo valor={cad.alimentacao} onChange={(v) => setC("alimentacao", v)} disabled={ro} />
                </Campo>
                <Campo rotulo="Auxílio home office">
                  <NumCampo valor={cad.homeOffice} onChange={(v) => setC("homeOffice", v)} disabled={ro} />
                </Campo>
                <Campo rotulo="Transporte">
                  <select
                    className={inputCls}
                    disabled={ro}
                    value={cad.transporteTipo === "bilhete" ? `b:${cad.transporteOpcao}` : cad.transporteTipo}
                    onChange={(e) => {
                      const v = e.target.value;
                      if (v.startsWith("b:")) setCad((x) => ({ ...x, transporteTipo: "bilhete", transporteOpcao: v.slice(2) }));
                      else setCad((x) => ({ ...x, transporteTipo: v as "nenhum" | "gasolina", transporteOpcao: null }));
                    }}
                  >
                    <option value="nenhum">Nenhum</option>
                    <option value="gasolina">Vale-gasolina (valor mensal)</option>
                    {parametros.bilhetes.map((b) => (
                      <option key={b.nome} value={`b:${b.nome}`}>
                        {b.nome} ({brl(b.valorDiario)}/dia)
                      </option>
                    ))}
                  </select>
                </Campo>
                {cad.transporteTipo === "gasolina" && (
                  <Campo rotulo="Gasolina (mensal)">
                    <NumCampo valor={cad.transporteValor} onChange={(v) => setC("transporteValor", v)} disabled={ro} />
                  </Campo>
                )}
                <Campo rotulo="Escala (dias de VT)">
                  <select className={inputCls} disabled={ro} value={cad.escala} onChange={(e) => setC("escala", e.target.value)}>
                    {parametros.escalas.map((s) => (
                      <option key={s.nome} value={s.nome}>
                        {s.nome} ({s.diasMes} dias)
                      </option>
                    ))}
                  </select>
                </Campo>
              </div>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                <Campo rotulo="Setor da folha" dica={av ? "Pessoa fora da Sólides: o setor está nos dados acima." : `Vazio = o da Sólides (${pessoa.setor ?? "sem departamento"})`}>
                  <input
                    className={inputCls}
                    disabled={ro || Boolean(av)}
                    value={cad.setorFolha ?? ""}
                    placeholder={pessoa.setor ?? ""}
                    onChange={(e) => setC("setorFolha", e.target.value || null)}
                    maxLength={120}
                  />
                </Campo>
                <Campo
                  rotulo="Centro de custo"
                  dica={
                    centros.length === 0
                      ? "Nenhum centro cadastrado nesta empresa — cadastre em Centros de custo."
                      : pessoa.centroOrigem === "linha" && centroId === pessoa.centroId
                        ? "Padrão da linha da tabela salarial."
                        : undefined
                  }
                >
                  <select className={inputCls} disabled={ro || centros.length === 0} value={centroId ?? ""} onChange={(e) => setCentroId(e.target.value || null)}>
                    <option value="">{pessoa.centroOrigem === "linha" ? "Padrão da linha" : "Sem centro de custo"}</option>
                    {centros.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.rotulo}
                      </option>
                    ))}
                  </select>
                </Campo>
              </div>
              <div className="flex flex-wrap gap-x-5 gap-y-1 text-sm">
                <label className="flex items-center gap-2">
                  <input type="checkbox" disabled={ro} checked={cad.adiantamento} onChange={(e) => setC("adiantamento", e.target.checked)} />
                  Recebe adiantamento ({Math.round(parametros.adiantamentoPercentual * 100)}%)
                </label>
                <label className="flex items-center gap-2">
                  <input type="checkbox" disabled={ro} checked={cad.semInss} onChange={(e) => setC("semInss", e.target.checked)} />
                  Sem INSS na folha (diretor)
                </label>
              </div>

              {cad.planoSaude !== "nenhum" && (
                <div className="space-y-1.5 rounded-md border border-border p-2">
                  <div className="text-xs font-medium text-ink-muted">Dependentes no plano de saúde</div>
                  {cad.planoDependentes.length === 0 && <p className="text-xs text-ink-muted">Só o titular.</p>}
                  {cad.planoDependentes.map((d, i) => (
                    <div key={i} className="flex items-center gap-2">
                      <input
                        className={inputCls}
                        disabled={ro}
                        value={d.nome}
                        onChange={(e) =>
                          setC(
                            "planoDependentes",
                            cad.planoDependentes.map((x, j) => (j === i ? { ...x, nome: e.target.value } : x)),
                          )
                        }
                        aria-label="Nome do dependente"
                      />
                      <input
                        type="date"
                        className={`${inputCls} w-40`}
                        disabled={ro}
                        value={d.nascimento ?? ""}
                        onChange={(e) =>
                          setC(
                            "planoDependentes",
                            cad.planoDependentes.map((x, j) => (j === i ? { ...x, nascimento: e.target.value || null } : x)),
                          )
                        }
                        aria-label="Nascimento do dependente"
                      />
                      {!ro && (
                        <button
                          type="button"
                          className="rounded p-1 text-ink-muted hover:text-red-700"
                          onClick={() => setC("planoDependentes", cad.planoDependentes.filter((_, j) => j !== i))}
                          aria-label="Tirar do plano"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      )}
                    </div>
                  ))}
                  {!ro && (
                    <div className="flex flex-wrap gap-1.5 pt-1">
                      {depsSolidesForaDoPlano.map((d) => (
                        <button
                          key={`${d.nome}-${d.nascimento}`}
                          type="button"
                          className="rounded-full border border-border px-2 py-0.5 text-xs hover:bg-muted"
                          onClick={() => setC("planoDependentes", [...cad.planoDependentes, { nome: d.nome, nascimento: d.nascimento }])}
                        >
                          + {d.nome} {d.parentesco ? `(${d.parentesco})` : ""}
                        </button>
                      ))}
                      <button
                        type="button"
                        className="inline-flex items-center gap-1 rounded-full border border-dashed border-border px-2 py-0.5 text-xs hover:bg-muted"
                        onClick={() => setC("planoDependentes", [...cad.planoDependentes, { nome: `Dependente ${cad.planoDependentes.length + 1}`, nascimento: null }])}
                      >
                        <Plus className="h-3 w-3" /> outro
                      </button>
                    </div>
                  )}
                </div>
              )}
            </section>

            <DpRecorrentesEditor
              lista={cad.recorrentes ?? []}
              competencia={competencia}
              disabled={ro}
              onChange={(l) => setC("recorrentes", l)}
            />

            {editavel && (
              <div className="flex justify-end gap-2">
                <button type="button" className="rounded-md border border-input px-3 py-1.5 text-sm hover:bg-muted" disabled={pending} onClick={onClose}>
                  Cancelar
                </button>
                <button
                  type="button"
                  className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
                  disabled={pending}
                  onClick={salvar}
                >
                  {pending ? "Salvando…" : "Salvar"}
                </button>
              </div>
            )}
          </div>

          <section className="space-y-1">
            <h3 className="text-sm font-semibold text-ink-primary">Cálculo {linhaFechada ? "(retrato da folha fechada)" : "(ao vivo)"}</h3>
            <table className="w-full text-sm">
              <tbody>
                {COLUNAS_FOLHA.map((col) => {
                  const v = r[col];
                  const ajustado = col in (r.ajustados ?? {});
                  const soma = SOMAS.includes(col);
                  if (!soma && !ajustado && Math.abs(v) < 0.005 && !r.memoria[col]) return null;
                  return (
                    <tr key={col} className={`border-t border-border align-top ${soma ? "bg-muted/40 font-medium" : ""}`}>
                      <td className="py-1 pr-2 text-ink-primary">
                        {ROTULO_COLUNA[col]}
                        {r.memoria[col] && <div className="text-[11px] font-normal leading-snug text-ink-muted">{r.memoria[col]}</div>}
                        {ajustando === col && (
                          <div className="mt-1 space-y-1 rounded-md border border-border p-2">
                            <div className="grid grid-cols-[8rem_1fr] gap-2">
                              <NumCampo valor={ajValor} onChange={setAjValor} ariaLabel="Valor ajustado" />
                              <input
                                className={inputCls}
                                placeholder="Motivo (obrigatório)"
                                value={ajMotivo}
                                onChange={(e) => setAjMotivo(e.target.value)}
                                maxLength={300}
                              />
                            </div>
                            <div className="flex justify-end gap-2 text-xs">
                              <button type="button" className="hover:underline" onClick={() => setAjustando(null)}>
                                cancelar
                              </button>
                              <button type="button" className="font-medium hover:underline disabled:opacity-50" disabled={!ajMotivo.trim()} onClick={aplicarAjuste}>
                                aplicar ajuste
                              </button>
                            </div>
                          </div>
                        )}
                      </td>
                      <td className={`w-32 py-1 text-right tabular-nums ${ajustado ? "text-amber-700 dark:text-amber-400" : ""}`}>{brl(v)}</td>
                      <td className="w-14 py-1 text-right">
                        {editavel && AJUSTAVEL.has(col) && ajustando !== col && (
                          <span className="inline-flex gap-0.5">
                            <button
                              type="button"
                              className="rounded p-0.5 text-ink-muted hover:text-ink-primary"
                              onClick={() => abrirAjuste(col as DpColunaAjustavel)}
                              aria-label={`Ajustar ${ROTULO_COLUNA[col]}`}
                              title="Ajuste manual"
                            >
                              <Pencil className="h-3.5 w-3.5" />
                            </button>
                            {lanc.ajustes[col as DpColunaAjustavel] && (
                              <button
                                type="button"
                                className="rounded p-0.5 text-ink-muted hover:text-red-700"
                                onClick={() => removerAjuste(col as DpColunaAjustavel)}
                                aria-label={`Tirar ajuste de ${ROTULO_COLUNA[col]}`}
                                title="Voltar ao calculado"
                              >
                                <X className="h-3.5 w-3.5" />
                              </button>
                            )}
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </section>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Proventos e descontos FIXOS da pessoa (consignado, pensão, gratificação):
 * entram sozinhos em todo mês entre o início e o fim. Faz parte do cadastro,
 * então é salvo junto com ele.
 */
function DpRecorrentesEditor({
  lista,
  competencia,
  disabled,
  onChange,
}: {
  lista: DpRecorrente[];
  competencia: string;
  disabled: boolean;
  onChange: (l: DpRecorrente[]) => void;
}) {
  const set = (i: number, patch: Partial<DpRecorrente>) => onChange(lista.map((x, j) => (j === i ? { ...x, ...patch } : x)));
  return (
    <section className="space-y-2">
      <h3 className="text-sm font-semibold text-ink-primary">Proventos e descontos fixos</h3>
      <p className="text-xs text-ink-muted">
        Entram sozinhos todo mês entre o início e o fim (fim vazio = sem prazo). Ex.: consignado 12×, pensão, gratificação.
      </p>
      {lista.length === 0 && <p className="text-xs text-ink-muted">Nenhum.</p>}
      {lista.map((x, i) => (
        <div key={x.id} className="grid grid-cols-2 items-end gap-2 sm:grid-cols-[7rem_1fr_7rem_8rem_8rem_auto]">
          <select className={inputCls} disabled={disabled} value={x.tipo} onChange={(e) => set(i, { tipo: e.target.value as DpRecorrente["tipo"] })} aria-label="Tipo">
            <option value="desconto">Desconto</option>
            <option value="provento">Provento</option>
          </select>
          <input
            className={inputCls}
            disabled={disabled}
            value={x.descricao}
            placeholder="Descrição"
            onChange={(e) => set(i, { descricao: e.target.value })}
            maxLength={120}
            aria-label="Descrição"
          />
          <NumCampo valor={x.valor} onChange={(v) => set(i, { valor: v })} disabled={disabled} ariaLabel="Valor mensal" />
          <input type="month" className={inputCls} disabled={disabled} value={x.inicio} onChange={(e) => set(i, { inicio: e.target.value })} aria-label="Início" />
          <input
            type="month"
            className={inputCls}
            disabled={disabled}
            value={x.fim ?? ""}
            onChange={(e) => set(i, { fim: e.target.value || null })}
            aria-label="Fim (vazio = sem prazo)"
          />
          {!disabled && (
            <button type="button" className="rounded p-1 text-ink-muted hover:text-red-700" onClick={() => onChange(lista.filter((_, j) => j !== i))} aria-label="Remover">
              <Trash2 className="h-4 w-4" />
            </button>
          )}
        </div>
      ))}
      {!disabled && (
        <button
          type="button"
          className="inline-flex items-center gap-1 rounded-full border border-dashed border-border px-2 py-0.5 text-xs hover:bg-muted"
          onClick={() =>
            onChange([...lista, { id: `${Date.now()}`, tipo: "desconto", descricao: "", valor: 0, inicio: competencia, fim: null }])
          }
        >
          <Plus className="h-3 w-3" /> adicionar
        </button>
      )}
    </section>
  );
}
