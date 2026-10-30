// =============================================================================
// Andamento de cada MÉTODO, para o card do hub ("10/30 categorias finalizadas ·
// 5 em andamento"). Pedido do dono do projeto em 30/10/2026.
//
// "Feito" é FINALIZADO — o botão "Finalizar orçamento", que trava a parte e a
// manda ao Budget. É o único fim que o módulo tem; contar "preenchido" como
// feito diria que está pronto o que ainda pode mudar. O texto do card diz
// "finalizadas", não "realizadas": no orçamento, "realizado" é o gasto do ano
// anterior, e a palavra induziria a ler o card como dinheiro.
//
// A UNIDADE muda com o método, porque é a unidade em que cada um se fecha:
//   - Média, Valor fixo e Planejamento → a CATEGORIA marcada com o método;
//   - Pessoal → o SETOR (a fatia do pessoal é o quadro do setor inteiro), ou
//     o QUADRO da empresa quando ela não orça por setor;
//   - Viagens → a VIAGEM (cai na fatia categoria × setor dela).
//
// ── Onde mora a fatia de quem não orça por setor ─────────────────────────────
// Média, Valor fixo, Planejamento e Viagens gravam no balde "Não atribuído"
// (`setorParaGravar`); o Pessoal grava setor nulo. `fatiaFechada` aceita os
// dois, e é a mesma regra que pinta o card verde do Planejamento.
// =============================================================================

import { chaveFinalizacao } from "@/lib/orcamento/finalizacao";
import type { OrcamentoMetodo } from "@/lib/orcamento/metodos";

/**
 * A fatia (método × categoria × setor) está finalizada?
 *
 * `fechadas` são as chaves de `orcamento_finalizacoes` (`chaveFinalizacao`).
 * Orçando por setor vale o setor da linha; sem setor, o balde ou o nulo.
 */
export function fatiaFechada(
  fechadas: ReadonlySet<string>,
  metodo: OrcamentoMetodo,
  categoryCode: string,
  setorId: string | null,
  porSetor: boolean,
  baldeId: string | null,
): boolean {
  const tem = (setor: string | null) =>
    fechadas.has(chaveFinalizacao({ metodo, categoryCode, setorId: setor }));
  if (porSetor) return tem(setorId);
  return (baldeId != null && tem(baldeId)) || tem(null);
}

export type UnidadeProgresso = "categoria" | "setor" | "quadro" | "viagem";

export interface ProgressoMetodo {
  unidade: UnidadeProgresso;
  total: number;
  finalizadas: number;
  /** Começadas e ainda não finalizadas. O resto do total não foi iniciado. */
  emAndamento: number;
}

/**
 * Métodos por CATEGORIA (média, valor fixo, planejamento).
 *
 * Orçando por setor, a categoria só está finalizada quando TODOS os setores
 * dela estão — os atribuídos a ela e os que têm dado (uma linha gravada num
 * setor que não está na atribuição também precisa fechar). Um setor fechado e
 * outro aberto é "em andamento".
 *
 * `escopo` recorta os setores (o Gerente vê o andamento dos setores dele);
 * `null` = todos. Categoria sem nenhum setor no escopo sai do total.
 */
export function progressoPorCategoria(p: {
  metodo: OrcamentoMetodo;
  categorias: readonly string[];
  porSetor: boolean;
  baldeId: string | null;
  fechadas: ReadonlySet<string>;
  /** categoria → setores atribuídos (`orcamento_categoria_setores`). */
  atribuidos: ReadonlyMap<string, readonly string[]>;
  /** categoria → setores em que há dado gravado (`null` = sem setor). */
  comDado: ReadonlyMap<string, ReadonlySet<string | null>>;
  escopo: readonly string[] | null;
}): ProgressoMetodo {
  const out: ProgressoMetodo = { unidade: "categoria", total: 0, finalizadas: 0, emAndamento: 0 };
  const noEscopo = (s: string) => p.escopo === null || p.escopo.includes(s);

  for (const code of p.categorias) {
    if (!p.porSetor) {
      out.total += 1;
      if (fatiaFechada(p.fechadas, p.metodo, code, null, false, p.baldeId)) out.finalizadas += 1;
      else if (p.comDado.has(code)) out.emAndamento += 1;
      continue;
    }

    const setores = new Set<string>((p.atribuidos.get(code) ?? []).filter(noEscopo));
    p.comDado.get(code)?.forEach((s) => {
      if (s !== null && noEscopo(s)) setores.add(s);
    });
    if (setores.size === 0) continue;
    out.total += 1;

    const fechados = Array.from(setores).filter((s) =>
      fatiaFechada(p.fechadas, p.metodo, code, s, true, p.baldeId),
    );
    const temDado = Array.from(setores).some((s) => p.comDado.get(code)?.has(s));
    if (fechados.length === setores.size) out.finalizadas += 1;
    else if (fechados.length > 0 || temDado) out.emAndamento += 1;
  }
  return out;
}

/**
 * PESSOAL. A fatia é o quadro do setor inteiro (categoria vazia).
 *
 * Sem setor, é UM quadro — o da empresa. Com setor, um por setor ativo no
 * escopo; o balde "Não atribuído" só entra se tiver gente (vazio, ele não é um
 * setor que alguém precise orçar).
 */
export function progressoPessoal(p: {
  porSetor: boolean;
  baldeId: string | null;
  fechadas: ReadonlySet<string>;
  /** Setores ativos no escopo de quem vê (sem o balde). */
  setores: readonly string[];
  /** setor → colaboradores ativos (`null` = sem setor). */
  colaboradores: ReadonlyMap<string | null, number>;
}): ProgressoMetodo {
  if (!p.porSetor) {
    const total = Array.from(p.colaboradores.values()).reduce((a, n) => a + n, 0);
    const fechado = fatiaFechada(p.fechadas, "pessoal", "", null, false, p.baldeId);
    return {
      unidade: "quadro",
      total: 1,
      finalizadas: fechado ? 1 : 0,
      emAndamento: !fechado && total > 0 ? 1 : 0,
    };
  }

  const setores = new Set(p.setores);
  if (p.baldeId && (p.colaboradores.get(p.baldeId) ?? 0) > 0) setores.add(p.baldeId);

  const out: ProgressoMetodo = { unidade: "setor", total: 0, finalizadas: 0, emAndamento: 0 };
  setores.forEach((s) => {
    out.total += 1;
    if (fatiaFechada(p.fechadas, "pessoal", "", s, true, p.baldeId)) out.finalizadas += 1;
    else if ((p.colaboradores.get(s) ?? 0) > 0) out.emAndamento += 1;
  });
  return out;
}

/**
 * VIAGENS. A unidade é a viagem: finalizada quando a fatia dela (categoria ×
 * setor) foi finalizada; em andamento quando já saiu do RASCUNHO (o gestor deu
 * o OK, está em cotação ou com a diretoria). Rascunho é "não iniciada" — ainda
 * está na mão de quem preenche.
 */
export function progressoViagens(p: {
  porSetor: boolean;
  baldeId: string | null;
  fechadas: ReadonlySet<string>;
  viagens: readonly { status: string; categoryCode: string | null; setorId: string | null }[];
}): ProgressoMetodo {
  const out: ProgressoMetodo = { unidade: "viagem", total: 0, finalizadas: 0, emAndamento: 0 };
  for (const v of p.viagens) {
    out.total += 1;
    const fechada =
      !!v.categoryCode &&
      fatiaFechada(p.fechadas, "viagens", v.categoryCode, v.setorId, p.porSetor, p.baldeId);
    if (fechada) out.finalizadas += 1;
    else if (v.status !== "rascunho") out.emAndamento += 1;
  }
  return out;
}

const NOMES: Record<UnidadeProgresso, { um: string; varios: string; feminino: boolean }> = {
  categoria: { um: "categoria", varios: "categorias", feminino: true },
  setor: { um: "setor", varios: "setores", feminino: false },
  quadro: { um: "quadro", varios: "quadros", feminino: false },
  viagem: { um: "viagem", varios: "viagens", feminino: true },
};

/**
 * O texto do card. `null` quando não há o que contar (método sem nenhuma
 * categoria marcada, nenhuma viagem): "0/0" num card é ruído.
 *
 * O quadro único (pessoal de empresa sem setor) não vira "0/1": diz o estado.
 */
export function textoProgresso(
  p: ProgressoMetodo | null | undefined,
): { principal: string; secundario: string | null; completo: boolean } | null {
  if (!p || p.total === 0) return null;
  const n = NOMES[p.unidade];
  const fin = n.feminino ? "finalizada" : "finalizado";
  const completo = p.finalizadas === p.total;

  if (p.unidade === "quadro") {
    const estado = completo ? fin : p.emAndamento > 0 ? "em andamento" : "não iniciado";
    return { principal: `Quadro ${estado}`, secundario: null, completo };
  }

  const nome = p.total === 1 ? n.um : n.varios;
  return {
    principal: `${p.finalizadas}/${p.total} ${nome} ${p.total === 1 ? fin : `${fin}s`}`,
    secundario: p.emAndamento > 0 ? `${p.emAndamento} em andamento` : null,
    completo,
  };
}
