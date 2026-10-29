"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Copy, Globe, Loader2, Plus, Trash2 } from "lucide-react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useToast } from "@/components/ui/toaster";
import { formatDateTimeBR } from "@/lib/ctrl/datetime";
import {
  aplicarReajusteBeneficio,
  buscarSalarioFamiliaAtualizado,
  copiarBeneficiosDeEmpresa,
  origensDeCopiaBeneficios,
  salvarBlocoBeneficio,
  type DpOrigemBeneficios,
} from "@/lib/dp/actions-beneficios";
import {
  BLOCOS_BENEFICIO,
  erroDoPercentual,
  FAIXA_UNIDADE,
  MAX_DIAS_HOME_OFFICE,
  MAX_ITENS_BLOCO,
  reajustarBloco,
  resumoDoBloco,
  rotuloDias,
  rotuloFaixa,
  ROTULO_BLOCO,
  validarBloco,
  valoresDoBloco,
  type DpBeneficiosDados,
  type DpBlocoBeneficio,
  type DpDiaValor,
  type DpFaixaBeneficio,
  type DpItemNomeValor,
} from "@/lib/dp/beneficios-config";
import type { DpBeneficiosEmpresa, DpBlocoSalvo, DpReajusteBeneficio } from "@/lib/dp/beneficios-queries";

import { inputCls, lerNumeroBR, NumCampo } from "./folha/campos";
import { brl } from "./folha/formato";

type Dados = DpBeneficiosDados[DpBlocoBeneficio];

const DESCRICAO: Record<DpBlocoBeneficio, string> = {
  alimentacao: "A regra da empresa (valor por dia ou fixo no mês) e uma faixa para cada valor que ela pratica.",
  transporte: "Se a empresa desconta os 6% do salário e os tipos de bilhete, com o valor de cada um por dia.",
  gasolina: "O valor mensal do auxílio por faixa de distância (km).",
  carona: "O valor mensal do auxílio carona por faixa de distância (km).",
  home_office: "O valor do auxílio para cada quantidade de dias PRESENCIAIS na semana — ex.: 1 dia, R$ 20 (0 = todo remoto).",
  sesi: "As modalidades do Clube SESI que a empresa oferece e o valor mensal de cada uma.",
  salario_familia: "Obrigação legal: a cota por filho e o limite de remuneração da portaria do ano. Dá para buscar a tabela atualizada na web.",
  assiduidade: "O valor do prêmio de assiduidade.",
};

const novoId = () => (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`);
const pct = (v: number) => `${v.toLocaleString("pt-BR", { maximumFractionDigits: 2 })}%`;

/**
 * Configurações › Benefícios da empresa ativa: oito blocos, cada um com o
 * próprio Salvar e o próprio reajuste %. O reajuste mostra a prévia (antes ×
 * depois de cada valor) e só é aplicado depois da confirmação — sobre o bloco
 * SALVO, para o confirmado ser o aplicado.
 */
export function DpBeneficiosConfigClient({
  companyId,
  beneficios,
  podeEditar,
  podeCopiar,
}: {
  companyId: string;
  beneficios: DpBeneficiosEmpresa;
  podeEditar: boolean;
  /** Copiar de outra empresa; salvar e reajustar seguem `podeEditar`. */
  podeCopiar: boolean;
}) {
  const [copiando, setCopiando] = useState(false);
  return (
    <div className="space-y-4">
      {podeCopiar && (
        <div className="flex justify-end">
          <button
            type="button"
            onClick={() => setCopiando(true)}
            className="inline-flex items-center gap-1.5 rounded-md border border-input px-3 py-1.5 text-sm hover:bg-muted"
          >
            <Copy className="h-4 w-4" /> Copiar de outra empresa
          </button>
        </div>
      )}
      {copiando && <CopiarDialog companyId={companyId} beneficios={beneficios} onClose={() => setCopiando(false)} />}
      <p className="text-xs text-ink-muted">
        Por enquanto é só o cadastro: a folha do mês continua calculando pelos Parâmetros da folha. Estes valores vão alimentar a
        tela de gestão de benefícios.{" "}
        {podeEditar
          ? "Cada bloco é salvo e reajustado separadamente."
          : "Aqui você só consulta estes valores."}
      </p>
      {BLOCOS_BENEFICIO.map((b) => (
        <BlocoCard
          // Remonta quando o bloco gravado muda (ex.: copiado de outra empresa): o card guarda o rascunho em estado local.
          key={`${b}-${beneficios.blocos[b].atualizadoEm ?? "novo"}`}
          companyId={companyId}
          bloco={b}
          inicial={beneficios.blocos[b] as DpBlocoSalvo}
          reajustesIniciais={beneficios.reajustes[b]}
          podeEditar={podeEditar}
        />
      ))}
    </div>
  );
}

function BlocoCard({
  companyId,
  bloco,
  inicial,
  reajustesIniciais,
  podeEditar,
}: {
  companyId: string;
  bloco: DpBlocoBeneficio;
  inicial: DpBlocoSalvo;
  reajustesIniciais: DpReajusteBeneficio[];
  podeEditar: boolean;
}) {
  const [salvo, setSalvo] = useState(inicial);
  const [draft, setDraft] = useState<Dados>(inicial.dados);
  const [reajustes, setReajustes] = useState(reajustesIniciais);
  const [pending, start] = useTransition();
  const { showToast } = useToast();
  const sujo = JSON.stringify(draft) !== JSON.stringify(salvo.dados);

  const salvar = () => {
    const v = validarBloco(bloco, draft);
    if ("erro" in v) {
      showToast({ title: "Não salvo", description: v.erro, variant: "destructive" });
      return;
    }
    start(async () => {
      const r = await salvarBlocoBeneficio({ companyId, bloco, dados: v.ok });
      if (!r.ok) {
        showToast({ title: "Não salvo", description: r.error, variant: "destructive" });
        return;
      }
      setSalvo({ dados: r.dados, salvo: true, atualizadoEm: r.atualizadoEm, atualizadoPor: "você" });
      setDraft(r.dados);
      showToast({ title: `${ROTULO_BLOCO[bloco]} salvo`, variant: "success" });
    });
  };

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <CardTitle className="text-base">{ROTULO_BLOCO[bloco]}</CardTitle>
          <span className="text-xs text-ink-muted">
            {salvo.salvo
              ? `Salvo em ${formatDateTimeBR(salvo.atualizadoEm!)}${salvo.atualizadoPor ? ` por ${salvo.atualizadoPor}` : ""}`
              : "Ainda não cadastrado nesta empresa"}
          </span>
        </div>
        <p className="text-xs text-ink-muted">{DESCRICAO[bloco]}</p>
      </CardHeader>
      <CardContent className="space-y-4">
        <fieldset disabled={!podeEditar || pending} className="space-y-3">
          <Editor bloco={bloco} dados={draft} onChange={setDraft} companyId={companyId} podeEditar={podeEditar} />
        </fieldset>

        {podeEditar && (
          <div className="flex flex-wrap items-center justify-end gap-2">
            {sujo && (
              <button type="button" disabled={pending} onClick={() => setDraft(salvo.dados)} className="rounded-md border border-input px-3 py-1.5 text-sm hover:bg-muted">
                Descartar alterações
              </button>
            )}
            <button
              type="button"
              disabled={pending || (!sujo && salvo.salvo)}
              onClick={salvar}
              className="inline-flex items-center gap-1 rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
            >
              {pending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              Salvar {ROTULO_BLOCO[bloco].toLowerCase()}
            </button>
          </div>
        )}

        <Reajuste
          companyId={companyId}
          bloco={bloco}
          salvo={salvo}
          sujo={sujo}
          podeEditar={podeEditar}
          reajustes={reajustes}
          onAplicado={(dados, r) => {
            setSalvo({ dados, salvo: true, atualizadoEm: r.em, atualizadoPor: "você" });
            setDraft(dados);
            setReajustes((lista) => [r, ...lista].slice(0, 5));
          }}
        />
      </CardContent>
    </Card>
  );
}

// ── Editores ───────────────────────────────────────────────────────────────

function Editor({
  bloco,
  dados,
  onChange,
  companyId,
  podeEditar,
}: {
  bloco: DpBlocoBeneficio;
  dados: Dados;
  onChange: (d: Dados) => void;
  companyId: string;
  podeEditar: boolean;
}) {
  switch (bloco) {
    case "alimentacao": {
      const d = dados as DpBeneficiosDados["alimentacao"];
      return (
        <>
          <Opcoes
            rotulo="Regra"
            valor={d.regra}
            opcoes={[
              { v: "diario", t: "Valor diário" },
              { v: "fixo", t: "Valor fixo no mês" },
            ]}
            onChange={(regra) => onChange({ ...d, regra: regra as "diario" | "fixo" })}
          />
          <label className="flex items-center gap-2 text-sm">
            <span className="text-ink-muted">Nº de faixas</span>
            <input
              type="number"
              min={0}
              max={MAX_ITENS_BLOCO}
              value={d.faixas.length}
              onChange={(e) => {
                const alvo = Math.max(0, Math.min(MAX_ITENS_BLOCO, Math.floor(Number(e.target.value) || 0)));
                const faixas = d.faixas.slice(0, alvo);
                while (faixas.length < alvo) faixas.push({ id: novoId(), nome: `Faixa ${faixas.length + 1}`, valor: 0 });
                onChange({ ...d, faixas });
              }}
              className={`${inputCls} w-20`}
            />
            <span className="text-xs text-ink-muted">uma por valor de vale-alimentação que a empresa pratica</span>
          </label>
          <ListaNomeValor
            itens={d.faixas}
            onChange={(faixas) => onChange({ ...d, faixas })}
            rotuloNome="Faixa"
            rotuloValor={d.regra === "diario" ? "Valor por dia" : "Valor no mês"}
            vazio="Defina o nº de faixas acima."
            semAdicionar
          />
        </>
      );
    }
    case "transporte": {
      const d = dados as DpBeneficiosDados["transporte"];
      return (
        <>
          <Opcoes
            rotulo="Desconta 6% do salário?"
            valor={d.descontar6 ? "sim" : "nao"}
            opcoes={[
              { v: "sim", t: "Sim, desconta 6%" },
              { v: "nao", t: "Não desconta" },
            ]}
            onChange={(v) => onChange({ ...d, descontar6: v === "sim" })}
          />
          <ListaNomeValor
            itens={d.bilhetes}
            onChange={(bilhetes) => onChange({ ...d, bilhetes })}
            rotuloNome="Tipo de bilhete"
            rotuloValor="Valor por dia"
            vazio="Nenhum tipo de bilhete cadastrado."
            novoNome="Novo bilhete"
          />
        </>
      );
    }
    case "gasolina":
    case "carona": {
      const d = dados as DpBeneficiosDados["gasolina"];
      return <ListaFaixas bloco={bloco} faixas={d.faixas} onChange={(faixas) => onChange({ faixas })} />;
    }
    case "home_office": {
      const d = dados as DpBeneficiosDados["home_office"];
      return <ListaDias itens={d.porDias} onChange={(porDias) => onChange({ porDias })} />;
    }
    case "sesi": {
      const d = dados as DpBeneficiosDados["sesi"];
      return (
        <ListaNomeValor
          itens={d.modalidades}
          onChange={(modalidades) => onChange({ modalidades })}
          rotuloNome="Modalidade"
          rotuloValor="Valor no mês"
          vazio="Nenhuma modalidade cadastrada."
          novoNome="Nova modalidade"
        />
      );
    }
    case "salario_familia":
      return (
        <SalarioFamilia
          dados={dados as DpBeneficiosDados["salario_familia"]}
          onChange={onChange}
          companyId={companyId}
          podeEditar={podeEditar}
        />
      );
    case "assiduidade": {
      const d = dados as DpBeneficiosDados["assiduidade"];
      return (
        <label className="block max-w-xs space-y-1 text-xs">
          <span className="text-ink-muted">Valor (R$)</span>
          <CampoOpcional valor={d.valor} onChange={(valor) => onChange({ valor })} ariaLabel="Valor da assiduidade" />
        </label>
      );
    }
  }
}

function Opcoes({
  rotulo,
  valor,
  opcoes,
  onChange,
}: {
  rotulo: string;
  valor: string;
  opcoes: Array<{ v: string; t: string }>;
  onChange: (v: string) => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2 text-sm">
      <span className="text-ink-muted">{rotulo}</span>
      {opcoes.map((o) => (
        <button
          key={o.v}
          type="button"
          onClick={() => onChange(o.v)}
          aria-pressed={valor === o.v}
          className={`rounded-md border px-3 py-1 ${valor === o.v ? "border-primary bg-primary/10 font-medium text-ink-primary" : "border-input hover:bg-muted"}`}
        >
          {o.t}
        </button>
      ))}
    </div>
  );
}

function ListaNomeValor({
  itens,
  onChange,
  rotuloNome,
  rotuloValor,
  vazio,
  novoNome = "Novo item",
  semAdicionar = false,
}: {
  itens: DpItemNomeValor[];
  onChange: (i: DpItemNomeValor[]) => void;
  rotuloNome: string;
  rotuloValor: string;
  vazio: string;
  novoNome?: string;
  /** O vale-alimentação controla a quantidade pelo "Nº de faixas". */
  semAdicionar?: boolean;
}) {
  const trocar = (id: string, p: Partial<DpItemNomeValor>) => onChange(itens.map((i) => (i.id === id ? { ...i, ...p } : i)));
  return (
    <div className="space-y-1.5">
      {itens.length === 0 ? (
        <p className="text-sm text-ink-muted">{vazio}</p>
      ) : (
        <table className="w-full max-w-xl text-sm">
          <thead className="text-left text-xs text-ink-muted">
            <tr>
              <th className="pb-1 pr-2 font-medium">{rotuloNome}</th>
              <th className="w-40 pb-1 pr-2 font-medium">{rotuloValor} (R$)</th>
              <th className="w-8" />
            </tr>
          </thead>
          <tbody>
            {itens.map((i) => (
              <tr key={i.id}>
                <td className="py-1 pr-2">
                  <input value={i.nome} onChange={(e) => trocar(i.id, { nome: e.target.value })} className={inputCls} aria-label={rotuloNome} />
                </td>
                <td className="py-1 pr-2">
                  <NumCampo valor={i.valor} onChange={(valor) => trocar(i.id, { valor })} ariaLabel={`${rotuloValor} de ${i.nome}`} />
                </td>
                <td className="py-1">
                  {!semAdicionar && (
                    <button type="button" onClick={() => onChange(itens.filter((x) => x.id !== i.id))} className="rounded p-1 text-ink-muted hover:text-red-600" aria-label={`Remover ${i.nome}`}>
                      <Trash2 className="h-4 w-4" />
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {!semAdicionar && itens.length < MAX_ITENS_BLOCO && (
        <button
          type="button"
          onClick={() => onChange([...itens, { id: novoId(), nome: novoNome, valor: 0 }])}
          className="inline-flex items-center gap-1 rounded-md border border-dashed border-input px-2.5 py-1 text-xs text-ink-muted hover:text-ink-primary"
        >
          <Plus className="h-3.5 w-3.5" /> Adicionar
        </button>
      )}
    </div>
  );
}

function ListaFaixas({
  bloco,
  faixas,
  onChange,
}: {
  bloco: "gasolina" | "carona";
  faixas: DpFaixaBeneficio[];
  onChange: (f: DpFaixaBeneficio[]) => void;
}) {
  const u = FAIXA_UNIDADE[bloco];
  const trocar = (id: string, p: Partial<DpFaixaBeneficio>) => onChange(faixas.map((f) => (f.id === id ? { ...f, ...p } : f)));
  const adicionar = () => {
    const ultima = faixas.at(-1);
    const de = ultima ? (ultima.ate ?? ultima.de) + (u.inteiro ? 1 : 0.01) : 0;
    onChange([...faixas, { id: novoId(), de: Math.round(de * 100) / 100, ate: null, valor: 0 }]);
  };
  return (
    <div className="space-y-1.5">
      {faixas.length === 0 ? (
        <p className="text-sm text-ink-muted">Nenhuma faixa cadastrada.</p>
      ) : (
        <table className="w-full max-w-2xl text-sm">
          <thead className="text-left text-xs text-ink-muted">
            <tr>
              <th className="w-28 pb-1 pr-2 font-medium">De ({u.unidade})</th>
              <th className="w-28 pb-1 pr-2 font-medium">Até ({u.unidade})</th>
              <th className="w-40 pb-1 pr-2 font-medium">Valor no mês (R$)</th>
              <th className="pb-1 pr-2 font-medium">Faixa</th>
              <th className="w-8" />
            </tr>
          </thead>
          <tbody>
            {faixas.map((f) => (
              <tr key={f.id}>
                <td className="py-1 pr-2">
                  <NumCampo valor={f.de} onChange={(de) => trocar(f.id, { de })} casas={u.inteiro ? 0 : 2} ariaLabel="Início da faixa" />
                </td>
                <td className="py-1 pr-2">
                  <CampoOpcional
                    valor={f.ate}
                    onChange={(ate) => trocar(f.id, { ate })}
                    casas={u.inteiro ? 0 : 2}
                    placeholder="em diante"
                    ariaLabel="Fim da faixa"
                  />
                </td>
                <td className="py-1 pr-2">
                  <NumCampo valor={f.valor} onChange={(valor) => trocar(f.id, { valor })} ariaLabel="Valor da faixa" />
                </td>
                <td className="py-1 pr-2 text-xs text-ink-muted">{rotuloFaixa(bloco, f)}</td>
                <td className="py-1">
                  <button type="button" onClick={() => onChange(faixas.filter((x) => x.id !== f.id))} className="rounded p-1 text-ink-muted hover:text-red-600" aria-label="Remover faixa">
                    <Trash2 className="h-4 w-4" />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {faixas.length < MAX_ITENS_BLOCO && (
        <button
          type="button"
          onClick={adicionar}
          className="inline-flex items-center gap-1 rounded-md border border-dashed border-input px-2.5 py-1 text-xs text-ink-muted hover:text-ink-primary"
        >
          <Plus className="h-3.5 w-3.5" /> Adicionar faixa
        </button>
      )}
      <p className="text-xs text-ink-muted">“Até” em branco = a faixa vale dali em diante (só a última).</p>
    </div>
  );
}

/** Home office: uma linha por nº de dias presenciais na semana ("1 dia — R$ 20"). */
function ListaDias({ itens, onChange }: { itens: DpDiaValor[]; onChange: (i: DpDiaValor[]) => void }) {
  const trocar = (id: string, p: Partial<DpDiaValor>) => onChange(itens.map((x) => (x.id === id ? { ...x, ...p } : x)));
  const livre = Array.from({ length: MAX_DIAS_HOME_OFFICE + 1 }, (_, d) => d).find((d) => !itens.some((x) => x.dias === d));
  return (
    <div className="space-y-1.5">
      {itens.length === 0 ? (
        <p className="text-sm text-ink-muted">Nenhum valor cadastrado.</p>
      ) : (
        <table className="w-full max-w-md text-sm">
          <thead className="text-left text-xs text-ink-muted">
            <tr>
              <th className="w-44 pb-1 pr-2 font-medium">Dias presenciais na semana</th>
              <th className="w-40 pb-1 pr-2 font-medium">Valor (R$)</th>
              <th className="w-8" />
            </tr>
          </thead>
          <tbody>
            {itens.map((x) => (
              <tr key={x.id}>
                <td className="py-1 pr-2">
                  <select value={x.dias} onChange={(e) => trocar(x.id, { dias: Number(e.target.value) })} className={inputCls} aria-label="Dias presenciais na semana">
                    {Array.from({ length: MAX_DIAS_HOME_OFFICE + 1 }, (_, d) => d).map((d) => (
                      <option key={d} value={d} disabled={d !== x.dias && itens.some((o) => o.dias === d)}>
                        {rotuloDias(d)}
                      </option>
                    ))}
                  </select>
                </td>
                <td className="py-1 pr-2">
                  <NumCampo valor={x.valor} onChange={(valor) => trocar(x.id, { valor })} ariaLabel={`Valor para ${rotuloDias(x.dias)}`} />
                </td>
                <td className="py-1">
                  <button type="button" onClick={() => onChange(itens.filter((o) => o.id !== x.id))} className="rounded p-1 text-ink-muted hover:text-red-600" aria-label={`Remover ${rotuloDias(x.dias)}`}>
                    <Trash2 className="h-4 w-4" />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {livre !== undefined && (
        <button
          type="button"
          onClick={() => onChange([...itens, { id: novoId(), dias: livre, valor: 0 }])}
          className="inline-flex items-center gap-1 rounded-md border border-dashed border-input px-2.5 py-1 text-xs text-ink-muted hover:text-ink-primary"
        >
          <Plus className="h-3.5 w-3.5" /> Adicionar
        </button>
      )}
    </div>
  );
}

function SalarioFamilia({
  dados,
  onChange,
  companyId,
  podeEditar,
}: {
  dados: DpBeneficiosDados["salario_familia"];
  onChange: (d: Dados) => void;
  companyId: string;
  podeEditar: boolean;
}) {
  const [buscando, setBuscando] = useState(false);
  const [achado, setAchado] = useState<{ fontes: string[]; aviso: string | null } | null>(null);
  const { showToast } = useToast();

  const buscar = async () => {
    setBuscando(true);
    setAchado(null);
    try {
      const r = await buscarSalarioFamiliaAtualizado({ companyId });
      if (!r.ok) {
        showToast({ title: "Busca sem resultado", description: r.error, variant: "destructive" });
        return;
      }
      const e = r.encontrado;
      // Só preenche o que a busca encontrou; o que veio vazio fica como estava.
      onChange({
        cota: e.cota ?? dados.cota,
        limite: e.limite ?? dados.limite,
        vigencia: e.vigencia ?? dados.vigencia,
        fonte: e.fonte ?? dados.fonte,
      });
      const faltou = [e.cota === null && "a cota", e.limite === null && "o limite"].filter(Boolean).join(" e ");
      setAchado({ fontes: e.fontes, aviso: faltou ? `A busca não encontrou ${faltou} — preencha à mão.` : null });
    } finally {
      setBuscando(false);
    }
  };

  return (
    <div className="space-y-3">
      <div className="grid max-w-2xl gap-3 sm:grid-cols-2">
        <label className="block space-y-1 text-xs">
          <span className="text-ink-muted">Cota por filho (R$)</span>
          <CampoOpcional valor={dados.cota} onChange={(cota) => onChange({ ...dados, cota })} ariaLabel="Cota do salário-família" />
        </label>
        <label className="block space-y-1 text-xs">
          <span className="text-ink-muted">Limite de remuneração (R$)</span>
          <CampoOpcional valor={dados.limite} onChange={(limite) => onChange({ ...dados, limite })} ariaLabel="Limite de remuneração" />
        </label>
        <label className="block space-y-1 text-xs">
          <span className="text-ink-muted">Vigência</span>
          <input value={dados.vigencia ?? ""} onChange={(e) => onChange({ ...dados, vigencia: e.target.value || null })} placeholder="ex.: a partir de 01/01/2026" className={inputCls} />
        </label>
        <label className="block space-y-1 text-xs">
          <span className="text-ink-muted">Fonte</span>
          <input value={dados.fonte ?? ""} onChange={(e) => onChange({ ...dados, fonte: e.target.value || null })} placeholder="ex.: Portaria Interministerial MPS/MF nº 13/2026" className={inputCls} />
        </label>
      </div>
      {podeEditar && (
        <div className="space-y-1.5">
          <button
            type="button"
            onClick={buscar}
            disabled={buscando}
            className="inline-flex items-center gap-1.5 rounded-md border border-input px-3 py-1.5 text-sm hover:bg-muted disabled:opacity-60"
          >
            {buscando ? <Loader2 className="h-4 w-4 animate-spin" /> : <Globe className="h-4 w-4" />}
            {buscando ? "Pesquisando na web… (pode levar até um minuto)" : "Buscar tabela atualizada na web"}
          </button>
          {achado && (
            <div className="rounded-md border border-sky-500/30 bg-sky-500/5 px-3 py-2 text-xs text-ink-secondary">
              <p className="font-medium text-ink-primary">Valores da busca preenchidos acima — confira com a portaria e salve.</p>
              {achado.aviso && <p className="text-amber-800 dark:text-amber-300">{achado.aviso}</p>}
              {achado.fontes.length > 0 && (
                <p className="mt-1">
                  Fontes:{" "}
                  {achado.fontes.slice(0, 4).map((f, i) => (
                    <span key={f}>
                      {i > 0 && " · "}
                      <a href={f} target="_blank" rel="noopener noreferrer" className="underline hover:text-ink-primary">
                        {new URL(f).hostname}
                      </a>
                    </span>
                  ))}
                </p>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/** Número que pode ficar em branco (= não informado). */
function CampoOpcional({
  valor,
  onChange,
  casas = 2,
  placeholder,
  ariaLabel,
}: {
  valor: number | null;
  onChange: (v: number | null) => void;
  casas?: number;
  placeholder?: string;
  ariaLabel?: string;
}) {
  const fmt = (v: number | null) => (v === null ? "" : v.toLocaleString("pt-BR", { maximumFractionDigits: casas, useGrouping: false }));
  const [txt, setTxt] = useState(fmt(valor));
  const [erro, setErro] = useState(false);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => setTxt(fmt(valor)), [valor]);
  return (
    <input
      value={txt}
      inputMode="decimal"
      aria-label={ariaLabel}
      placeholder={placeholder}
      onChange={(e) => {
        setTxt(e.target.value);
        if (!e.target.value.trim()) {
          setErro(false);
          onChange(null);
          return;
        }
        const x = lerNumeroBR(e.target.value);
        setErro(x === null);
        if (x !== null) onChange(x);
      }}
      onBlur={() => !erro && setTxt(fmt(valor))}
      className={`${inputCls} ${erro ? "border-red-500" : ""}`}
    />
  );
}

// ── Reajuste ───────────────────────────────────────────────────────────────

function Reajuste({
  companyId,
  bloco,
  salvo,
  sujo,
  podeEditar,
  reajustes,
  onAplicado,
}: {
  companyId: string;
  bloco: DpBlocoBeneficio;
  salvo: DpBlocoSalvo;
  sujo: boolean;
  podeEditar: boolean;
  reajustes: DpReajusteBeneficio[];
  onAplicado: (dados: Dados, r: DpReajusteBeneficio) => void;
}) {
  const [texto, setTexto] = useState("");
  const [aberto, setAberto] = useState(false);
  const [pending, start] = useTransition();
  const { showToast } = useToast();
  const percentual = lerNumeroBR(texto) ?? NaN;
  const erroPct = texto.trim() ? erroDoPercentual(percentual) : null;
  const valores = useMemo(() => valoresDoBloco(bloco, salvo.dados), [bloco, salvo.dados]);
  const previa = useMemo(() => {
    if (!aberto || erroDoPercentual(percentual)) return [];
    const depois = valoresDoBloco(bloco, reajustarBloco(bloco, salvo.dados, percentual));
    return valores.map((v, i) => ({ ...v, depois: depois[i]?.valor ?? v.valor }));
  }, [aberto, bloco, salvo.dados, percentual, valores]);

  const motivoBloqueio = !salvo.salvo
    ? "Salve o bloco antes de reajustar."
    : sujo
      ? "Há alterações não salvas — salve ou descarte antes de reajustar."
      : valores.length === 0
        ? "Sem valor para reajustar."
        : null;

  const confirmar = () =>
    start(async () => {
      const r = await aplicarReajusteBeneficio({ companyId, bloco, percentual, base: salvo.dados });
      if (!r.ok) {
        showToast({ title: "Reajuste não aplicado", description: r.error, variant: "destructive" });
        return;
      }
      onAplicado(r.dados, { percentual, em: new Date().toISOString(), por: "você" });
      setAberto(false);
      setTexto("");
      showToast({ title: `Reajuste de ${pct(percentual)} aplicado em ${ROTULO_BLOCO[bloco].toLowerCase()}`, variant: "success" });
    });

  return (
    <div className="space-y-1.5 border-t border-border pt-3">
      {podeEditar && (
        <div className="flex flex-wrap items-end gap-2">
          <label className="block space-y-1 text-xs">
            <span className="text-ink-muted">Reajuste (%)</span>
            <input value={texto} onChange={(e) => setTexto(e.target.value)} inputMode="decimal" placeholder="ex.: 5" className={`${inputCls} w-24`} aria-label="Percentual de reajuste" />
          </label>
          <button
            type="button"
            disabled={Boolean(motivoBloqueio) || !texto.trim() || Boolean(erroPct)}
            onClick={() => setAberto(true)}
            className="rounded-md border border-input px-3 py-1.5 text-sm hover:bg-muted disabled:opacity-50"
          >
            Ver o reajuste…
          </button>
          <span className="text-xs text-ink-muted">{erroPct ?? motivoBloqueio ?? "Aplica a todos os valores deste bloco, depois de confirmado."}</span>
        </div>
      )}
      {reajustes.length > 0 && (
        <p className="text-xs text-ink-muted">
          Últimos reajustes:{" "}
          {reajustes.map((r, i) => (
            <span key={`${r.em}-${i}`}>
              {i > 0 && " · "}+{pct(r.percentual)} em {formatDateTimeBR(r.em)}
              {r.por ? ` por ${r.por}` : ""}
            </span>
          ))}
        </p>
      )}

      <Dialog open={aberto} onOpenChange={(v) => !pending && setAberto(v)}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>
              Reajustar {ROTULO_BLOCO[bloco].toLowerCase()} em {pct(percentual)}?
            </DialogTitle>
            <DialogDescription>Todos os valores abaixo mudam ao confirmar. Não há desfazer automático — o reajuste fica no histórico do bloco.</DialogDescription>
          </DialogHeader>
          <div className="max-h-[50vh] overflow-y-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-xs text-ink-muted">
                <tr>
                  <th className="pb-1 pr-3 font-medium">Item</th>
                  <th className="pb-1 pr-3 text-right font-medium">Hoje</th>
                  <th className="pb-1 text-right font-medium">Depois</th>
                </tr>
              </thead>
              <tbody>
                {previa.map((p, i) => (
                  <tr key={`${p.rotulo}-${i}`} className="border-t border-border">
                    <td className="py-1 pr-3">{p.rotulo}</td>
                    <td className="py-1 pr-3 text-right tabular-nums">{brl(p.valor)}</td>
                    <td className="py-1 text-right font-medium tabular-nums">{brl(p.depois)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <DialogFooter className="gap-2 sm:gap-0">
            <button type="button" disabled={pending} onClick={() => setAberto(false)} className="rounded-md border border-input px-3 py-1.5 text-sm hover:bg-muted">
              Voltar
            </button>
            <button
              type="button"
              disabled={pending}
              onClick={confirmar}
              className="inline-flex items-center gap-1 rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
            >
              {pending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              Confirmar reajuste de {pct(percentual)}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/**
 * Copiar os benefícios de outra empresa: escolhe a empresa, vê o que ela tem em
 * cada bloco e marca o que copiar. O bloco copiado SUBSTITUI o desta empresa —
 * a lista avisa quais já existem aqui antes do clique.
 */
function CopiarDialog({ companyId, beneficios, onClose }: { companyId: string; beneficios: DpBeneficiosEmpresa; onClose: () => void }) {
  const [origens, setOrigens] = useState<DpOrigemBeneficios[] | null>(null);
  const [erroLista, setErroLista] = useState<string | null>(null);
  const [origemId, setOrigemId] = useState<string | null>(null);
  const [marcados, setMarcados] = useState<Set<DpBlocoBeneficio>>(new Set());
  const [busca, setBusca] = useState("");
  const [pending, start] = useTransition();
  const router = useRouter();
  const { showToast } = useToast();

  useEffect(() => {
    let vivo = true;
    origensDeCopiaBeneficios({ companyId }).then((r) => {
      if (!vivo) return;
      if (r.ok) setOrigens(r.origens);
      else setErroLista(r.error);
    });
    return () => {
      vivo = false;
    };
  }, [companyId]);

  const origem = origens?.find((o) => o.id === origemId) ?? null;
  const blocosDaOrigem = origem ? BLOCOS_BENEFICIO.filter((b) => origem.blocos[b] !== undefined) : [];
  const q = busca.trim().toLowerCase();
  const visiveis = (origens ?? []).filter((o) => !q || o.nome.toLowerCase().includes(q));

  const escolher = (o: DpOrigemBeneficios) => {
    setOrigemId(o.id);
    setMarcados(new Set(BLOCOS_BENEFICIO.filter((b) => o.blocos[b] !== undefined)));
  };
  const alternar = (b: DpBlocoBeneficio) =>
    setMarcados((m) => {
      const n = new Set(m);
      if (n.has(b)) n.delete(b);
      else n.add(b);
      return n;
    });

  const copiar = () =>
    start(async () => {
      if (!origem) return;
      const r = await copiarBeneficiosDeEmpresa({ companyId, origemId: origem.id, blocos: Array.from(marcados) });
      if (!r.ok) {
        showToast({ title: "Não copiado", description: r.error, variant: "destructive" });
        return;
      }
      showToast({ title: `${r.copiados} bloco${r.copiados === 1 ? "" : "s"} copiado${r.copiados === 1 ? "" : "s"} de ${origem.nome}`, variant: "success" });
      onClose();
      router.refresh();
    });

  const substituidos = Array.from(marcados).filter((b) => beneficios.blocos[b].salvo).length;

  return (
    <Dialog open onOpenChange={(v) => !v && !pending && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{origem ? `Copiar de ${origem.nome}` : "Copiar benefícios de outra empresa"}</DialogTitle>
          <DialogDescription>
            {origem
              ? "Marque os blocos. O bloco copiado substitui o desta empresa; os não marcados ficam como estão. O histórico de reajustes não é copiado."
              : "Escolha a empresa de onde copiar. Só aparecem as que você vê no DP e que têm benefícios salvos."}
          </DialogDescription>
        </DialogHeader>

        {!origem ? (
          origens === null ? (
            erroLista ? (
              <p className="text-sm text-red-700 dark:text-red-400">{erroLista}</p>
            ) : (
              <p className="flex items-center gap-2 text-sm text-ink-muted">
                <Loader2 className="h-4 w-4 animate-spin" /> Carregando as empresas…
              </p>
            )
          ) : origens.length === 0 ? (
            <p className="text-sm text-ink-muted">Nenhuma outra empresa tem benefícios salvos ainda.</p>
          ) : (
            <div className="space-y-2">
              {origens.length > 8 && <input autoFocus value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar empresa" className={inputCls} />}
              <div className="max-h-[50vh] space-y-1.5 overflow-y-auto">
                {visiveis.map((o) => {
                  const n = BLOCOS_BENEFICIO.filter((b) => o.blocos[b] !== undefined).length;
                  return (
                    <button
                      key={o.id}
                      type="button"
                      onClick={() => escolher(o)}
                      className="flex w-full items-center justify-between gap-3 rounded-md border px-3 py-2 text-left hover:bg-muted"
                    >
                      <span className="font-medium text-ink-primary">{o.nome}</span>
                      <span className="text-xs text-ink-muted">
                        {n} bloco{n === 1 ? "" : "s"} salvo{n === 1 ? "" : "s"}
                      </span>
                    </button>
                  );
                })}
                {visiveis.length === 0 && <p className="text-sm text-ink-muted">Nenhuma empresa com esse nome.</p>}
              </div>
            </div>
          )
        ) : (
          <div className="max-h-[50vh] space-y-1.5 overflow-y-auto">
            {blocosDaOrigem.map((b) => {
              const aqui = beneficios.blocos[b];
              return (
                <label key={b} className="flex cursor-pointer items-start gap-2 rounded-md border px-3 py-2 hover:bg-muted/50">
                  <input type="checkbox" checked={marcados.has(b)} onChange={() => alternar(b)} className="mt-1" />
                  <span className="min-w-0 text-sm">
                    <span className="block font-medium text-ink-primary">{ROTULO_BLOCO[b]}</span>
                    <span className="block text-xs text-ink-muted">{resumoDoBloco(b, origem.blocos[b] as never)}</span>
                    {aqui.salvo && marcados.has(b) && (
                      <span className="block text-xs text-amber-800 dark:text-amber-300">
                        Substitui o que está cadastrado aqui ({resumoDoBloco(b, aqui.dados as never)}).
                      </span>
                    )}
                  </span>
                </label>
              );
            })}
          </div>
        )}

        <DialogFooter className="gap-2 sm:justify-between sm:gap-0">
          <div>
            {origem && (
              <button type="button" disabled={pending} onClick={() => setOrigemId(null)} className="rounded-md border border-input px-3 py-1.5 text-sm hover:bg-muted">
                Outra empresa
              </button>
            )}
          </div>
          <div className="flex gap-2">
            <button type="button" disabled={pending} onClick={onClose} className="rounded-md border border-input px-3 py-1.5 text-sm hover:bg-muted">
              Cancelar
            </button>
            {origem && (
              <button
                type="button"
                disabled={pending || marcados.size === 0}
                onClick={copiar}
                className="inline-flex items-center gap-1 rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
              >
                {pending && <Loader2 className="h-4 w-4 animate-spin" />}
                Copiar {marcados.size} bloco{marcados.size === 1 ? "" : "s"}
                {substituidos > 0 ? ` (substitui ${substituidos})` : ""}
              </button>
            )}
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
