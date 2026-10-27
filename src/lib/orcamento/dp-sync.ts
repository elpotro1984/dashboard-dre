// =============================================================================
// Puxar o quadro de pessoal do DEPARTAMENTO PESSOAL para o Orçamento.
//
// O gestor digitava à mão um quadro que o DP já mantém espelhado da Sólides.
// Este módulo é a regra que decide, pessoa a pessoa, o que entraria no quadro
// do orçamento — e, principalmente, o que NÃO entra e por quê.
//
// Módulo PURO (sem "use server"): a mesma conta vale no servidor, que grava, e
// na tela, que mostra a prévia antes de qualquer gravação.
//
// ── O contrato, decidido em 27/10/2026 ────────────────────────────────────
//  1. O sync SÓ SUGERE. Nada é gravado sem a marca do admin, item por item.
//     A prévia pré-marca as pessoas NOVAS (é só ganho) e deixa DESMARCADO
//     quem já está no quadro e teria cargo ou salário sobrescrito.
//  2. Nunca remove. Quem está no quadro e não está mais no cadastro ativo do
//     DP vira AVISO (`apenasNoQuadro`), não exclusão — pode ser contratação
//     planejada, que não existe na Sólides por definição.
//  3. Nunca escreve MOVIMENTAÇÃO. Movimentação é decisão do gestor. Nem o
//     desligamento já registrado no cadastro: a data aparece como aviso na
//     linha e o gestor registra a movimentação se quiser.
//  4. Nunca toca em BENEFÍCIO. A tabela salarial do DP não tem benefício;
//     quem os define é o Plano de Cargos do Orçamento.
//  5. Salário é RETRATO copiado, como no Plano de Cargos. Mudar a Sólides em
//     dezembro não mexe no que já foi montado.
// =============================================================================

import { isVinculo, type VinculoKey } from "@/lib/orcamento/vinculos";

// ─── Normalização ────────────────────────────────────────────────────────────

/**
 * Chave de comparação de um DEPARTAMENTO do DP, para o de-para.
 *
 * Minúsculas, SEM ACENTO e espaços colapsados — e aqui a diferença para
 * `chaveSetorNome` (que de propósito não tira acento) é deliberada. Lá os dois
 * lados são o mesmo cadastro atravessando anos, então "Gestão" × "Gestao" é
 * erro de digitação que merece ser corrigido. Aqui a chave vem de um cadastro
 * de FORA (a Sólides), editado por outras pessoas: um acento que aparece ou
 * desaparece lá não pode desfazer um de-para que o admin já confirmou.
 */
export function chaveDepartamento(nome: string | null | undefined): string {
  return semAcento(nome).replace(/\s+/g, " ").trim().toLowerCase();
}

/** Chave de comparação de NOME DE PESSOA entre o DP e o quadro do orçamento. */
export function chaveNomePessoa(nome: string | null | undefined): string {
  return chaveDepartamento(nome);
}

function semAcento(v: string | null | undefined): string {
  return (v ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "");
}

function palavras(nome: string | null | undefined): string[] {
  return chaveNomePessoa(nome).split(" ").filter(Boolean);
}

// ─── Vínculo: o vocabulário da Sólides é maior que o do quadro ───────────────

/**
 * O `vinculo` do quadro aceita só três valores (`clt` | `pj` | `estagio`) e a
 * Sólides usa um vocabulário maior — jovem aprendiz, sócio, prestador — e, em
 * 02/10/2026, 39 dos 207 ativos estavam SEM tipo de contrato nenhum.
 *
 * Sem tipo cai em CLT **com aviso**, nunca calado: é o precedente da folha do
 * DP, e numa decisão de custo errar para mais é melhor que errar para menos.
 * Jovem aprendiz é CLT (tem FGTS, à alíquota de 2% — o DP já trata isso);
 * sócio, prestador, autônomo e MEI entram como PJ, que é como o motor do
 * orçamento os cobra (valor sem encargo).
 */
export function vinculoDoContrato(
  tipoContrato: string | null | undefined,
): { vinculo: VinculoKey; aviso: string | null } {
  // Pontuação vira espaço ANTES da comparação: a Sólides escreve "Pró-labore",
  // "Pró labore" e "PJ / Prestador" para a mesma coisa, e só tirar o acento
  // deixava "pro-labore" sem casar com "pro labore" — caía no padrão CLT com
  // aviso, que é o jeito mais discreto possível de errar o custo de um sócio
  // (CLT carrega encargo, férias e 13º; PJ entra só com o valor).
  const t = chaveDepartamento(tipoContrato).replace(/[^a-z0-9]+/g, " ").trim();
  if (!t) {
    return {
      vinculo: "clt",
      aviso: "sem tipo de contrato na Sólides — entra como CLT (confira)",
    };
  }
  if (t.includes("estagi")) return { vinculo: "estagio", aviso: null };
  // Aprendiz ANTES de qualquer teste de CLT: "jovem aprendiz" não contém "clt",
  // mas um dia pode vir escrito "CLT - Jovem Aprendiz".
  if (t.includes("aprendiz")) return { vinculo: "clt", aviso: null };
  if (
    t.includes("socio") ||
    t.includes("pro labore") ||
    t.includes("prolabore") ||
    t.includes("prestador") ||
    t.includes("autonomo") ||
    t.includes("mei") ||
    t === "pj" ||
    t.includes("pessoa juridica")
  ) {
    return { vinculo: "pj", aviso: null };
  }
  if (
    t.includes("clt") ||
    t.includes("efetivo") ||
    t.includes("experiencia") ||
    t.includes("determinado") ||
    t.includes("indeterminado") ||
    t.includes("intermitente") ||
    t.includes("temporario")
  ) {
    return { vinculo: "clt", aviso: null };
  }
  return {
    vinculo: "clt",
    aviso: `tipo de contrato "${(tipoContrato ?? "").trim()}" não reconhecido — entra como CLT (confira)`,
  };
}

// ─── O de-para departamento → setor ─────────────────────────────────────────

export interface SetorDoAno {
  id: string;
  name: string;
}

export interface DeParaLinha {
  departamento: string;
  setorNome: string;
}

/**
 * Sugestão de de-para por nome, para a tela abrir preenchida.
 *
 * É SÓ sugestão: o admin confirma, e é por isso que ela pode ser generosa
 * (ignora acento e caixa) — ao contrário da resolução do setor na hora do sync,
 * que exige o de-para gravado. Departamento que não casa com nenhum setor fica
 * de fora do mapa, e a tela o mostra pedindo a escolha.
 */
export function sugerirDePara(
  departamentos: readonly string[],
  setoresDoAno: readonly SetorDoAno[],
): Map<string, string> {
  const porChave = new Map<string, string>();
  for (const s of setoresDoAno) {
    const k = chaveDepartamento(s.name);
    if (k && !porChave.has(k)) porChave.set(k, s.name);
  }

  const out = new Map<string, string>();
  for (const dep of departamentos) {
    const k = chaveDepartamento(dep);
    if (!k) continue;
    const achado = porChave.get(k);
    if (achado) out.set(k, achado);
  }
  return out;
}

/** Index do de-para gravado: chave do departamento → nome do setor. */
export function indexarDePara(linhas: readonly DeParaLinha[]): Map<string, string> {
  const out = new Map<string, string>();
  for (const l of linhas) {
    const k = chaveDepartamento(l.departamento);
    if (k) out.set(k, l.setorNome);
  }
  return out;
}

// ─── Casamento com quem já está no quadro ───────────────────────────────────

export type Casamento =
  | { tipo: "nenhum" }
  | { tipo: "um"; id: string }
  | { tipo: "ambiguo"; quantos: number };

/**
 * Casa um nome do DP com as linhas que já estão no quadro.
 *
 * A regra é a MESMA da importação da folha do DP, e por isso não se reescreve
 * aqui de outro jeito: nome exato (sem acento, sem caixa) primeiro; depois
 * continência de palavras, e só quando há UM candidato; ambíguo nunca casa.
 *
 * A continência exige pelo menos DUAS palavras do lado mais curto — senão um
 * "Ana" solto no quadro casaria com a primeira Ana da lista, e um falso
 * positivo aqui sobrescreve a pessoa errada.
 */
export function casarComQuadro(
  nome: string,
  quadro: readonly { id: string; nome: string | null }[],
): Casamento {
  const chave = chaveNomePessoa(nome);
  if (!chave) return { tipo: "nenhum" };

  const exatos = quadro.filter((q) => chaveNomePessoa(q.nome) === chave);
  if (exatos.length === 1) return { tipo: "um", id: exatos[0].id };
  if (exatos.length > 1) return { tipo: "ambiguo", quantos: exatos.length };

  const minhas = palavras(nome);
  const candidatos = quadro.filter((q) => {
    const dele = palavras(q.nome);
    if (dele.length === 0) return false;
    const [curto, longo] = minhas.length <= dele.length ? [minhas, dele] : [dele, minhas];
    if (curto.length < 2) return false;
    return curto.every((p) => longo.includes(p));
  });
  if (candidatos.length === 1) return { tipo: "um", id: candidatos[0].id };
  if (candidatos.length > 1) return { tipo: "ambiguo", quantos: candidatos.length };
  return { tipo: "nenhum" };
}

// ─── A prévia ───────────────────────────────────────────────────────────────

/** Uma pessoa como o DP a entrega, já com a empresa resolvida pelo de-para dele. */
export interface DpPessoa {
  solidesId: string;
  nome: string;
  /** Departamento do DP, já sem o sufixo "- EMPRESA". */
  departamento: string | null;
  /** Cargo da Sólides, como está lá. */
  cargoSolides: string | null;
  /**
   * Nome normalizado da linha da tabela salarial do DP (cargo + senioridade +
   * step), quando a pessoa tem linha vinculada. É o que o campo "cargo atual"
   * recebe quando existe — vocabulário igual ao da movimentação.
   */
  cargoDaLinha: string | null;
  salario: number | null;
  tipoContrato: string | null;
  dataDesligamento: string | null;
}

/** Uma linha que já está no quadro do orçamento. */
export interface QuadroLinha {
  id: string;
  nome: string | null;
  setorId: string | null;
  cargoAtual: string | null;
  salarioAtual: number | null;
  vinculo: string;
  /** Decidida pela diretoria (aprovado/reprovado) ou em fatia finalizada. */
  travado: boolean;
  travadoMotivo?: string | null;
}

export type EstadoItem = "nova" | "conflito" | "igual" | "fora";

export type MotivoFora =
  | "sem_departamento"
  | "departamento_nao_mapeado"
  | "setor_fora_do_ano"
  | "nome_ambiguo"
  | "fatia_finalizada"
  | "decidida";

export const MOTIVO_FORA_LABEL: Record<MotivoFora, string> = {
  sem_departamento: "sem departamento no cadastro do DP",
  departamento_nao_mapeado: "departamento sem setor no de-para",
  setor_fora_do_ano: "o setor do de-para não existe neste ano",
  nome_ambiguo: "há mais de uma pessoa com este nome no quadro",
  fatia_finalizada: "o orçamento de pessoal deste setor está finalizado",
  decidida: "a diretoria já decidiu esta linha — sincronizar desfaria a decisão",
};

export interface PreviaDpItem {
  solidesId: string;
  nome: string;
  estado: EstadoItem;
  /** Vem marcada na tela? Novas sim; conflito não; igual e fora, nunca. */
  marcada: boolean;
  /** O que entraria no quadro. */
  setorId: string | null;
  setorNome: string | null;
  departamento: string | null;
  cargo: string | null;
  salario: number | null;
  vinculo: VinculoKey;
  /** A linha do quadro que este item atualizaria (conflito/igual). */
  quadroId: string | null;
  atual: { cargo: string | null; salario: number | null; vinculo: string } | null;
  avisos: string[];
  motivoFora: MotivoFora | null;
}

export interface PreviaDpSync {
  itens: PreviaDpItem[];
  /**
   * Está no quadro e NÃO no cadastro ativo do DP. Só aviso — o sync nunca
   * remove. Contratação planejada cai aqui por definição.
   */
  apenasNoQuadro: Array<{ id: string; nome: string; setorId: string | null }>;
  /** Departamentos que apareceram e não têm setor no de-para. */
  departamentosNaoMapeados: string[];
  resumo: {
    novas: number;
    conflitos: number;
    iguais: number;
    fora: number;
    semSalario: number;
    marcadas: number;
  };
}

/** Diferença de até um centavo não é conflito — é arredondamento. */
const EPSILON = 0.005;

function mesmoSalario(a: number | null, b: number | null): boolean {
  if (a == null && b == null) return true;
  if (a == null || b == null) return false;
  return Math.abs(a - b) < EPSILON;
}

function mesmoTexto(a: string | null, b: string | null): boolean {
  return (a ?? "").trim() === (b ?? "").trim();
}

export function montarPrevia(input: {
  pessoas: readonly DpPessoa[];
  quadro: readonly QuadroLinha[];
  dePara: Map<string, string>;
  setoresDoAno: readonly SetorDoAno[];
  /** A empresa orça por setor? Quando não, todo mundo entra sem setor. */
  orcaPorSetor: boolean;
  /**
   * Setores cuja fatia de PESSOAL já foi finalizada (publicada no Budget).
   * `null` entra no conjunto quando a empresa não orça por setor.
   *
   * Finalizar trava a fatia para TODO MUNDO, inclusive para o admin — é a
   * diferença deliberada para a trava da validação. As actions já recusam, mas
   * oferecer a caixa e ver 40 itens voltarem com erro é exatamente o que esta
   * tela não pode fazer.
   */
  setoresFechados?: ReadonlySet<string | null>;
}): PreviaDpSync {
  const { pessoas, quadro, dePara, setoresDoAno, orcaPorSetor } = input;
  const fechados = input.setoresFechados ?? new Set<string | null>();

  const setorPorChave = new Map<string, SetorDoAno>();
  for (const s of setoresDoAno) {
    const k = chaveDepartamento(s.name);
    if (k && !setorPorChave.has(k)) setorPorChave.set(k, s);
  }

  const itens: PreviaDpItem[] = [];
  const casadas = new Set<string>();
  const naoMapeados = new Map<string, string>();

  for (const p of pessoas) {
    const avisos: string[] = [];
    const { vinculo, aviso: avisoVinculo } = vinculoDoContrato(p.tipoContrato);
    if (avisoVinculo) avisos.push(avisoVinculo);

    // O cargo: a linha do DP quando a pessoa está vinculada (vocabulário igual
    // ao da movimentação), e o texto da Sólides quando não está.
    const cargo = (p.cargoDaLinha ?? "").trim() || (p.cargoSolides ?? "").trim() || null;
    if (!p.cargoDaLinha && p.cargoSolides) {
      avisos.push("cargo sem linha na tabela salarial — veio da Sólides");
    }
    if (p.salario == null) {
      avisos.push("sem salário na Sólides — entra em branco");
    }
    // Desligamento NUNCA vira movimentação (é decisão do gestor), mas também
    // não pode ficar escondido: é número que muda a folha do ano.
    if (p.dataDesligamento) {
      avisos.push(`desligamento em ${formatarData(p.dataDesligamento)} no cadastro`);
    }

    const base = {
      solidesId: p.solidesId,
      nome: p.nome,
      departamento: p.departamento,
      cargo,
      salario: p.salario,
      vinculo,
      avisos,
    };

    // ── O setor, que é onde isto mais tropeça ──────────────────────────────
    let setorId: string | null = null;
    let setorNome: string | null = null;
    if (orcaPorSetor) {
      const chaveDep = chaveDepartamento(p.departamento);
      if (!chaveDep) {
        itens.push(fora(base, "sem_departamento"));
        continue;
      }
      const nomeDoSetor = dePara.get(chaveDep);
      if (!nomeDoSetor) {
        naoMapeados.set(chaveDep, (p.departamento ?? "").trim());
        itens.push(fora(base, "departamento_nao_mapeado"));
        continue;
      }
      const setor = setorPorChave.get(chaveDepartamento(nomeDoSetor));
      if (!setor) {
        itens.push(fora({ ...base, setorNome: nomeDoSetor }, "setor_fora_do_ano"));
        continue;
      }
      setorId = setor.id;
      setorNome = setor.name;
    }

    // Fatia fechada barra antes de qualquer outra coisa: nem criar nem alterar
    // é possível ali, e o motivo não depende de a pessoa já estar no quadro.
    if (fechados.has(setorId)) {
      itens.push(fora({ ...base, setorId, setorNome }, "fatia_finalizada"));
      continue;
    }

    // ── Casamento com o quadro ────────────────────────────────────────────
    const casamento = casarComQuadro(p.nome, quadro);
    if (casamento.tipo === "ambiguo") {
      itens.push(fora({ ...base, setorId, setorNome }, "nome_ambiguo"));
      continue;
    }

    if (casamento.tipo === "nenhum") {
      itens.push({
        ...base,
        setorId,
        setorNome,
        estado: "nova",
        marcada: true,
        quadroId: null,
        atual: null,
        motivoFora: null,
      });
      continue;
    }

    const linha = quadro.find((q) => q.id === casamento.id)!;
    casadas.add(linha.id);

    if (linha.travado) {
      const comMotivo = linha.travadoMotivo
        ? { ...base, avisos: [...avisos, linha.travadoMotivo] }
        : base;
      itens.push({
        ...fora({ ...comMotivo, setorId, setorNome }, "decidida"),
        quadroId: linha.id,
        atual: {
          cargo: linha.cargoAtual,
          salario: linha.salarioAtual,
          vinculo: linha.vinculo,
        },
      });
      continue;
    }

    const igual =
      mesmoTexto(cargo, linha.cargoAtual) &&
      mesmoSalario(p.salario, linha.salarioAtual) &&
      vinculo === linha.vinculo;

    itens.push({
      ...base,
      setorId,
      setorNome,
      estado: igual ? "igual" : "conflito",
      // Conflito começa DESMARCADO: quem já está no quadro foi digitado por
      // alguém, e sobrescrever é escolha explícita, com os dois valores à vista.
      marcada: false,
      quadroId: linha.id,
      atual: {
        cargo: linha.cargoAtual,
        salario: linha.salarioAtual,
        vinculo: linha.vinculo,
      },
      motivoFora: null,
    });
  }

  const apenasNoQuadro = quadro
    .filter((q) => !casadas.has(q.id))
    .map((q) => ({ id: q.id, nome: (q.nome ?? "").trim() || "(sem nome)", setorId: q.setorId }));

  const resumo = {
    novas: itens.filter((i) => i.estado === "nova").length,
    conflitos: itens.filter((i) => i.estado === "conflito").length,
    iguais: itens.filter((i) => i.estado === "igual").length,
    fora: itens.filter((i) => i.estado === "fora").length,
    semSalario: itens.filter((i) => i.estado !== "fora" && i.salario == null).length,
    marcadas: itens.filter((i) => i.marcada).length,
  };

  return {
    itens,
    apenasNoQuadro,
    departamentosNaoMapeados: Array.from(naoMapeados.values()).sort((a, b) =>
      a.localeCompare(b, "pt-BR"),
    ),
    resumo,
  };
}

function fora(
  base: {
    solidesId: string;
    nome: string;
    departamento: string | null;
    cargo: string | null;
    salario: number | null;
    vinculo: VinculoKey;
    avisos: string[];
    setorId?: string | null;
    setorNome?: string | null;
  },
  motivo: MotivoFora,
): PreviaDpItem {
  return {
    solidesId: base.solidesId,
    nome: base.nome,
    departamento: base.departamento,
    cargo: base.cargo,
    salario: base.salario,
    vinculo: base.vinculo,
    avisos: base.avisos,
    setorId: base.setorId ?? null,
    setorNome: base.setorNome ?? null,
    estado: "fora",
    marcada: false,
    quadroId: null,
    atual: null,
    motivoFora: motivo,
  };
}

function formatarData(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : iso;
}

// ─── O que a action vai gravar ──────────────────────────────────────────────

/** Só os itens que o admin marcou E que o sync pode gravar. */
export function itensParaGravar(
  previa: PreviaDpSync,
  marcados: readonly string[],
): PreviaDpItem[] {
  const set = new Set(marcados);
  return previa.itens.filter(
    (i) => set.has(i.solidesId) && (i.estado === "nova" || i.estado === "conflito"),
  );
}

/** Vínculo vindo do banco, com o padrão seguro quando o valor é estranho. */
export function vinculoDoBanco(v: unknown): VinculoKey {
  return isVinculo(v) ? v : "clt";
}
