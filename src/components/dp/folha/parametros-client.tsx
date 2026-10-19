"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Plus, Trash2 } from "lucide-react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useToast } from "@/components/ui/toaster";
import { excluirVigenciaFolha, salvarParametrosFolha } from "@/lib/dp/actions-folha";
import {
  FAIXAS_ETARIAS,
  PARAMETROS_PADRAO,
  PLANO_TIPOS,
  ROTULO_PLANO,
  rotuloCompetencia,
  type DpFolhaParametros,
} from "@/lib/dp/folha/parametros";

import { inputCls, NumCampo } from "./campos";

const pct = (v: number) => Math.round(v * 1e6) / 1e4; // 0.075 → 7.5
const dePct = (v: number) => Math.round(v * 1e4) / 1e6; // 7.5 → 0.075

function Secao({ titulo, children, nota }: { titulo: string; children: React.ReactNode; nota?: string }) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">{titulo}</CardTitle>
        {nota && <p className="text-xs text-ink-muted">{nota}</p>}
      </CardHeader>
      <CardContent className="space-y-2 text-sm">{children}</CardContent>
    </Card>
  );
}

function Rot({ t, children }: { t: string; children: React.ReactNode }) {
  return (
    <label className="block space-y-0.5">
      <span className="text-xs font-medium text-ink-muted">{t}</span>
      {children}
    </label>
  );
}

/**
 * Parâmetros da folha por VIGÊNCIA. Mexer numa vigência muda os meses ABERTOS
 * que a usam; os fechados guardam os parâmetros com que foram fechados.
 */
export function DpParametrosFolhaClient({
  vigencias,
  empresas,
  hoje,
}: {
  vigencias: Array<{ vigencia: string; dados: DpFolhaParametros; updatedAt: string }>;
  empresas: Array<{ id: string; name: string }>;
  hoje: string;
}) {
  const ultima = vigencias[vigencias.length - 1] ?? null;
  const [vig, setVig] = useState<string>(ultima?.vigencia ?? hoje);
  const [p, setP] = useState<DpFolhaParametros>(() => structuredClone(ultima?.dados ?? PARAMETROS_PADRAO));
  const [nova, setNova] = useState(!ultima);
  const [pending, start] = useTransition();
  const router = useRouter();
  const { showToast } = useToast();

  const escolher = (v: string) => {
    const x = vigencias.find((y) => y.vigencia === v);
    if (!x) return;
    setVig(v);
    setP(structuredClone(x.dados));
    setNova(false);
  };

  const salvar = () =>
    start(async () => {
      const res = await salvarParametrosFolha({ vigencia: vig, dados: p });
      if (!res.ok) showToast({ title: "Não salvo", description: res.error, variant: "destructive" });
      else {
        showToast({ title: "Parâmetros salvos", description: `Vigência a partir de ${rotuloCompetencia(vig)}.`, variant: "success" });
        setNova(false);
        router.refresh();
      }
    });

  const excluir = () =>
    start(async () => {
      const res = await excluirVigenciaFolha({ vigencia: vig });
      if (!res.ok) showToast({ title: "Não excluído", description: res.error, variant: "destructive" });
      else router.refresh();
    });

  const up = (f: (x: DpFolhaParametros) => void) =>
    setP((x) => {
      const y = structuredClone(x);
      f(y);
      return y;
    });

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="flex flex-wrap items-end gap-3 py-4 text-sm">
          <Rot t="Vigência">
            <select className={`${inputCls} w-52`} value={nova ? "" : vig} onChange={(e) => escolher(e.target.value)} disabled={vigencias.length === 0}>
              {nova && <option value="">Nova vigência</option>}
              {vigencias.map((v) => (
                <option key={v.vigencia} value={v.vigencia}>
                  a partir de {rotuloCompetencia(v.vigencia)}
                </option>
              ))}
            </select>
          </Rot>
          {nova ? (
            <Rot t="Começa em">
              <input type="month" className={`${inputCls} w-44`} value={vig} onChange={(e) => setVig(e.target.value)} />
            </Rot>
          ) : (
            <button type="button" className="rounded-md border border-input px-3 py-1.5 hover:bg-muted" onClick={() => { setNova(true); setVig(hoje); }}>
              <Plus className="mr-1 inline h-4 w-4" />
              Nova vigência (copiando esta)
            </button>
          )}
          <div className="ml-auto flex gap-2">
            {!nova && vigencias.length > 0 && (
              <button type="button" disabled={pending} onClick={excluir} className="rounded-md border border-red-300 px-3 py-1.5 text-red-700 hover:bg-red-50 disabled:opacity-50 dark:border-red-900 dark:text-red-400">
                Excluir vigência
              </button>
            )}
            <button type="button" disabled={pending || !vig} onClick={salvar} className="rounded-md bg-primary px-3 py-1.5 font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50">
              {pending ? "Salvando…" : "Salvar"}
            </button>
          </div>
          {vigencias.length === 0 && (
            <p className="w-full text-xs text-amber-700 dark:text-amber-400">
              Nenhuma vigência cadastrada: a folha está usando o padrão do sistema (estes valores). Salve para assumir os parâmetros.
            </p>
          )}
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Secao titulo="INSS (empregado)" nota="Progressivo por faixa; a última faixa é o teto.">
          {p.inss.map((f, i) => (
            <div key={i} className="grid grid-cols-[1fr_7rem_auto] items-center gap-2">
              <NumCampo valor={f.ate} onChange={(v) => up((x) => { x.inss[i].ate = v; })} ariaLabel={`Até, faixa ${i + 1}`} />
              <NumCampo valor={pct(f.aliquota)} onChange={(v) => up((x) => { x.inss[i].aliquota = dePct(v); })} sufixo="%" casas={4} ariaLabel={`Alíquota, faixa ${i + 1}`} />
              <button type="button" className="p-1 text-ink-muted hover:text-red-700" onClick={() => up((x) => { x.inss.splice(i, 1); })} aria-label="Remover faixa">
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
          ))}
          <button type="button" className="text-xs hover:underline" onClick={() => up((x) => { x.inss.push({ ate: (x.inss[x.inss.length - 1]?.ate ?? 0) + 1000, aliquota: 0.14 }); })}>
            + faixa
          </button>
        </Secao>

        <Secao titulo="IRRF" nota="Tabela progressiva mensal; a última faixa não tem teto. O redutor da Lei 15.270/2025 é aplicado sobre o rendimento tributável bruto do mês.">
          {p.irrf.faixas.map((f, i) => (
            <div key={i} className="grid grid-cols-[1fr_6rem_7rem_auto] items-center gap-2">
              {i === p.irrf.faixas.length - 1 ? (
                <span className="text-xs text-ink-muted">acima da anterior</span>
              ) : (
                <NumCampo valor={f.ate ?? 0} onChange={(v) => up((x) => { x.irrf.faixas[i].ate = v; })} ariaLabel={`Até, faixa ${i + 1}`} />
              )}
              <NumCampo valor={pct(f.aliquota)} onChange={(v) => up((x) => { x.irrf.faixas[i].aliquota = dePct(v); })} sufixo="%" casas={4} ariaLabel="Alíquota" />
              <NumCampo valor={f.deducao} onChange={(v) => up((x) => { x.irrf.faixas[i].deducao = v; })} ariaLabel="Parcela a deduzir" />
              <button type="button" className="p-1 text-ink-muted hover:text-red-700" onClick={() => up((x) => { x.irrf.faixas.splice(i, 1); })} aria-label="Remover faixa">
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
          ))}
          <div className="grid grid-cols-2 gap-2 pt-1">
            <Rot t="Dedução por dependente">
              <NumCampo valor={p.irrf.deducaoDependente} onChange={(v) => up((x) => { x.irrf.deducaoDependente = v; })} />
            </Rot>
            <Rot t="Desconto simplificado mensal">
              <NumCampo valor={p.irrf.descontoSimplificado} onChange={(v) => up((x) => { x.irrf.descontoSimplificado = v; })} />
            </Rot>
          </div>
          <label className="flex items-center gap-2 pt-1">
            <input
              type="checkbox"
              checked={p.irrf.redutor !== null}
              onChange={(e) => up((x) => { x.irrf.redutor = e.target.checked ? structuredClone(PARAMETROS_PADRAO.irrf.redutor) : null; })}
            />
            Aplicar o redutor mensal (Lei 15.270/2025)
          </label>
          {p.irrf.redutor && (
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              <Rot t="Isenção até">
                <NumCampo valor={p.irrf.redutor.limiteIsencao} onChange={(v) => up((x) => { x.irrf.redutor!.limiteIsencao = v; })} />
              </Rot>
              <Rot t="Redução máxima">
                <NumCampo valor={p.irrf.redutor.reducaoMaxima} onChange={(v) => up((x) => { x.irrf.redutor!.reducaoMaxima = v; })} />
              </Rot>
              <Rot t="Redução parcial até">
                <NumCampo valor={p.irrf.redutor.limiteReducao} onChange={(v) => up((x) => { x.irrf.redutor!.limiteReducao = v; })} />
              </Rot>
              <Rot t="Constante (R$)">
                <NumCampo valor={p.irrf.redutor.a} onChange={(v) => up((x) => { x.irrf.redutor!.a = v; })} />
              </Rot>
              <Rot t="Fator × rendimento">
                <NumCampo valor={p.irrf.redutor.b} onChange={(v) => up((x) => { x.irrf.redutor!.b = v; })} casas={6} />
              </Rot>
            </div>
          )}
        </Secao>

        <Secao titulo="Percentuais e salário-família">
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            <Rot t="FGTS">
              <NumCampo valor={pct(p.fgtsPercentual)} onChange={(v) => up((x) => { x.fgtsPercentual = dePct(v); })} sufixo="%" />
            </Rot>
            <Rot t="FGTS do jovem aprendiz">
              <NumCampo valor={pct(p.fgtsAprendizPercentual)} onChange={(v) => up((x) => { x.fgtsAprendizPercentual = dePct(v); })} sufixo="%" />
            </Rot>
            <Rot t="Desconto de VT">
              <NumCampo valor={pct(p.vtPercentual)} onChange={(v) => up((x) => { x.vtPercentual = dePct(v); })} sufixo="%" />
            </Rot>
            <Rot t="Adiantamento">
              <NumCampo valor={pct(p.adiantamentoPercentual)} onChange={(v) => up((x) => { x.adiantamentoPercentual = dePct(v); })} sufixo="%" />
            </Rot>
            <Rot t="Salário-família (cota)">
              <NumCampo valor={p.salarioFamilia.cota} onChange={(v) => up((x) => { x.salarioFamilia.cota = v; })} />
            </Rot>
            <Rot t="Limite de remuneração">
              <NumCampo valor={p.salarioFamilia.limiteRemuneracao ?? 0} onChange={(v) => up((x) => { x.salarioFamilia.limiteRemuneracao = v > 0 ? v : null; })} />
            </Rot>
            <Rot t="Odonto por vida">
              <NumCampo valor={p.odontoPorVida} onChange={(v) => up((x) => { x.odontoPorVida = v; })} />
            </Rot>
          </div>
        </Secao>

        <Secao titulo="Prêmio de férias" nota="Na planilha a fórmula apontava para uma empresa que saiu da lista (#REF!). Marque quem paga; o valor é informativo e não entra no saldo.">
          <Rot t="Percentual sobre férias + 1/3">
            <NumCampo valor={pct(p.premioFerias.percentual)} onChange={(v) => up((x) => { x.premioFerias.percentual = dePct(v); })} sufixo="%" className="w-32" />
          </Rot>
          <div className="grid max-h-40 grid-cols-1 gap-1 overflow-y-auto sm:grid-cols-2">
            {empresas.map((e) => (
              <label key={e.id} className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={p.premioFerias.empresas.includes(e.id)}
                  onChange={(ev) =>
                    up((x) => {
                      x.premioFerias.empresas = ev.target.checked ? [...x.premioFerias.empresas, e.id] : x.premioFerias.empresas.filter((y) => y !== e.id);
                    })
                  }
                />
                {e.name}
              </label>
            ))}
          </div>
        </Secao>
      </div>

      <Secao titulo="Plano de saúde (mensalidade por faixa etária)" nota="Idade em anos completos no 1º dia da competência.">
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={p.empresaPagaAmbulatorialTitular} onChange={(e) => up((x) => { x.empresaPagaAmbulatorialTitular = e.target.checked; })} />
          A empresa paga o valor do Ambulatorial do titular (o colaborador paga a diferença e os dependentes)
        </label>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[560px] text-sm">
            <thead className="text-left text-ink-muted">
              <tr>
                <th className="py-1 pr-2 font-medium">Faixa</th>
                {PLANO_TIPOS.map((t) => (
                  <th key={t} className="py-1 pr-2 font-medium">
                    {ROTULO_PLANO[t]}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {FAIXAS_ETARIAS.map((f, i) => (
                <tr key={f}>
                  <td className="py-0.5 pr-2 text-ink-primary">{f}</td>
                  {PLANO_TIPOS.map((t) => (
                    <td key={t} className="py-0.5 pr-2">
                      <NumCampo valor={p.planos[t][i]} onChange={(v) => up((x) => { x.planos[t][i] = v; })} casas={4} ariaLabel={`${ROTULO_PLANO[t]} ${f}`} />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Secao>

      <div className="grid gap-4 lg:grid-cols-3">
        <ListaNomeValor
          titulo="Bilhetes de transporte (R$ por dia)"
          itens={p.bilhetes.map((b) => ({ nome: b.nome, valor: b.valorDiario }))}
          onChange={(l) => up((x) => { x.bilhetes = l.map((b) => ({ nome: b.nome, valorDiario: b.valor })); })}
        />
        <ListaNomeValor
          titulo="Escalas (dias de VT no mês)"
          itens={p.escalas.map((e) => ({ nome: e.nome, valor: e.diasMes }))}
          onChange={(l) => up((x) => { x.escalas = l.map((e) => ({ nome: e.nome, diasMes: e.valor })); })}
          casas={0}
        />
        <ListaNomeValor
          titulo="Opções de alimentação (R$ mensal)"
          itens={p.alimentacoes}
          onChange={(l) => up((x) => { x.alimentacoes = l; })}
        />
      </div>
    </div>
  );
}

function ListaNomeValor({
  titulo,
  itens,
  onChange,
  casas = 2,
}: {
  titulo: string;
  itens: Array<{ nome: string; valor: number }>;
  onChange: (l: Array<{ nome: string; valor: number }>) => void;
  casas?: number;
}) {
  return (
    <Secao titulo={titulo}>
      {itens.map((it, i) => (
        <div key={i} className="grid grid-cols-[1fr_6rem_auto] items-center gap-2">
          <input className={inputCls} value={it.nome} onChange={(e) => onChange(itens.map((x, j) => (j === i ? { ...x, nome: e.target.value } : x)))} aria-label="Nome" />
          <NumCampo valor={it.valor} onChange={(v) => onChange(itens.map((x, j) => (j === i ? { ...x, valor: v } : x)))} casas={casas} ariaLabel="Valor" />
          <button type="button" className="p-1 text-ink-muted hover:text-red-700" onClick={() => onChange(itens.filter((_, j) => j !== i))} aria-label="Remover">
            <Trash2 className="h-4 w-4" />
          </button>
        </div>
      ))}
      <button type="button" className="text-xs hover:underline" onClick={() => onChange([...itens, { nome: "", valor: 0 }])}>
        + adicionar
      </button>
    </Secao>
  );
}
