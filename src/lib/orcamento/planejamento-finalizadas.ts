// =============================================================================
// Planejamento dos gestores — que categorias já foram FINALIZADAS e qual é a
// PRÓXIMA em aberto.
//
// Duas telas perguntam a mesma coisa: a lista (o card fica verde com a tag
// "Finalizada") e a montagem (depois de finalizar, a caixa que diz o que falta
// e leva à próxima). A regra mora aqui para as duas nunca discordarem — uma
// lista dizendo "Finalizada" e a caixa dizendo que ela ainda falta seria pior
// do que nenhuma das duas.
//
// ── O setor da fatia de quem NÃO orça por setor é o balde ───────────────────
// A despesa dessas empresas é gravada no "Não atribuído" (`setorParaGravar`),
// e é nele que o Finalizar fecha a fatia (`setorFinalizacao`, 30/10/2026). A
// fatia em setor NULO também conta: era o que a montagem passava antes da
// correção, e uma categoria fechada assim continua fechada.
// =============================================================================

import { chaveFinalizacao } from "@/lib/orcamento/finalizacao";
import { fatiaFechada } from "@/lib/orcamento/progresso";

const METODO = "planejamento_socios" as const;

/** Chave da fatia do Planejamento, no formato do índice de finalizações. */
export function chaveFatiaPlanejamento(categoryCode: string, setorId: string | null): string {
  return chaveFinalizacao({ metodo: METODO, categoryCode, setorId });
}

/**
 * A fatia (categoria × setor) está finalizada?
 *
 * `fechadas` são as chaves de `orcamento_finalizacoes` (`chaveFinalizacao`).
 * Com "Orçar por setor" ligado vale o setor da linha; desligado, o balde
 * "Não atribuído" ou o setor nulo (ver o topo do arquivo).
 */
export function fatiaFinalizada(
  fechadas: ReadonlySet<string>,
  categoryCode: string,
  setorId: string | null,
  porSetor: boolean,
  baldeId: string | null,
): boolean {
  // A regra é a dos cards do hub (`progresso.ts`): uma só para os dois.
  return fatiaFechada(fechadas, METODO, categoryCode, setorId, porSetor, baldeId);
}

/** Uma fatia como a lista a mostra: categoria × setor, já com o estado. */
export interface FatiaPlanejamento {
  categoryCode: string;
  categoryName: string;
  /** `null` em empresa que não orça por setor (o card não tem setor). */
  setorId: string | null;
  setorNome: string;
  finalizada: boolean;
}

/** "Marketing" ou "Marketing · Comercial" — como a caixa nomeia o que falta. */
export function rotuloFatia(f: Pick<FatiaPlanejamento, "categoryName" | "setorNome">): string {
  return f.setorNome ? `${f.categoryName} · ${f.setorNome}` : f.categoryName;
}

const comparar = (a: string, b: string) =>
  a.localeCompare(b, "pt-BR", { sensitivity: "base" });

/** A ordem da lista: categoria em ordem alfabética, depois o setor. */
export function ordenarFatias(fatias: readonly FatiaPlanejamento[]): FatiaPlanejamento[] {
  return fatias
    .slice()
    .sort((a, b) => comparar(a.categoryName, b.categoryName) || comparar(a.setorNome, b.setorNome));
}

/** As que ainda faltam finalizar, na ordem da lista. */
export function pendentesDeFinalizacao(
  fatias: readonly FatiaPlanejamento[],
): FatiaPlanejamento[] {
  return ordenarFatias(fatias).filter((f) => !f.finalizada);
}

/**
 * A PRÓXIMA em aberto depois da atual, na ordem da lista — dando a volta no
 * fim, para a última categoria levar à primeira que ainda falta em vez de a
 * lugar nenhum. A própria atual nunca é a próxima (seguir para ela seria ficar
 * onde já se está), mesmo que siga em aberto.
 *
 * A atual pode não estar na lista (fora do escopo de quem finalizou): aí a
 * próxima é a primeira pendente depois de onde ela ESTARIA na ordem.
 */
export function proximaPendente(
  fatias: readonly FatiaPlanejamento[],
  atual: { categoryCode: string; categoryName: string; setorId: string | null; setorNome?: string },
): FatiaPlanejamento | null {
  const ordem = ordenarFatias(fatias);
  const ehAtual = (f: FatiaPlanejamento) =>
    f.categoryCode === atual.categoryCode && (f.setorId ?? null) === (atual.setorId ?? null);

  let inicio = ordem.findIndex(ehAtual);
  if (inicio === -1) {
    // Onde a atual estaria: a primeira que vem DEPOIS dela na ordem.
    const nomeAtual = atual.categoryName;
    const setorAtual = atual.setorNome ?? "";
    const depois = ordem.findIndex(
      (f) =>
        comparar(f.categoryName, nomeAtual) > 0 ||
        (comparar(f.categoryName, nomeAtual) === 0 && comparar(f.setorNome, setorAtual) > 0),
    );
    inicio = (depois === -1 ? ordem.length : depois) - 1;
  }

  for (let passo = 1; passo <= ordem.length; passo += 1) {
    const f = ordem[(inicio + passo + ordem.length) % ordem.length];
    if (!f.finalizada && !ehAtual(f)) return f;
  }
  return null;
}
