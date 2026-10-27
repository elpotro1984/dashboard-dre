"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, Check, Info, Loader2, RefreshCw, Users } from "lucide-react";

import {
  aplicarDpSync,
  getDpSyncPrevia,
  salvarDpSetorDePara,
  type DpSyncPrevia,
  type DpSyncResultado,
} from "@/lib/orcamento/actions/dp-sync";
import { MOTIVO_FORA_LABEL, type PreviaDpItem } from "@/lib/orcamento/dp-sync";
import { formatBRL } from "@/lib/orcamento/format";
import { vinculoLabel } from "@/lib/orcamento/vinculos";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

/**
 * Puxar o quadro de pessoal do DEPARTAMENTO PESSOAL para esta empresa.
 *
 * O desenho vem das decisões de 27/10/2026, e três delas se veem na tela:
 *
 *  1. **O sync SÓ SUGERE.** Nada é gravado sem a marca do admin, item por item.
 *     Os atalhos de marcação em lote existem porque com ~200 pessoas "item por
 *     item" só funciona se o clique for barato — mas eles marcam, não gravam.
 *  2. **Novas vêm marcadas; conflito vem DESMARCADO**, com o valor atual e o do
 *     DP lado a lado. Sobrescrever o que o gestor digitou é escolha explícita.
 *  3. **Nada é removido.** Quem está no quadro e não no cadastro ativo do DP
 *     aparece no rodapé como aviso — contratação planejada cai ali por
 *     definição, já que ela não existe na Sólides.
 *
 * O de-para de setor fica no TOPO porque ele é pré-requisito: departamento sem
 * setor não entra, e sem isso a pessoa cairia no balde "Não atribuído", que
 * gestor nenhum alcança.
 */
export function DpSyncManager({ companyId, year }: { companyId: string; year: number }) {
  const [previa, setPrevia] = useState<DpSyncPrevia | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  /** O erro é de permissão? Vem do servidor, não deduzido do texto. */
  const [semAcesso, setSemAcesso] = useState(false);
  const [ocupado, setOcupado] = useState(false);
  const [marcados, setMarcados] = useState<Set<string>>(new Set());
  const [resultado, setResultado] = useState<DpSyncResultado | null>(null);
  /** Escolhas do de-para ainda não gravadas: chave = departamento. */
  const [escolhas, setEscolhas] = useState<Record<string, string>>({});

  const carregar = useCallback(async () => {
    setCarregando(true);
    setErro(null);
    const res = await getDpSyncPrevia(companyId, year);
    setSemAcesso(Boolean(res.semAcesso));
    if (res.error) {
      setErro(res.error);
      setPrevia(null);
    } else if (res.previa) {
      setPrevia(res.previa);
      // A pré-marcação é do SERVIDOR (`marcada`), não da tela: é a mesma conta
      // que decide o estado de cada item.
      setMarcados(new Set(res.previa.itens.filter((i) => i.marcada).map((i) => i.solidesId)));
      setEscolhas(
        Object.fromEntries(
          res.previa.deParaPendente
            .filter((d) => d.sugestao)
            .map((d) => [d.departamento, d.sugestao as string]),
        ),
      );
    }
    setCarregando(false);
  }, [companyId, year]);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  const graveis = useMemo(
    () => (previa?.itens ?? []).filter((i) => i.estado === "nova" || i.estado === "conflito"),
    [previa],
  );
  const fora = useMemo(() => (previa?.itens ?? []).filter((i) => i.estado === "fora"), [previa]);
  const iguais = previa?.resumo.iguais ?? 0;

  function alternar(id: string) {
    setMarcados((atual) => {
      const novo = new Set(atual);
      if (novo.has(id)) novo.delete(id);
      else novo.add(id);
      return novo;
    });
  }

  function marcarTodas(filtro: (i: PreviaDpItem) => boolean) {
    setMarcados(new Set(graveis.filter(filtro).map((i) => i.solidesId)));
  }

  async function gravar() {
    setOcupado(true);
    setErro(null);
    setResultado(null);
    const res = await aplicarDpSync(companyId, year, Array.from(marcados));
    if (res.error) setErro(res.error);
    if (res.resultado) {
      setResultado(res.resultado);
      await carregar();
    }
    setOcupado(false);
  }

  async function gravarDePara() {
    if (!previa) return;
    setOcupado(true);
    setErro(null);
    const linhas = [
      // O que já estava gravado continua, menos o que foi apagado na tela.
      ...previa.dePara.filter((d) => (escolhas[d.departamento] ?? d.setorNome) !== ""),
      ...previa.deParaPendente
        .filter((d) => escolhas[d.departamento])
        .map((d) => ({ departamento: d.departamento, setorNome: escolhas[d.departamento] })),
    ].map((d) => ({
      departamento: d.departamento,
      setorNome: escolhas[d.departamento] ?? d.setorNome,
    }));
    const res = await salvarDpSetorDePara(companyId, linhas);
    if (res.error) setErro(res.error);
    else await carregar();
    setOcupado(false);
  }

  if (carregando) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        Lendo o cadastro do Departamento Pessoal…
      </div>
    );
  }

  if (erro && !previa) {
    return (
      <div className="rounded-lg border border-amber-500/40 bg-amber-500/5 p-4 text-sm">
        <p className="font-medium">{erro}</p>
        {semAcesso ? (
          <p className="mt-1 text-muted-foreground">
            Esta sincronização exige as duas coisas: ser administrador do Orçamento e ter o módulo
            Departamento Pessoal. É deliberado — é o que mantém o controle do DP sobre o momento em
            que o salário real atravessa para o Orçamento.
          </p>
        ) : (
          <button
            type="button"
            onClick={carregar}
            className="mt-2 text-xs font-medium underline underline-offset-2"
          >
            Tentar de novo
          </button>
        )}
      </div>
    );
  }

  if (!previa) return null;

  const pendentes = previa.deParaPendente;

  return (
    <div className="space-y-5">
      {erro && <p className="text-sm text-destructive">{erro}</p>}

      {resultado && (
        <div className="rounded-lg border border-emerald-500/40 bg-emerald-500/5 p-3 text-sm">
          <p className="flex items-center gap-2 font-medium">
            <Check className="h-4 w-4" />
            {resultado.criados} cadastrado(s) · {resultado.atualizados} atualizado(s)
          </p>
          {resultado.falhas.length > 0 && (
            <ul className="mt-2 space-y-0.5 text-xs text-muted-foreground">
              {resultado.falhas.map((f) => (
                <li key={f.nome}>
                  <strong>{f.nome}</strong>: {f.motivo}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {/* ── O de-para, que é pré-requisito ────────────────────────────────── */}
      {previa.orcaPorSetor && (
        <section className="rounded-lg border p-4">
          <h3 className="text-sm font-semibold">Departamento do DP → setor do orçamento</h3>
          <p className="mt-1 text-xs text-muted-foreground">
            Departamento sem setor aqui <strong>não entra</strong> no quadro: a pessoa cairia no
            balde &quot;Não atribuído&quot;, que nenhum gestor alcança. As sugestões vêm do nome —
            confira antes de gravar.
          </p>

          {pendentes.length === 0 && previa.dePara.length === 0 && (
            <p className="mt-3 text-xs text-muted-foreground">
              Nenhum departamento encontrado no cadastro do DP para esta empresa.
            </p>
          )}

          {(pendentes.length > 0 || previa.dePara.length > 0) && (
            <div className="mt-3 space-y-2">
              {[
                ...pendentes.map((d) => ({ departamento: d.departamento, atual: "", novo: true })),
                ...previa.dePara.map((d) => ({
                  departamento: d.departamento,
                  atual: d.setorNome,
                  novo: false,
                })),
              ].map((d) => (
                <div key={d.departamento} className="flex items-center gap-2">
                  <Label className="w-56 shrink-0 truncate text-xs" title={d.departamento}>
                    {d.departamento}
                    {d.novo && <span className="ml-1 text-amber-600">• sem setor</span>}
                  </Label>
                  <select
                    className="h-8 flex-1 rounded-md border bg-background px-2 text-xs"
                    value={escolhas[d.departamento] ?? d.atual}
                    onChange={(e) =>
                      setEscolhas((a) => ({ ...a, [d.departamento]: e.target.value }))
                    }
                  >
                    <option value="">— não mapeado —</option>
                    {previa.setores.map((s) => (
                      <option key={s.id} value={s.name}>
                        {s.name}
                      </option>
                    ))}
                  </select>
                </div>
              ))}
              <Button size="sm" variant="outline" onClick={gravarDePara} disabled={ocupado}>
                {ocupado ? <Loader2 className="mr-2 h-3 w-3 animate-spin" /> : null}
                Gravar o de-para
              </Button>
            </div>
          )}
        </section>
      )}

      {!previa.orcaPorSetor && (
        <p className="rounded-lg border border-amber-500/40 bg-amber-500/5 p-3 text-xs">
          Esta empresa <strong>não orça por setor</strong>, então todos entram no balde
          &quot;Não atribuído&quot; — e linha sem setor não pertence a gestor nenhum: só
          administrador consegue vê-la e editá-la no quadro. Se os gerentes vão montar o pessoal
          aqui, ligue <strong>Orçar por setor</strong> antes de sincronizar; o de-para de
          departamento aparece nesta tela quando isso estiver ligado.
        </p>
      )}

      {/* ── A prévia ──────────────────────────────────────────────────────── */}
      <section>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="flex items-center gap-2 text-sm font-semibold">
            <Users className="h-4 w-4" />
            {graveis.length} pessoa(s) a sincronizar
            <span className="font-normal text-muted-foreground">
              · {previa.resumo.novas} nova(s) · {previa.resumo.conflitos} com diferença
              {iguais > 0 && ` · ${iguais} já igual(is)`}
            </span>
          </h3>
          <Button size="sm" variant="ghost" onClick={carregar} disabled={ocupado}>
            <RefreshCw className="mr-2 h-3 w-3" />
            Reler o DP
          </Button>
        </div>

        {graveis.length > 0 && (
          <>
            <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
              <span className="text-muted-foreground">Marcar:</span>
              <Button size="sm" variant="outline" onClick={() => marcarTodas((i) => i.estado === "nova")}>
                só as novas
              </Button>
              <Button size="sm" variant="outline" onClick={() => marcarTodas(() => true)}>
                todas
              </Button>
              <Button size="sm" variant="outline" onClick={() => setMarcados(new Set())}>
                nenhuma
              </Button>
            </div>

            <div className="mt-3 overflow-x-auto rounded-lg border">
              <table className="w-full text-xs">
                <thead className="bg-muted/40">
                  <tr className="border-b">
                    <th className="w-8 px-2 py-1.5" />
                    <th className="px-2 py-1.5 text-left">Pessoa</th>
                    <th className="px-2 py-1.5 text-left">Setor</th>
                    <th className="px-2 py-1.5 text-left">Cargo</th>
                    <th className="px-2 py-1.5 text-right">Salário</th>
                    <th className="px-2 py-1.5 text-left">Vínculo</th>
                  </tr>
                </thead>
                <tbody>
                  {graveis.map((i) => (
                    <tr key={i.solidesId} className="border-b last:border-0 align-top">
                      <td className="px-2 py-1.5">
                        <input
                          type="checkbox"
                          checked={marcados.has(i.solidesId)}
                          onChange={() => alternar(i.solidesId)}
                        />
                      </td>
                      <td className="px-2 py-1.5">
                        <div className="font-medium">{i.nome}</div>
                        <div className="text-[11px] text-muted-foreground">
                          {i.estado === "nova" ? "nova no quadro" : "já está no quadro"}
                        </div>
                        {i.avisos.map((a) => (
                          <div key={a} className="text-[11px] text-amber-600">
                            {a}
                          </div>
                        ))}
                      </td>
                      <td className="px-2 py-1.5">{i.setorNome ?? "—"}</td>
                      <td className="px-2 py-1.5">
                        <Diferenca atual={i.atual?.cargo ?? null} novo={i.cargo} />
                      </td>
                      <td className="px-2 py-1.5 text-right">
                        <Diferenca
                          atual={i.atual ? dinheiro(i.atual.salario) : null}
                          novo={dinheiro(i.salario)}
                        />
                      </td>
                      <td className="px-2 py-1.5">
                        <Diferenca
                          atual={i.atual ? vinculoLabel(i.atual.vinculo) : null}
                          novo={vinculoLabel(i.vinculo)}
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="mt-3 flex items-center gap-3">
              <Button onClick={gravar} disabled={ocupado || marcados.size === 0}>
                {ocupado ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                Sincronizar {marcados.size} marcada(s)
              </Button>
              {previa.resumo.semSalario > 0 && (
                <span className="text-xs text-amber-600">
                  {previa.resumo.semSalario} sem salário na Sólides — entram em branco.
                </span>
              )}
            </div>
          </>
        )}

        {graveis.length === 0 && (
          <p className="mt-3 text-xs text-muted-foreground">
            Nada a sincronizar: ou o quadro já está igual ao cadastro do DP, ou o que falta está
            listado abaixo com o motivo.
          </p>
        )}
      </section>

      {/* ── O que ficou de fora, sempre nomeado ───────────────────────────── */}
      {fora.length > 0 && (
        <section className="rounded-lg border border-amber-500/40 bg-amber-500/5 p-4">
          <h3 className="flex items-center gap-2 text-sm font-semibold">
            <AlertTriangle className="h-4 w-4" />
            {fora.length} pessoa(s) fora da sincronização
          </h3>
          <ul className="mt-2 space-y-0.5 text-xs">
            {fora.map((i) => (
              <li key={i.solidesId}>
                <strong>{i.nome}</strong>
                {i.departamento ? ` (${i.departamento})` : ""} —{" "}
                {i.motivoFora ? MOTIVO_FORA_LABEL[i.motivoFora] : "motivo não identificado"}
              </li>
            ))}
          </ul>
        </section>
      )}

      {(previa.apenasNoQuadro.length > 0 || previa.semEmpresaNoDp > 0) && (
        <section className="rounded-lg border p-4 text-xs text-muted-foreground">
          <p className="flex items-center gap-2 font-medium text-foreground">
            <Info className="h-4 w-4" />
            Para conferência
          </p>
          {previa.apenasNoQuadro.length > 0 && (
            <p className="mt-2">
              <strong>{previa.apenasNoQuadro.length}</strong> no quadro do orçamento e não no
              cadastro ativo do DP. <strong>Nada foi removido</strong> — contratação planejada cai
              aqui por definição, já que ela não existe na Sólides:{" "}
              {previa.apenasNoQuadro.map((p) => p.nome).join(", ")}.
            </p>
          )}
          {previa.semEmpresaNoDp > 0 && (
            <p className="mt-2">
              <strong>{previa.semEmpresaNoDp}</strong> pessoa(s) ativa(s) no DP sem empresa
              resolvida pelo de-para <em>do próprio DP</em> — elas não entram em empresa nenhuma até
              a unidade/departamento delas ser mapeada lá.
            </p>
          )}
        </section>
      )}

      <p className="text-[11px] text-muted-foreground">
        O sync traz nome, cargo e salário de hoje. <strong>Movimentação é do gestor</strong> — nem o
        desligamento já registrado no cadastro vira uma; a data aparece como aviso na linha.
        Benefícios não são tocados (quem os define é o Plano de cargos). O salário é copiado como
        retrato: mudar a Sólides depois não altera o que já foi montado.
      </p>
    </div>
  );
}

/** Mostra "atual → novo" quando há conflito, e só o novo quando é pessoa nova. */
function Diferenca({ atual, novo }: { atual: string | null; novo: string | null }) {
  const n = novo ?? "—";
  if (atual == null) return <span>{n}</span>;
  if (atual === n) return <span className="text-muted-foreground">{n}</span>;
  return (
    <span>
      <span className="text-muted-foreground line-through">{atual || "—"}</span>
      <span className={cn("ml-1 font-medium")}>→ {n}</span>
    </span>
  );
}

function dinheiro(v: number | null): string {
  return v == null ? "—" : formatBRL(v);
}
