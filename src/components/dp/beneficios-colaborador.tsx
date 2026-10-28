"use client";

import { Fragment, useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Pencil, Plus, Trash2 } from "lucide-react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useToast } from "@/components/ui/toaster";
import { DP_BENEFICIOS_PATH } from "@/lib/auth/dp";
import { salvarBeneficiosColaborador } from "@/lib/dp/actions-cadastro";
import {
  BLOCOS_ESCOLHA,
  dataBR,
  DESTINOS_OUTROS,
  opcoesDoBloco,
  resolverBeneficios,
  ROTULO_DESTINO,
  ROTULO_UNIDADE,
  rotuloPresenciais,
  unidadeDoDestino,
  type DpBeneficiosColaborador,
  type DpDependenteFicha,
  type DpDestinoOutro,
  type DpLinhaBeneficio,
  type DpUnidadeBeneficio,
} from "@/lib/dp/beneficios-colaborador";
import type { DpBeneficiosDados, DpBlocoBeneficio } from "@/lib/dp/beneficios-config";
import { formatBRL } from "@/lib/orcamento/format";

import { inputCls, NumCampo } from "./folha/campos";

const novoId = () => (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`);
const valorUn = (v: number, u: DpUnidadeBeneficio) => `${formatBRL(v)}${u === "dia" ? "/dia" : "/mês"}`;

type BlocoEscolha = (typeof BLOCOS_ESCOLHA)[number];

/**
 * Card "Benefícios" da ficha. A pessoa ESCOLHE a faixa, o bilhete, a
 * modalidade…; o valor vem do cadastro da empresa (Configurações › Benefícios),
 * lido na hora. Mostra o valor de cada benefício, POR DIA ou NO MÊS, e só: quanto
 * a pessoa recebe no mês é conta da futura tela de gestão de benefícios
 * (28/10/2026). Recalcula ao vivo enquanto se edita, pela mesma regra que o
 * servidor confere.
 */
export function DpBeneficiosColaboradorCard(props: {
  colaboradorId: string;
  podeEditar: boolean;
  cfg: DpBeneficiosDados;
  /** A empresa tem algum bloco salvo? Sem nenhum, não há o que escolher. */
  empresaTemCadastro: boolean;
  escolhas: DpBeneficiosColaborador;
  pessoa: { tipoContrato: string | null; salario: number | null; dependentes: DpDependenteFicha[] };
  hoje: string;
  atualizado: string | null;
  avisoEmpresa: string | null;
}) {
  const [editando, setEditando] = useState(false);
  const [rascunho, setRascunho] = useState<DpBeneficiosColaborador>(props.escolhas);
  const [pending, start] = useTransition();
  const router = useRouter();
  const { showToast } = useToast();

  const escolhas = editando ? rascunho : props.escolhas;
  const resumo = useMemo(
    () => resolverBeneficios({ cfg: props.cfg, escolhas, pessoa: props.pessoa, hoje: props.hoje }),
    [props.cfg, escolhas, props.pessoa, props.hoje],
  );
  const mudar = (p: Partial<DpBeneficiosColaborador>) => setRascunho((r) => ({ ...r, ...p }));

  const salvar = () =>
    start(async () => {
      const res = await salvarBeneficiosColaborador({ colaboradorId: props.colaboradorId, dados: rascunho });
      if (!res.ok) {
        showToast({ title: "Não salvo", description: res.error, variant: "destructive" });
        return;
      }
      showToast({ title: "Benefícios salvos", variant: "success" });
      setEditando(false);
      router.refresh();
    });

  const nada = resumo.linhas.every((l) => l.valor === 0 && !l.escolha) && resumo.separados.length === 0;

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between gap-2">
          <CardTitle className="text-base">Benefícios</CardTitle>
          {props.podeEditar && props.empresaTemCadastro && !editando && (
            <button
              type="button"
              onClick={() => {
                setRascunho(props.escolhas);
                setEditando(true);
              }}
              className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-xs font-medium hover:bg-surface-2"
            >
              <Pencil className="h-3.5 w-3.5" /> Editar
            </button>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        {!props.podeEditar ? (
          <p className="text-ink-muted">Defina a empresa desta pessoa no de-para de empresas para cadastrar os benefícios.</p>
        ) : !props.empresaTemCadastro ? (
          <p className="text-ink-muted">
            A empresa ainda não tem benefícios cadastrados.{" "}
            <Link href={DP_BENEFICIOS_PATH} className="underline">
              Configurações › Benefícios
            </Link>
          </p>
        ) : (
          <>
            {props.avisoEmpresa && (
              <p className="rounded-md border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-amber-900 dark:text-amber-200">{props.avisoEmpresa}</p>
            )}
            {!editando && nada ? (
              <p className="text-ink-muted">Nenhum benefício cadastrado para esta pessoa.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="text-left text-ink-muted">
                    <tr className="border-b border-border">
                      <th className="py-1.5 pr-3 font-medium">Benefício</th>
                      <th className="py-1.5 pr-3 font-medium">Escolha</th>
                      <th className="py-1.5 text-right font-medium">Valor</th>
                    </tr>
                  </thead>
                  <tbody>
                    {resumo.linhas.map((l) => (
                      <Fragment key={l.bloco}>
                        <tr className={`align-top ${l.outros.length ? "" : "border-b border-border/60"}`}>
                          <td className={`py-1.5 pr-3 ${l.valor === 0 && !l.escolha ? "text-ink-muted" : "text-ink-primary"}`}>{l.rotulo}</td>
                          <td className="py-1.5 pr-3">
                            {editando ? (
                              <Escolha bloco={l.bloco} cfg={props.cfg} rascunho={rascunho} mudar={mudar} disabled={pending} />
                            ) : (
                              <span className={l.escolha ? "text-ink-primary" : "text-ink-muted"}>{l.escolha ?? "—"}</span>
                            )}
                            <Notas linha={l} />
                          </td>
                          <td className={`py-1.5 text-right tabular-nums ${l.outros.length ? "text-ink-muted" : ""}`}>
                            {l.base > 0 ? valorUn(l.base, l.unidade) : "—"}
                          </td>
                        </tr>
                        {/* "Outros" que vão para este benefício: somam nele, na unidade dele. */}
                        {l.outros.map((o, i) => (
                          <tr key={`${l.bloco}-o${i}`}>
                            <td />
                            <td className="pb-1 pr-3 text-xs text-ink-muted">+ {o.rotulo}</td>
                            <td className="pb-1 text-right text-xs tabular-nums text-ink-muted">{valorUn(o.valor, l.unidade)}</td>
                          </tr>
                        ))}
                        {l.outros.length > 0 && (
                          <tr className="border-b border-border/60">
                            <td />
                            <td className="pb-1.5 pr-3 text-xs text-ink-muted">= valor do benefício</td>
                            <td className="pb-1.5 text-right font-medium tabular-nums">{valorUn(l.valor, l.unidade)}</td>
                          </tr>
                        )}
                      </Fragment>
                    ))}
                    {resumo.separados.map((o, i) => (
                      <tr key={`sep${i}`} className="border-b border-border/60">
                        <td className="py-1.5 pr-3 text-ink-primary">{o.rotulo}</td>
                        <td className="py-1.5 pr-3 text-xs text-ink-muted">outro benefício · separado</td>
                        <td className="py-1.5 text-right tabular-nums">{valorUn(o.valor, "mes")}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            <Filhos resumo={resumo} editando={editando} rascunho={rascunho} mudar={mudar} disabled={pending} hoje={props.hoje} />
            {editando && <Outros cfg={props.cfg} rascunho={rascunho} mudar={mudar} disabled={pending} />}

            {editando && (
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={salvar}
                  disabled={pending}
                  className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-60"
                >
                  Salvar
                </button>
                <button type="button" onClick={() => setEditando(false)} disabled={pending} className="rounded-md border border-border px-3 py-1.5 text-sm">
                  Cancelar
                </button>
              </div>
            )}

            <p className="text-xs text-ink-muted">
              Os valores vêm de{" "}
              <Link href={DP_BENEFICIOS_PATH} className="underline">
                Configurações › Benefícios
              </Link>{" "}
              da empresa e acompanham o que for mudado lá. Aqui fica o valor de cada benefício, por dia ou no mês; quanto a pessoa
              recebe no mês será calculado na tela de gestão de benefícios. A Folha do mês segue com o cadastro da folha da pessoa.
              {props.atualizado && ` ${props.atualizado}.`}
            </p>
          </>
        )}
      </CardContent>
    </Card>
  );
}

function Notas({ linha }: { linha: DpLinhaBeneficio }) {
  if (!linha.detalhe && !linha.aviso) return null;
  return (
    <div className="mt-0.5 space-y-0.5 text-xs">
      {linha.detalhe && <div className="text-ink-muted">{linha.detalhe}</div>}
      {linha.aviso && <div className="text-amber-700 dark:text-amber-400">{linha.aviso}</div>}
    </div>
  );
}

/** O controle de cada benefício no modo de edição. */
function Escolha(props: {
  bloco: DpBlocoBeneficio;
  cfg: DpBeneficiosDados;
  rascunho: DpBeneficiosColaborador;
  mudar: (p: Partial<DpBeneficiosColaborador>) => void;
  disabled: boolean;
}) {
  const { bloco, cfg, rascunho, mudar, disabled } = props;
  const semOpcoes = <span className="text-xs text-ink-muted">sem opções no cadastro da empresa</span>;

  if ((BLOCOS_ESCOLHA as DpBlocoBeneficio[]).includes(bloco)) {
    const b = bloco as BlocoEscolha;
    const opcoes = opcoesDoBloco(cfg, b);
    const atual = rascunho[b];
    // A escolha gravada que saiu do cadastro continua visível (marcada), senão o select a mostraria vazia e o dado sumiria calado.
    const orfa = atual && !opcoes.some((o) => o.id === atual.id) ? atual : null;
    if (opcoes.length === 0 && !orfa) return semOpcoes;
    const un = unidadeDoDestino(cfg, b);
    return (
      <select
        value={atual?.id ?? ""}
        disabled={disabled}
        aria-label={ROTULO_DESTINO[b]}
        onChange={(e) => {
          const o = opcoes.find((x) => x.id === e.target.value);
          mudar({ [b]: o ? { id: o.id, nome: o.nome } : null } as Partial<DpBeneficiosColaborador>);
        }}
        className={inputCls}
      >
        <option value="">— não recebe —</option>
        {orfa && <option value={orfa.id}>{orfa.nome ? `“${orfa.nome}”` : "Opção"} (não existe mais)</option>}
        {opcoes.map((o) => (
          <option key={o.id} value={o.id}>
            {o.nome} — {valorUn(o.valor, un)}
          </option>
        ))}
      </select>
    );
  }

  if (bloco === "home_office") {
    const opcoes = cfg.home_office.porDias;
    const atual = rascunho.homeOfficeDias;
    const orfa = atual !== null && !opcoes.some((o) => o.dias === atual);
    if (opcoes.length === 0 && !orfa) return semOpcoes;
    return (
      <select
        value={atual === null ? "" : String(atual)}
        disabled={disabled}
        aria-label="Dias presenciais na semana"
        onChange={(e) => mudar({ homeOfficeDias: e.target.value === "" ? null : Number(e.target.value) })}
        className={inputCls}
      >
        <option value="">— não recebe —</option>
        {orfa && <option value={String(atual)}>{rotuloPresenciais(atual)} (não existe mais)</option>}
        {opcoes.map((o) => (
          <option key={o.id} value={String(o.dias)}>
            {rotuloPresenciais(o.dias)} — {valorUn(o.valor, "mes")}
          </option>
        ))}
      </select>
    );
  }

  if (bloco === "assiduidade") {
    const valor = cfg.assiduidade.valor;
    if (valor === null && !rascunho.assiduidade) return semOpcoes;
    return (
      <label className="inline-flex items-center gap-2">
        <input type="checkbox" checked={rascunho.assiduidade} disabled={disabled} onChange={(e) => mudar({ assiduidade: e.target.checked })} />
        Recebe{valor !== null && <span className="text-ink-muted">({valorUn(valor, "mes")})</span>}
      </label>
    );
  }

  // Salário-família: pelas regras — os filhos se cadastram abaixo da tabela.
  return <span className="text-xs text-ink-muted">pelas regras · filhos abaixo</span>;
}

function Filhos(props: {
  resumo: ReturnType<typeof resolverBeneficios>;
  editando: boolean;
  rascunho: DpBeneficiosColaborador;
  mudar: (p: Partial<DpBeneficiosColaborador>) => void;
  disabled: boolean;
  hoje: string;
}) {
  const { resumo, editando, rascunho, mudar, disabled } = props;
  const daSolides = resumo.filhos.filter((f) => f.origem === "solides");
  if (!editando && resumo.filhos.length === 0) return null;
  const trocar = (id: string, p: Partial<DpBeneficiosColaborador["filhos"][number]>) =>
    mudar({ filhos: rascunho.filhos.map((f) => (f.id === id ? { ...f, ...p } : f)) });

  return (
    <div className="space-y-1.5 rounded-md border border-border px-3 py-2">
      <div className="text-xs font-medium text-ink-muted">Filhos para o salário-família</div>
      {resumo.filhos.length > 0 && !editando && (
        <ul className="space-y-0.5">
          {resumo.filhos.map((f) => (
            <li key={`${f.origem}-${f.nome}`} className="flex flex-wrap justify-between gap-x-2">
              <span className={f.conta ? "text-ink-primary" : "text-ink-muted"}>
                {f.nome} <span className="text-xs text-ink-muted">· {f.origem === "solides" ? "Sólides" : "cadastrado aqui"}</span>
              </span>
              <span className={`text-xs ${f.conta ? "text-ink-muted" : "text-amber-700 dark:text-amber-400"}`}>
                {dataBR(f.nascimento)} · {f.motivo}
              </span>
            </li>
          ))}
        </ul>
      )}
      {editando && (
        <>
          {daSolides.length > 0 && (
            <ul className="space-y-0.5">
              {daSolides.map((f) => (
                <li key={f.nome} className="flex flex-wrap justify-between gap-x-2 text-ink-muted">
                  <span>
                    {f.nome} <span className="text-xs">· Sólides</span>
                  </span>
                  <span className="text-xs">
                    {dataBR(f.nascimento)} · {f.motivo}
                  </span>
                </li>
              ))}
            </ul>
          )}
          {rascunho.filhos.map((f) => (
            <div key={f.id} className="flex flex-wrap items-center gap-2">
              <input
                value={f.nome}
                onChange={(e) => trocar(f.id, { nome: e.target.value })}
                placeholder="Nome do filho"
                aria-label="Nome do filho"
                disabled={disabled}
                className={`${inputCls} max-w-xs`}
              />
              <input
                type="date"
                value={f.nascimento}
                max={props.hoje}
                onChange={(e) => trocar(f.id, { nascimento: e.target.value })}
                aria-label={`Nascimento de ${f.nome || "filho"}`}
                disabled={disabled}
                className={`${inputCls} w-40`}
              />
              <label className="inline-flex items-center gap-1 text-xs text-ink-muted">
                <input type="checkbox" checked={f.invalido} disabled={disabled} onChange={(e) => trocar(f.id, { invalido: e.target.checked })} />
                inválido
              </label>
              <button
                type="button"
                onClick={() => mudar({ filhos: rascunho.filhos.filter((x) => x.id !== f.id) })}
                disabled={disabled}
                className="rounded p-1 text-ink-muted hover:text-red-600"
                aria-label={`Remover ${f.nome || "filho"}`}
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
          ))}
          <button
            type="button"
            onClick={() => mudar({ filhos: [...rascunho.filhos, { id: novoId(), nome: "", nascimento: "", invalido: false }] })}
            disabled={disabled}
            className="inline-flex items-center gap-1 rounded-md border border-dashed border-input px-2.5 py-1 text-xs text-ink-muted hover:text-ink-primary"
          >
            <Plus className="h-3.5 w-3.5" /> Adicionar filho
          </button>
          <p className="text-xs text-ink-muted">
            Cadastre aqui o filho que não está na Sólides. Com o mesmo nome de um filho da Sólides, vale o daqui — é como se corrige
            a data ou marca um filho inválido. Conta até o mês em que completa 14 anos; inválido, em qualquer idade.
          </p>
        </>
      )}
    </div>
  );
}

function Outros(props: {
  cfg: DpBeneficiosDados;
  rascunho: DpBeneficiosColaborador;
  mudar: (p: Partial<DpBeneficiosColaborador>) => void;
  disabled: boolean;
}) {
  const { cfg, rascunho, mudar, disabled } = props;
  const trocar = (id: string, p: Partial<DpBeneficiosColaborador["outros"][number]>) =>
    mudar({ outros: rascunho.outros.map((o) => (o.id === id ? { ...o, ...p } : o)) });
  return (
    <div className="space-y-1.5 rounded-md border border-border px-3 py-2">
      <div className="text-xs font-medium text-ink-muted">Outros benefícios</div>
      {rascunho.outros.map((o) => (
        // Uma linha só: o rótulo fica com o espaço que sobra; valor, unidade e destino têm largura fixa.
        <div key={o.id} className="flex items-center gap-2">
          <input
            value={o.rotulo}
            onChange={(e) => trocar(o.id, { rotulo: e.target.value })}
            placeholder="Rótulo"
            aria-label="Rótulo do benefício"
            disabled={disabled}
            className={`${inputCls} min-w-0 flex-1`}
          />
          <NumCampo
            valor={o.valor}
            onChange={(valor) => trocar(o.id, { valor })}
            disabled={disabled}
            className="w-28 shrink-0"
            ariaLabel={`Valor de ${o.rotulo || "benefício"}`}
          />
          <span className="shrink-0 whitespace-nowrap text-xs text-ink-muted">{ROTULO_UNIDADE[unidadeDoDestino(cfg, o.destino)]}</span>
          <select
            value={o.destino}
            onChange={(e) => trocar(o.id, { destino: e.target.value as DpDestinoOutro })}
            aria-label="Para onde vai o valor"
            title={o.destino === "separado" ? "Separado — não soma a nenhum benefício" : `Soma em ${ROTULO_DESTINO[o.destino]}`}
            disabled={disabled}
            className={`${inputCls} w-36 shrink-0`}
          >
            {DESTINOS_OUTROS.map((d) => (
              <option key={d} value={d}>
                {ROTULO_DESTINO[d]}
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={() => mudar({ outros: rascunho.outros.filter((x) => x.id !== o.id) })}
            disabled={disabled}
            className="shrink-0 rounded p-1 text-ink-muted hover:text-red-600"
            aria-label={`Remover ${o.rotulo || "benefício"}`}
          >
            <Trash2 className="h-4 w-4" />
          </button>
        </div>
      ))}
      <button
        type="button"
        onClick={() => mudar({ outros: [...rascunho.outros, { id: novoId(), rotulo: "", valor: 0, destino: "separado" }] })}
        disabled={disabled}
        className="inline-flex items-center gap-1 rounded-md border border-dashed border-input px-2.5 py-1 text-xs text-ink-muted hover:text-ink-primary"
      >
        <Plus className="h-3.5 w-3.5" /> Adicionar outro benefício
      </button>
      <p className="text-xs text-ink-muted">
        O valor soma no benefício escolhido, na unidade dele (por dia no VT e no vale-alimentação diário, no mês nos demais).
        Separado fica numa linha própria e não soma a nenhum outro.
      </p>
    </div>
  );
}
