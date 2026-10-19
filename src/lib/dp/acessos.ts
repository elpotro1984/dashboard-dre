// ============================================================================
// Concessões do Departamento Pessoal — regras puras e testadas da tela
// Configurações › Acessos. A action só obedece: lê o estado, pergunta aqui e
// grava. Ficam aqui as travas que, quebradas, deixam o módulo sem dono ou
// abrem o sigilo:
//
//  - e-mail bloqueado (a Carol) nunca recebe, com nenhum papel;
//  - ninguém tira o PRÓPRIO papel de gestor nem remove o próprio acesso — o
//    gesto é de outro gestor, senão um clique errado tranca a pessoa fora;
//  - sempre sobra pelo menos UM gestor ativo: sem ele ninguém mais concede,
//    e o caminho de volta seria SQL com o service role;
//  - analista recebe só empresas que existem; gestor não guarda lista (vê
//    todas), então a lista dele é descartada em vez de ficar valendo calada
//    para o dia em que ele virar analista.
// ============================================================================

import { dpBloqueado, type DpRole } from "@/lib/auth/dp";

export const ROTULO_PAPEL: Record<DpRole, string> = {
  gestor: "Gestor",
  analista: "Analista",
};

export const DESCRICAO_PAPEL: Record<DpRole, string> = {
  gestor: "Todas as empresas, Configurações e Acessos.",
  analista: "Só as empresas liberadas; trabalha nas telas da empresa, sem Configurações.",
};

export interface DpAlvoConcessao {
  id: string;
  email: string | null;
  active: boolean;
}

export interface DpEstadoConcessoes {
  /** Quem está fazendo o gesto (já passou por requireDpGestor). */
  quemId: string;
  /** Papel atual do alvo (null = ainda sem o módulo). */
  papelAtual: DpRole | null;
  /** Ids dos gestores ATIVOS e não bloqueados hoje (o alvo incluso, se for). */
  gestoresAtivos: string[];
  /** O alvo tem linha no banco que a sessão ignora (e-mail bloqueado, papel desconhecido). */
  linhaSemEfeito?: boolean;
}

export type DpResultadoRegra<T> = { ok: T } | { erro: string };

function sobraGestor(estado: DpEstadoConcessoes, alvoId: string): boolean {
  return estado.gestoresAtivos.some((id) => id !== alvoId);
}

export function validarConcessao(
  alvo: DpAlvoConcessao,
  papel: string,
  empresas: string[],
  empresasValidas: ReadonlySet<string>,
  estado: DpEstadoConcessoes,
): DpResultadoRegra<{ acao: "concedeu" | "alterou"; papel: DpRole; empresas: string[] }> {
  if (papel !== "gestor" && papel !== "analista") return { erro: "Papel inválido." };
  if (dpBloqueado(alvo.email)) return { erro: "Este usuário não pode receber o Departamento Pessoal." };
  if (!alvo.active) return { erro: "Usuário inativo — reative-o antes de conceder o módulo." };

  const rebaixa = estado.papelAtual === "gestor" && papel !== "gestor";
  if (rebaixa && alvo.id === estado.quemId) {
    return { erro: "Você não pode tirar o próprio papel de gestor — peça a outro gestor." };
  }
  if (rebaixa && !sobraGestor(estado, alvo.id)) {
    return { erro: "O DP precisa de pelo menos um gestor — promova outra pessoa antes." };
  }

  let lista: string[] = [];
  if (papel === "analista") {
    lista = Array.from(new Set(empresas));
    if (lista.some((id) => !empresasValidas.has(id))) return { erro: "Empresa inválida na lista." };
  }
  return { ok: { acao: estado.papelAtual === null ? "concedeu" : "alterou", papel, empresas: lista } };
}

export function validarRemocao(alvoId: string, estado: DpEstadoConcessoes): DpResultadoRegra<true> {
  // Linha sem efeito sai sempre: limpar o que a sessão já ignora não tira acesso de ninguém.
  if (estado.papelAtual === null) {
    return estado.linhaSemEfeito ? { ok: true } : { erro: "Este usuário não tem o Departamento Pessoal." };
  }
  if (alvoId === estado.quemId) return { erro: "Você não pode remover o próprio acesso — peça a outro gestor." };
  if (estado.papelAtual === "gestor" && !sobraGestor(estado, alvoId)) {
    return { erro: "O DP precisa de pelo menos um gestor — promova outra pessoa antes." };
  }
  return { ok: true };
}

/** Diferença entre a lista atual e a nova de empresas (o que inserir e o que apagar). */
export function diffEmpresas(atual: string[], nova: string[]): { inserir: string[]; apagar: string[] } {
  const a = new Set(atual);
  const n = new Set(nova);
  return {
    inserir: Array.from(n).filter((id) => !a.has(id)),
    apagar: Array.from(a).filter((id) => !n.has(id)),
  };
}
