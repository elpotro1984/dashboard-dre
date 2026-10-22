"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ChevronLeft, ChevronRight } from "lucide-react";

import { Card, CardContent } from "@/components/ui/card";
import { useToast } from "@/components/ui/toaster";
import { NumCampo, inputCls } from "@/components/dp/folha/campos";
import { formatDateTimeBR } from "@/lib/ctrl/datetime";
import { salvarEncargosEmpresa, voltarEncargosAoPadrao } from "@/lib/dp/actions-config";
import { ENCARGOS_PATRONAIS, REGIMES_TRIBUTARIOS, ROTULO_REGIME, type DpEncargoPatronal } from "@/lib/dp/encargos-config";
import { ENCARGOS, encargosPadrao, type EncargoValues } from "@/lib/orcamento/encargos";

export interface DpEncargosEmpresaDados {
  companyId: string;
  ano: number;
  regime: string | null;
  /** Há linha gravada para ESTE ano. */
  temLinha: boolean;
  /** As alíquotas que valem neste ano (a linha do ano, a mais recente ou o padrão). */
  values: EncargoValues;
  /** De que ano vieram as alíquotas (null = padrão do regime). */
  anoUsado: number | null;
  anos: number[];
  atualizadoEm: string | null;
  instalado: boolean;
}

const pp = (v: number) => `${v.toLocaleString("pt-BR", { maximumFractionDigits: 4 })}%`;
const meta = (k: DpEncargoPatronal) => ENCARGOS.find((e) => e.key === k)!;

export function DpEncargosEmpresaClient({ dados, gestor }: { dados: DpEncargosEmpresaDados; gestor: boolean }) {
  const [regime, setRegime] = useState<string | null>(dados.regime);
  const [v, setV] = useState<Record<DpEncargoPatronal, number>>({
    inss_patronal: dados.values.inss_patronal,
    rat_fap: dados.values.rat_fap,
    terceiros: dados.values.terceiros,
  });
  const [pending, start] = useTransition();
  const router = useRouter();
  const { showToast } = useToast();
  const total = ENCARGOS_PATRONAIS.reduce((s, k) => s + v[k], 0);

  const origem = dados.temLinha
    ? `Alíquotas cadastradas para ${dados.ano}${dados.atualizadoEm ? ` (atualizadas em ${formatDateTimeBR(dados.atualizadoEm)})` : ""}.`
    : dados.anoUsado !== null
      ? `Sem alíquotas para ${dados.ano}: o DP usa as de ${dados.anoUsado}, as mais recentes cadastradas. Salvar cria as de ${dados.ano}.`
      : `Sem alíquotas cadastradas: vale o padrão do regime ${regime === "simples_nacional" ? "Simples Nacional" : "normal"}.`;

  const executar = (fn: () => Promise<{ ok: boolean; error?: string }>, ok: string) =>
    start(async () => {
      const res = await fn();
      if (!res.ok) showToast({ title: "Não salvo", description: res.error, variant: "destructive" });
      else showToast({ title: ok, variant: "success" });
      router.refresh();
    });

  if (!dados.instalado) return <p className="text-sm text-ink-muted">O cadastro de encargos do Orçamento não está instalado no banco.</p>;

  return (
    <Card>
      <CardContent className="space-y-4 py-4">
        <div className="flex items-center gap-2">
          <Link href={`?ano=${dados.ano - 1}`} className="rounded-md border border-input p-1.5 hover:bg-muted" aria-label="Ano anterior">
            <ChevronLeft className="h-4 w-4" />
          </Link>
          <span className="min-w-14 text-center text-lg font-semibold text-ink-primary">{dados.ano}</span>
          <Link href={`?ano=${dados.ano + 1}`} className="rounded-md border border-input p-1.5 hover:bg-muted" aria-label="Próximo ano">
            <ChevronRight className="h-4 w-4" />
          </Link>
          {dados.anos.length > 0 && <span className="ml-2 text-xs text-ink-muted">Anos cadastrados: {dados.anos.join(", ")}</span>}
        </div>
        <p className="text-sm text-ink-muted">{origem}</p>

        <label className="block max-w-xs space-y-0.5">
          <span className="text-xs font-medium text-ink-muted">Regime tributário</span>
          <select className={inputCls} disabled={!gestor || pending} value={regime ?? ""} onChange={(e) => setRegime(e.target.value || null)}>
            <option value="">Não informado</option>
            {REGIMES_TRIBUTARIOS.map((r) => (
              <option key={r} value={r}>
                {ROTULO_REGIME[r]}
              </option>
            ))}
          </select>
          <span className="block text-[11px] text-ink-muted">Cadastro da empresa (vale para todos os anos). Decide o padrão quando não há alíquota cadastrada.</span>
        </label>

        <div className="grid gap-3 sm:grid-cols-3">
          {ENCARGOS_PATRONAIS.map((k) => (
            <label key={k} className="block space-y-0.5">
              <span className="text-xs font-medium text-ink-muted">{meta(k).label}</span>
              <NumCampo valor={v[k]} casas={4} sufixo="%" disabled={!gestor || pending} onChange={(n) => setV((x) => ({ ...x, [k]: n }))} />
              <span className="block text-[11px] text-ink-muted">{meta(k).hint}</span>
            </label>
          ))}
        </div>
        <p className="text-sm">
          Encargos da empresa sobre a folha: <strong className="tabular-nums">{pp(total)}</strong>
          <span className="text-ink-muted"> · FGTS ({pp(dados.values.fgts)}) fica com o Orçamento; a folha do DP usa o FGTS dos Parâmetros da folha.</span>
        </p>

        {gestor ? (
          <div className="flex flex-wrap justify-end gap-2">
            <button
              type="button"
              disabled={pending}
              onClick={() => {
                const p = encargosPadrao(regime);
                setV({ inss_patronal: p.inss_patronal, rat_fap: p.rat_fap, terceiros: p.terceiros });
              }}
              className="rounded-md border border-input px-3 py-1.5 text-sm hover:bg-muted disabled:opacity-50"
            >
              Preencher com o padrão do regime
            </button>
            {dados.temLinha && (
              <button
                type="button"
                disabled={pending}
                onClick={() => executar(() => voltarEncargosAoPadrao({ companyId: dados.companyId, ano: dados.ano }), `Alíquotas de ${dados.ano} apagadas`)}
                className="rounded-md border border-input px-3 py-1.5 text-sm text-red-700 hover:bg-muted disabled:opacity-50 dark:text-red-400"
              >
                Apagar as de {dados.ano}
              </button>
            )}
            <button
              type="button"
              disabled={pending}
              onClick={() => executar(() => salvarEncargosEmpresa({ companyId: dados.companyId, ano: dados.ano, regime, aliquotas: v }), "Encargos salvos")}
              className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
            >
              {pending ? "Aguarde…" : `Salvar ${dados.ano}`}
            </button>
          </div>
        ) : (
          <p className="text-xs text-ink-muted">Só o gestor do DP altera os encargos — eles mudam o custo da empresa inteira, aqui e no Orçamento.</p>
        )}
      </CardContent>
    </Card>
  );
}
