// ============================================================================
// Concessões RESERVADAS ao dono do projeto (regra nominal, 26/10/2026).
//
// Duas coisas só o Lucas Meireles concede, mesmo havendo outros admins:
//   1. o módulo Departamento Pessoal — a qualquer pessoa, inclusive a um admin
//      (admin NÃO herda o DP: o DP de cada um é marcado por ele, um a um);
//   2. o acesso às empresas Dataforte, VE Franqueadora e SPDX, em qualquer
//      módulo da tela de Usuários (Financeiro, Orçamento, DP).
//
// Os outros admins seguem administrando o resto da tela. Para eles a seção do
// DP nem aparece — nem a regra dela no catálogo de regras especiais —, e as
// três empresas não podem ser ACRESCENTADAS (tirar continua possível: tirar
// acesso não expõe nada).
//
// Fixado pelo ID, não pelo e-mail: o e-mail se edita, o id do login não.
// O servidor confere tudo de novo (gravar-acessos.ts e /api/segments/companies)
// — esconder da tela nunca é a única defesa.
//
// Client-safe: só constantes e funções puras.
// ============================================================================

/** Lucas Meireles (lucas@quokka.net.br). */
export const CONCEDENTE_RESERVADO_ID = "8f794ea7-dec9-47f6-9eb8-20a8e8d025e9";
export const CONCEDENTE_RESERVADO_NOME = "Lucas Meireles";

/** Empresas que só o concedente reservado libera. A "VE Franqueadora Filial" é outra empresa e não entra. */
export const EMPRESAS_RESERVADAS: ReadonlyArray<{ id: string; nome: string }> = [
  { id: "56c44737-09d5-49ff-9248-a460216526fc", nome: "Dataforte" },
  { id: "0ec8c4e9-2b7c-420a-8431-770a81868e69", nome: "VE Franqueadora" },
  { id: "f2b965e7-6392-43cd-975d-fca551749549", nome: "SPDX" },
];

const RESERVADAS = new Set(EMPRESAS_RESERVADAS.map((e) => e.id));

export const AVISO_EMPRESA_RESERVADA = `Só ${CONCEDENTE_RESERVADO_NOME} libera acesso a ${EMPRESAS_RESERVADAS.map((e) => e.nome).join(", ").replace(/, ([^,]*)$/, " e $1")}.`;

/** Quem está logado pode conceder o DP e as empresas reservadas? */
export function podeConcederReservado(userId: string | null | undefined): boolean {
  return Boolean(userId) && userId === CONCEDENTE_RESERVADO_ID;
}

export function empresaReservada(companyId: string): boolean {
  return RESERVADAS.has(companyId);
}

export interface EscopoDeEmpresas {
  financeiro: string[];
  orcamento: string[];
  /** empresa → nomes dos setores do Orçamento. */
  setoresOrcamento: Record<string, string[]>;
}

/**
 * O que um pedido ACRESCENTA nas empresas reservadas em relação ao que a
 * pessoa já tem — o que só o concedente reservado pode fazer. Lista vazia =
 * nada reservado foi acrescentado (manter ou tirar é livre). Setor novo do
 * Orçamento numa empresa reservada conta como acréscimo: amplia o que a pessoa
 * vê lá dentro.
 */
export function acrescimosReservados(pedido: EscopoDeEmpresas, atual: EscopoDeEmpresas): string[] {
  const out = new Set<string>();
  for (const [lista, antes] of [
    [pedido.financeiro, atual.financeiro],
    [pedido.orcamento, atual.orcamento],
  ] as const) {
    for (const id of lista) if (empresaReservada(id) && !antes.includes(id)) out.add(id);
  }
  for (const [empresa, setores] of Object.entries(pedido.setoresOrcamento)) {
    if (!empresaReservada(empresa)) continue;
    const antes = atual.setoresOrcamento[empresa] ?? [];
    if (setores.some((s) => !antes.includes(s))) out.add(empresa);
  }
  return Array.from(out);
}
