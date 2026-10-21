"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, FileSearch, Upload } from "lucide-react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useToast } from "@/components/ui/toaster";
import { conferirContabilidade, lancarValoresPlanilha, lerColunasPlanilha, type DpValoresPlanilhaResumo } from "@/lib/dp/actions-folha-planilhas";
import {
  CAMPOS_CONFERENCIA,
  CAMPOS_VALORES,
  ROTULO_CONFERENCIA,
  ROTULO_VALOR,
  type DpCampoConferencia,
  type DpCampoValor,
  type DpResultadoConferencia,
} from "@/lib/dp/folha/planilha-generica";

import { inputCls } from "./campos";
import { brl } from "./formato";

const btn = "inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium disabled:opacity-50";
const primario = `${btn} bg-primary text-primary-foreground hover:bg-primary/90`;

function SeletorColuna({ cabecalho, valor, onChange, vazio = "—", rotulo }: { cabecalho: string[]; valor: string; onChange: (v: string) => void; vazio?: string; rotulo: string }) {
  return (
    <select className={inputCls} value={valor} onChange={(e) => onChange(e.target.value)} aria-label={rotulo}>
      <option value="">{vazio}</option>
      {cabecalho.filter(Boolean).map((c) => (
        <option key={c} value={c}>
          {c}
        </option>
      ))}
    </select>
  );
}

function useArquivo(companyId: string, tipo: "contabilidade" | "valores", aoLer: (cab: string[], m: Record<string, unknown>, salvo: boolean) => void) {
  const [file, setFile] = useState<File | null>(null);
  const [cabecalho, setCabecalho] = useState<string[]>([]);
  const [linhas, setLinhas] = useState(0);
  const [pending, start] = useTransition();
  const { showToast } = useToast();
  const escolher = (f: File | null) => {
    setFile(f);
    setCabecalho([]);
    if (!f) return;
    start(async () => {
      const fd = new FormData();
      fd.set("companyId", companyId);
      fd.set("tipo", tipo);
      fd.set("file", f);
      const res = await lerColunasPlanilha(fd);
      if (!res.ok) {
        showToast({ title: "Não consegui ler a planilha", description: res.error, variant: "destructive" });
        return;
      }
      setCabecalho(res.data.cabecalho);
      setLinhas(res.data.linhas);
      aoLer(res.data.cabecalho, res.data.mapeamento, res.data.salvo);
    });
  };
  return { file, cabecalho, linhas, lendo: pending, escolher };
}

/**
 * CONFERÊNCIA com a folha da contabilidade. O DP sobe o resumo que a
 * contabilidade mandou, aponta as colunas (só na primeira vez — o mapeamento
 * fica guardado para a empresa) e vê só o que difere, pessoa a pessoa.
 */
export function DpConferenciaContabilidade({ companyId, competencia }: { companyId: string; competencia: string }) {
  const [identificador, setIdentificador] = useState("");
  const [tipoId, setTipoId] = useState<"cpf" | "nome">("cpf");
  const [campos, setCampos] = useState<Partial<Record<DpCampoConferencia, string>>>({});
  const [tolerancia, setTolerancia] = useState("0,05");
  const [salvo, setSalvo] = useState(false);
  const [resultado, setResultado] = useState<DpResultadoConferencia | null>(null);
  const [filtro, setFiltro] = useState<DpCampoConferencia | "">("");
  const [pending, start] = useTransition();
  const { showToast } = useToast();
  const arq = useArquivo(companyId, "contabilidade", (_cab, m, s) => {
    setIdentificador(String(m.identificador ?? ""));
    setTipoId(m.tipoIdentificador === "nome" ? "nome" : "cpf");
    setCampos((m.campos as Partial<Record<DpCampoConferencia, string>>) ?? {});
    setSalvo(s);
    setResultado(null);
  });

  const rodar = () => {
    if (!arq.file) return;
    start(async () => {
      const fd = new FormData();
      fd.set("companyId", companyId);
      fd.set("competencia", competencia);
      fd.set("file", arq.file!);
      fd.set("mapeamento", JSON.stringify({ identificador, tipoIdentificador: tipoId, campos }));
      fd.set("tolerancia", tolerancia);
      const res = await conferirContabilidade(fd);
      if (!res.ok) {
        showToast({ title: "Conferência não concluída", description: res.error, variant: "destructive" });
        return;
      }
      setResultado(res.data);
    });
  };

  const pessoasComDif = useMemo(() => new Set(resultado?.diferencas.map((d) => d.solidesId) ?? []).size, [resultado]);
  const difs = (resultado?.diferencas ?? []).filter((d) => !filtro || d.campo === filtro);

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-base">
          <FileSearch className="h-4 w-4" /> Conferir com a folha da contabilidade
        </CardTitle>
        <p className="text-xs text-ink-muted">
          Suba o resumo da folha que a contabilidade mandou (Excel ou CSV; PDF não é lido). O sistema compara pessoa a pessoa e mostra só
          o que difere. Nada do arquivo é guardado — só quais colunas são o quê, para o mês seguinte.
        </p>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        <input type="file" accept=".xlsx,.xls,.csv" onChange={(e) => arq.escolher(e.target.files?.[0] ?? null)} />
        {arq.lendo && <p className="text-ink-muted">Lendo a planilha…</p>}
        {arq.cabecalho.length > 0 && (
          <div className="space-y-3 rounded-md border border-border p-3">
            <p className="text-xs text-ink-muted">
              {arq.linhas} linha(s) de dados. {salvo ? "Colunas apontadas como da última vez — confira." : "Colunas sugeridas pelo nome do cabeçalho — confira."}
            </p>
            <div className="grid gap-2 sm:grid-cols-3">
              <label className="space-y-0.5">
                <span className="text-xs font-medium text-ink-muted">Quem é a pessoa</span>
                <SeletorColuna cabecalho={arq.cabecalho} valor={identificador} onChange={setIdentificador} vazio="Escolha a coluna" rotulo="Coluna da pessoa" />
              </label>
              <label className="space-y-0.5">
                <span className="text-xs font-medium text-ink-muted">Essa coluna traz</span>
                <select className={inputCls} value={tipoId} onChange={(e) => setTipoId(e.target.value === "nome" ? "nome" : "cpf")}>
                  <option value="cpf">CPF</option>
                  <option value="nome">Nome</option>
                </select>
              </label>
              <label className="space-y-0.5">
                <span className="text-xs font-medium text-ink-muted">Diferença tolerada (R$)</span>
                <input className={inputCls} value={tolerancia} onChange={(e) => setTolerancia(e.target.value)} inputMode="decimal" />
              </label>
            </div>
            <div className="grid gap-2 sm:grid-cols-3 lg:grid-cols-4">
              {CAMPOS_CONFERENCIA.map((k) => (
                <label key={k} className="space-y-0.5">
                  <span className="text-xs text-ink-muted">{ROTULO_CONFERENCIA[k]}</span>
                  <SeletorColuna
                    cabecalho={arq.cabecalho}
                    valor={campos[k] ?? ""}
                    onChange={(v) => setCampos((c) => ({ ...c, [k]: v || undefined }))}
                    vazio="não conferir"
                    rotulo={ROTULO_CONFERENCIA[k]}
                  />
                </label>
              ))}
            </div>
            <button type="button" className={primario} disabled={pending || !identificador} onClick={rodar}>
              <FileSearch className="h-4 w-4" /> {pending ? "Conferindo…" : "Conferir"}
            </button>
          </div>
        )}

        {resultado && (
          <div className="space-y-3">
            <div className="flex flex-wrap gap-2 text-xs">
              <span className="rounded bg-muted px-2 py-1">{resultado.conferidas} pessoa(s) conferida(s)</span>
              <span className="inline-flex items-center gap-1 rounded bg-emerald-500/10 px-2 py-1 text-emerald-800 dark:text-emerald-300">
                <CheckCircle2 className="h-3 w-3" /> {resultado.semDiferenca} sem diferença
              </span>
              {pessoasComDif > 0 && <span className="rounded bg-amber-500/10 px-2 py-1 text-amber-800 dark:text-amber-300">{pessoasComDif} com diferença</span>}
              {resultado.soNaFolha.length > 0 && <span className="rounded bg-muted px-2 py-1">{resultado.soNaFolha.length} só na folha daqui</span>}
              {resultado.soNaPlanilha.length > 0 && <span className="rounded bg-muted px-2 py-1">{resultado.soNaPlanilha.length} só na contabilidade</span>}
              {resultado.repetidas > 0 && <span className="rounded bg-muted px-2 py-1">{resultado.repetidas} em várias linhas (somadas)</span>}
            </div>

            <table className="w-full text-sm">
              <thead className="text-left text-ink-muted">
                <tr className="border-b border-border">
                  <th className="py-1.5 pr-2 font-medium">Total de</th>
                  <th className="py-1.5 pr-2 text-right font-medium">Folha daqui</th>
                  <th className="py-1.5 pr-2 text-right font-medium">Contabilidade</th>
                  <th className="py-1.5 text-right font-medium">Diferença</th>
                </tr>
              </thead>
              <tbody>
                {resultado.totais.map((t) => {
                  const d = Math.round((t.folha - t.planilha) * 100) / 100;
                  return (
                    <tr key={t.campo} className="border-b border-border">
                      <td className="py-1 pr-2">{ROTULO_CONFERENCIA[t.campo]}</td>
                      <td className="py-1 pr-2 text-right tabular-nums">{brl(t.folha)}</td>
                      <td className="py-1 pr-2 text-right tabular-nums">{brl(t.planilha)}</td>
                      <td className={`py-1 text-right tabular-nums ${Math.abs(d) > 0.05 ? "font-medium text-amber-700 dark:text-amber-400" : "text-ink-muted"}`}>{brl(d)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>

            {resultado.diferencas.length > 0 && (
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <span className="font-medium text-ink-primary">Diferenças ({difs.length})</span>
                  <select className={`${inputCls} w-56`} value={filtro} onChange={(e) => setFiltro(e.target.value as DpCampoConferencia | "")}>
                    <option value="">Todos os campos</option>
                    {Array.from(new Set(resultado.diferencas.map((d) => d.campo))).map((c) => (
                      <option key={c} value={c}>
                        {ROTULO_CONFERENCIA[c]}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="max-h-96 overflow-y-auto">
                  <table className="w-full text-sm">
                    <thead className="sticky top-0 bg-card text-left text-ink-muted">
                      <tr className="border-b border-border">
                        <th className="py-1.5 pr-2 font-medium">Pessoa</th>
                        <th className="py-1.5 pr-2 font-medium">Campo</th>
                        <th className="py-1.5 pr-2 text-right font-medium">Folha daqui</th>
                        <th className="py-1.5 pr-2 text-right font-medium">Contabilidade</th>
                        <th className="py-1.5 text-right font-medium">Diferença</th>
                      </tr>
                    </thead>
                    <tbody>
                      {difs.map((d, i) => (
                        <tr key={`${d.solidesId}-${d.campo}-${i}`} className="border-b border-border">
                          <td className="py-1 pr-2 text-ink-primary">{d.nome}</td>
                          <td className="py-1 pr-2">{ROTULO_CONFERENCIA[d.campo]}</td>
                          <td className="py-1 pr-2 text-right tabular-nums">{brl(d.folha)}</td>
                          <td className="py-1 pr-2 text-right tabular-nums">{brl(d.planilha)}</td>
                          <td className="py-1 text-right font-medium tabular-nums">{brl(d.diferenca)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
            {(resultado.soNaFolha.length > 0 || resultado.soNaPlanilha.length > 0 || resultado.ambiguas.length > 0) && (
              <details className="text-xs">
                <summary className="cursor-pointer text-ink-muted">Quem está de um lado só</summary>
                {resultado.soNaFolha.length > 0 && <p className="mt-1">Só na folha daqui: {resultado.soNaFolha.join(" · ")}</p>}
                {resultado.soNaPlanilha.length > 0 && <p className="mt-1">Só na contabilidade: {resultado.soNaPlanilha.join(" · ")}</p>}
                {resultado.ambiguas.length > 0 && <p className="mt-1">Nome com mais de um candidato: {resultado.ambiguas.join(" · ")}</p>}
              </details>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

/**
 * Valores do mês vindos de FORA (fatura da operadora, relatório de comissões):
 * uma coluna da planilha entra num campo do mês de cada pessoa, com prévia.
 */
export function DpValoresPlanilha({ companyId, competencia, editavel }: { companyId: string; competencia: string; editavel: boolean }) {
  const [identificador, setIdentificador] = useState("");
  const [tipoId, setTipoId] = useState<"cpf" | "nome">("cpf");
  const [coluna, setColuna] = useState("");
  const [campo, setCampo] = useState<DpCampoValor>("coparticipacao");
  const [modo, setModo] = useState<"substituir" | "somar">("substituir");
  const [resumo, setResumo] = useState<DpValoresPlanilhaResumo | null>(null);
  const [pending, start] = useTransition();
  const router = useRouter();
  const { showToast } = useToast();
  const arq = useArquivo(companyId, "valores", (_cab, m) => {
    setIdentificador(String(m.identificador ?? ""));
    setTipoId(m.tipoIdentificador === "nome" ? "nome" : "cpf");
    if (m.coluna) setColuna(String(m.coluna));
    if (m.campo && (CAMPOS_VALORES as readonly string[]).includes(String(m.campo))) setCampo(m.campo as DpCampoValor);
    if (m.modo === "somar") setModo("somar");
    setResumo(null);
  });

  const enviar = (confirmar: boolean) => {
    if (!arq.file) return;
    start(async () => {
      const fd = new FormData();
      fd.set("companyId", companyId);
      fd.set("competencia", competencia);
      fd.set("file", arq.file!);
      fd.set("mapeamento", JSON.stringify({ identificador, tipoIdentificador: tipoId, coluna, campo, modo }));
      fd.set("confirmar", confirmar ? "1" : "0");
      const res = await lancarValoresPlanilha(fd);
      if (!res.ok) {
        showToast({ title: "Não concluído", description: res.error, variant: "destructive" });
        return;
      }
      setResumo(res.data);
      if (res.data.aplicado) {
        showToast({ title: "Valores lançados", description: `${res.data.mudancas.length} pessoa(s) atualizadas.`, variant: "success" });
        router.refresh();
      }
    });
  };

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-base">
          <Upload className="h-4 w-4" /> Lançar valores de uma planilha
        </CardTitle>
        <p className="text-xs text-ink-muted">
          Para o que chega de fora todo mês — a fatura da operadora (coparticipação), o relatório de comissões. Uma coluna da planilha entra
          num campo do mês de cada pessoa. Os ajustes manuais são preservados.
        </p>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        {!editavel ? (
          <p className="text-ink-muted">A folha deste mês está fechada.</p>
        ) : (
          <>
            <input type="file" accept=".xlsx,.xls,.csv" onChange={(e) => arq.escolher(e.target.files?.[0] ?? null)} />
            {arq.lendo && <p className="text-ink-muted">Lendo a planilha…</p>}
            {arq.cabecalho.length > 0 && (
              <div className="space-y-3 rounded-md border border-border p-3">
                <div className="grid gap-2 sm:grid-cols-3">
                  <label className="space-y-0.5">
                    <span className="text-xs font-medium text-ink-muted">Quem é a pessoa</span>
                    <SeletorColuna cabecalho={arq.cabecalho} valor={identificador} onChange={setIdentificador} vazio="Escolha a coluna" rotulo="Coluna da pessoa" />
                  </label>
                  <label className="space-y-0.5">
                    <span className="text-xs font-medium text-ink-muted">Essa coluna traz</span>
                    <select className={inputCls} value={tipoId} onChange={(e) => setTipoId(e.target.value === "nome" ? "nome" : "cpf")}>
                      <option value="cpf">CPF</option>
                      <option value="nome">Nome</option>
                    </select>
                  </label>
                  <label className="space-y-0.5">
                    <span className="text-xs font-medium text-ink-muted">Coluna do valor</span>
                    <SeletorColuna cabecalho={arq.cabecalho} valor={coluna} onChange={setColuna} vazio="Escolha a coluna" rotulo="Coluna do valor" />
                  </label>
                  <label className="space-y-0.5">
                    <span className="text-xs font-medium text-ink-muted">Entra em</span>
                    <select className={inputCls} value={campo} onChange={(e) => setCampo(e.target.value as DpCampoValor)}>
                      {CAMPOS_VALORES.map((k) => (
                        <option key={k} value={k}>
                          {ROTULO_VALOR[k]}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="space-y-0.5">
                    <span className="text-xs font-medium text-ink-muted">Se já houver valor no mês</span>
                    <select className={inputCls} value={modo} onChange={(e) => setModo(e.target.value === "somar" ? "somar" : "substituir")}>
                      <option value="substituir">Substituir</option>
                      <option value="somar">Somar ao que já está</option>
                    </select>
                  </label>
                </div>
                <div className="flex gap-2">
                  <button type="button" className={`${btn} border border-input hover:bg-muted`} disabled={pending || !identificador || !coluna} onClick={() => enviar(false)}>
                    {pending ? "Lendo…" : "Ver prévia"}
                  </button>
                  {resumo && !resumo.aplicado && resumo.mudancas.length > 0 && (
                    <button type="button" className={primario} disabled={pending} onClick={() => enviar(true)}>
                      Lançar em {resumo.mudancas.length} pessoa(s)
                    </button>
                  )}
                </div>
              </div>
            )}
            {resumo && (
              <div className="space-y-2">
                <p className="text-ink-muted">
                  {resumo.aplicado ? "Lançado" : "Prévia"}: {resumo.mudancas.length} pessoa(s) com valor novo em {ROTULO_VALOR[resumo.campo]}
                  {resumo.repetidas > 0 && ` · ${resumo.repetidas} em várias linhas (somadas)`}
                  {resumo.naoEncontradas.length > 0 && ` · ${resumo.naoEncontradas.length} não encontrada(s)`}
                </p>
                {resumo.mudancas.length > 0 && (
                  <div className="max-h-72 overflow-y-auto">
                    <table className="w-full text-sm">
                      <thead className="sticky top-0 bg-card text-left text-ink-muted">
                        <tr className="border-b border-border">
                          <th className="py-1 pr-2 font-medium">Pessoa</th>
                          <th className="py-1 pr-2 text-right font-medium">Antes</th>
                          <th className="py-1 text-right font-medium">Depois</th>
                        </tr>
                      </thead>
                      <tbody>
                        {resumo.mudancas.map((x) => (
                          <tr key={x.nome} className="border-b border-border">
                            <td className="py-1 pr-2">{x.nome}</td>
                            <td className="py-1 pr-2 text-right tabular-nums text-ink-muted">{x.antes === null ? "—" : x.antes.toLocaleString("pt-BR")}</td>
                            <td className="py-1 text-right font-medium tabular-nums">{x.depois.toLocaleString("pt-BR")}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
                {(resumo.naoEncontradas.length > 0 || resumo.ambiguas.length > 0) && (
                  <details className="text-xs">
                    <summary className="cursor-pointer text-ink-muted">Não lançados</summary>
                    {resumo.naoEncontradas.length > 0 && <p className="mt-1">Não encontrados na folha: {resumo.naoEncontradas.join(" · ")}</p>}
                    {resumo.ambiguas.length > 0 && <p className="mt-1">Nome com mais de um candidato: {resumo.ambiguas.join(" · ")}</p>}
                  </details>
                )}
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
