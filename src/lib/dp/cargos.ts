// ============================================================================
// Cargos e salários do DP — regras puras e testadas: a chave de nome, a
// sugestão do de-para Sólides → linha da tabela e o enquadramento de cada pessoa.
// ============================================================================

/**
 * Forma normalizada de um nome (setor, cargo, cargo da Sólides): minúsculas,
 * sem acento, sem o "(a)" de gênero, espaço único. É a que leva o UNIQUE no
 * banco — "Analista  Comercial" e "analista comercial" são o mesmo cargo.
 */
export function chaveNome(nome: string): string {
  return nome
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\(a\)/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

// ── Cargo | Senioridade | Step ──────────────────────────────────────────────
//
// Pedido do dono do projeto (26/10/2026): o cargo da tabela salarial abre em
// TRÊS colunas — "Analista de Relacionamento JÚNIOR I" vira Cargo "Analista de
// Relacionamento", Senioridade "Júnior", Step "I". Step é sempre algarismo
// romano; senioridade é Júnior, Pleno ou Sênior, ou vazia (cargo sem
// senioridade, como "Assistente de Relacionamento I"). Desfaz a decisão de
// 02/10/2026, quando o step tinha ido para dentro do nome.
//
// O nome COMPLETO (`nomeCargo`) continua existindo: é como a linha aparece nos
// seletores e na promoção, e é por ele que o cargo da Sólides — que segue com
// tudo no nome — casa com a linha. O casamento usa `chaveCargo`, que separa os
// dois lados pela MESMA regra: assim "Consultor Sênior (Sócio) I" da Sólides
// casa com a linha "Consultor (Sócio)" · Sênior · I, mesmo com a senioridade em
// outro lugar do nome.
//
// Os dois vocabulários abaixo são repetidos nos CHECK da tabela no banco —
// cargos.test.ts lê a migration e exige a mesma lista.

export const SENIORIDADES = ["Júnior", "Pleno", "Sênior"] as const;
export type DpSenioridade = (typeof SENIORIDADES)[number];

/** Steps aceitos: I a XX. Na prática a tabela vai até V; o teto é só para recusar o que não é step. */
export const STEPS = [
  "I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X",
  "XI", "XII", "XIII", "XIV", "XV", "XVI", "XVII", "XVIII", "XIX", "XX",
] as const;

/** Cargo da tabela já separado. `senioridade` e `step` vazios = o cargo não tem. */
export interface DpCargoPartes {
  cargo: string;
  senioridade: DpSenioridade | "";
  step: string;
}

/** As palavras de senioridade escritas por extenso, em qualquer caixa e com ou sem acento. */
const SENIORIDADE_POR_EXTENSO: Record<string, DpSenioridade> = { junior: "Júnior", pleno: "Pleno", senior: "Sênior" };
/** As abreviações só valem na COLUNA (quem preenche escolheu a senioridade); no meio do nome, "Sr" pode ser outra coisa. */
const SENIORIDADE_ABREVIADA: Record<string, DpSenioridade> = { jr: "Júnior", pl: "Pleno", sr: "Sênior" };

/** Senioridade de uma célula: '' (sem), uma das três, ou null quando não é senioridade nenhuma. */
export function lerSenioridade(v: string): DpSenioridade | "" | null {
  const k = chaveNome(v ?? "");
  if (!k) return "";
  return SENIORIDADE_POR_EXTENSO[k] ?? SENIORIDADE_ABREVIADA[k] ?? null;
}

/** Step de uma célula: '' (sem), romano I–XX (em qualquer caixa) ou número 1–20 convertido. Outra coisa → null. */
export function lerStep(v: string | number): string | null {
  const s = String(v ?? "").trim().toUpperCase();
  if (!s) return "";
  if ((STEPS as readonly string[]).includes(s)) return s;
  if (/^\d+$/.test(s)) return STEPS[Number(s) - 1] ?? null;
  return null;
}

const SEPARADOR = /^[-–—/|,;:·]+$/;

/**
 * Separa um nome de cargo escrito por inteiro. O step é o ÚLTIMO termo, se for
 * romano; a senioridade é a única palavra Júnior/Pleno/Sênior do nome, em
 * qualquer posição ("Analista Growth JÚNIOR PJ I" → "Analista Growth PJ" ·
 * Júnior · I). Duas palavras de senioridade não decidem nada e ficam no nome;
 * e nada é tirado se o cargo ficaria vazio.
 */
export function separarCargo(nome: string, tirar: { senioridade?: boolean; step?: boolean } = {}): DpCargoPartes {
  const termos = (nome ?? "").replace(/\s+/g, " ").trim().split(" ").filter(Boolean);
  let step = "";
  if (tirar.step !== false && termos.length > 1) {
    const ultimo = termos[termos.length - 1].toUpperCase();
    if ((STEPS as readonly string[]).includes(ultimo)) {
      step = ultimo;
      termos.pop();
    }
  }
  let senioridade: DpSenioridade | "" = "";
  const achadas = termos
    .map((t, i) => ({ i, s: SENIORIDADE_POR_EXTENSO[chaveNome(t)] }))
    .filter((x): x is { i: number; s: DpSenioridade } => Boolean(x.s));
  if (tirar.senioridade !== false && achadas.length === 1 && termos.length > 1) {
    senioridade = achadas[0].s;
    termos.splice(achadas[0].i, 1);
  }
  // Separador que ficou sobrando ("Analista - Júnior" → "Analista").
  while (termos.length > 1 && SEPARADOR.test(termos[termos.length - 1])) termos.pop();
  while (termos.length > 1 && SEPARADOR.test(termos[0])) termos.shift();
  const limpos = termos.filter((t, i) => !(SEPARADOR.test(t) && SEPARADOR.test(termos[i + 1] ?? "")));
  return { cargo: limpos.join(" "), senioridade, step };
}

/** O nome completo, como a linha aparece nos seletores: "Analista de Relacionamento Júnior I". */
export function nomeCargo(p: { cargo: string; senioridade?: string | null; step?: string | null }): string {
  return [p.cargo.trim(), (p.senioridade ?? "").trim(), (p.step ?? "").trim()].filter(Boolean).join(" ");
}

/**
 * Cargo, senioridade e step de uma linha que está sendo gravada.
 *
 * `doNome` diz o que pode vir DENTRO do nome — é o caso da planilha sem a
 * coluna correspondente (o formato antigo, só com Cargo) e do preenchimento das
 * linhas antigas. Aí o que vier no nome é separado, e o nome e a coluna dizendo
 * coisas DIFERENTES é recusado (escolher um seria gravar uma linha que ninguém
 * pediu). Onde há coluna — a tela, a planilha nova — o nome é gravado COMO
 * ESTÁ: quem preenche já separou, e um cargo que termina em letra romana de
 * verdade ("Técnico em Raio X") não pode perder o fim do nome.
 */
export function normalizarCargo(
  input: { cargo: string; senioridade?: string | null; step?: string | number | null },
  doNome: { senioridade: boolean; step: boolean },
): { ok: DpCargoPartes } | { erro: string } {
  const sen = lerSenioridade(input.senioridade ?? "");
  if (sen === null) return { erro: `Senioridade "${input.senioridade}" não existe — use Júnior, Pleno ou Sênior (ou deixe vazia).` };
  const step = lerStep(input.step ?? "");
  if (step === null) return { erro: `Step "${input.step}" não é um algarismo romano de I a XX.` };
  const partes = separarCargo(input.cargo, doNome);
  if (!partes.cargo) return { erro: "Informe o cargo." };
  if (sen && partes.senioridade && sen !== partes.senioridade) {
    return { erro: `O nome do cargo já diz ${partes.senioridade}, e a senioridade informada é ${sen}.` };
  }
  if (step && partes.step && step !== partes.step) {
    return { erro: `O nome do cargo já termina no step ${partes.step}, e o step informado é ${step}.` };
  }
  return { ok: { cargo: partes.cargo, senioridade: sen || partes.senioridade, step: step || partes.step } };
}

/**
 * Chave de casamento de um cargo: separa o nome completo pela mesma regra dos
 * dois lados, então tanto uma linha já em três colunas quanto um nome inteiro
 * (o da Sólides, ou uma linha antiga ainda não separada) chegam à mesma chave.
 */
export function chaveCargo(p: { cargo: string; senioridade?: string | null; step?: string | null }): string {
  const s = separarCargo(nomeCargo(p));
  return `${chaveNome(s.cargo)}|${s.senioridade}|${s.step}`;
}

/**
 * Uma linha da tabela salarial, no formato que a sugestão e o enquadramento
 * usam. `cargo` é o cargo SEM senioridade e step (desde 26/10/2026); o nome
 * completo sai de `nomeCargo`.
 */
export interface DpLinhaSalarial {
  id: string;
  setor: string;
  cargo: string;
  senioridade: string;
  step: string;
  salario: number;
}

/** Como a linha aparece nos seletores: "Setor · Cargo Senioridade Step" (ou sem o setor). */
export function rotuloLinha(l: Pick<DpLinhaSalarial, "setor" | "cargo" | "senioridade" | "step">): string {
  const nome = nomeCargo(l);
  return l.setor.trim() ? `${l.setor} · ${nome}` : nome;
}

/**
 * Linha sugerida para um cargo da Sólides, ou null: o nome da Sólides é o
 * nome completo do cargo na tabela (senioridade e step dentro). Só sugere
 * quando há UM candidato — o mesmo cargo em dois setores não sugere nada,
 * porque chutar entre eles enquadraria a pessoa no salário errado sem ninguém
 * perceber.
 */
export function sugerirLinha(nomeSolides: string, linhas: DpLinhaSalarial[]): string | null {
  if (!chaveNome(nomeSolides)) return null;
  const alvo = chaveCargo({ cargo: nomeSolides });
  const candidatos = linhas.filter((l) => chaveCargo(l) === alvo);
  return candidatos.length === 1 ? candidatos[0].id : null;
}

export type DpEnquadramentoStatus =
  | "no_nivel"
  | "abaixo"
  | "acima"
  | "sem_salario"
  | "sem_vinculo"
  | "sem_empresa";

export const ROTULO_ENQUADRAMENTO: Record<DpEnquadramentoStatus, string> = {
  no_nivel: "No salário da tabela",
  abaixo: "Abaixo da tabela",
  acima: "Acima da tabela",
  sem_salario: "Sem salário na Sólides",
  sem_vinculo: "Cargo sem linha na tabela",
  sem_empresa: "Sem empresa definida",
};

/** Diferença menor que isto (em reais) conta como "no salário da tabela": arredondamento, não desvio. */
export const TOLERANCIA_REAIS = 1;

export interface DpEnquadramento {
  status: DpEnquadramentoStatus;
  /** Salário real − salário da tabela; null quando não há os dois. */
  diferenca: number | null;
  /** Diferença em % do salário da tabela; null quando não há os dois ou ele é zero. */
  percentual: number | null;
}

export function enquadrar(input: {
  temEmpresa: boolean;
  salario: number | null;
  salarioNivel: number | null;
}): DpEnquadramento {
  if (!input.temEmpresa) return { status: "sem_empresa", diferenca: null, percentual: null };
  if (input.salarioNivel === null) return { status: "sem_vinculo", diferenca: null, percentual: null };
  if (input.salario === null || input.salario <= 0) return { status: "sem_salario", diferenca: null, percentual: null };
  const diferenca = Math.round((input.salario - input.salarioNivel) * 100) / 100;
  const percentual = input.salarioNivel > 0 ? Math.round((diferenca / input.salarioNivel) * 1000) / 10 : null;
  const status: DpEnquadramentoStatus =
    Math.abs(diferenca) < TOLERANCIA_REAIS ? "no_nivel" : diferenca < 0 ? "abaixo" : "acima";
  return { status, diferenca, percentual };
}

// ── Alerta: salário da Sólides fora da tabela ───────────────────────────────
//
// Pedido do dono do projeto (22/10/2026): destacar em VERMELHO quem tem o
// salário da Sólides diferente do salário da linha da tabela salarial — só
// quando a empresa TEM tabela e a pessoa tem linha (sem tabela, sem linha ou
// sem salário não há o que comparar). A Sólides é a fonte: o alerta nunca muda
// salário nenhum, e só some quando a Sólides for corrigida e a sincronização
// trouxer o valor da tabela. Também é calculado na leitura, nunca gravado —
// por isso some sozinho.

/** O salário da Sólides está fora da tabela (acima ou abaixo, além da tolerância)? */
export function salarioForaDaTabela(e: DpEnquadramento): boolean {
  return e.status === "abaixo" || e.status === "acima";
}

const brl = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

/** A frase do alerta, igual em todas as telas. Null quando não há alerta. */
export function textoAlertaTabela(input: {
  salario: number | null;
  salarioTabela: number | null;
  linhaRotulo: string | null;
  enquadramento: DpEnquadramento;
}): string | null {
  const e = input.enquadramento;
  if (!salarioForaDaTabela(e) || input.salario === null || input.salarioTabela === null || e.diferenca === null) return null;
  const sinal = e.diferenca > 0 ? "+" : "−";
  const pct = e.percentual === null ? "" : `, ${sinal}${Math.abs(e.percentual).toLocaleString("pt-BR")}%`;
  return (
    `Salário na Sólides (${brl(input.salario)}) ${e.status === "abaixo" ? "abaixo" : "acima"} da tabela ` +
    `(${input.linhaRotulo ? `${input.linhaRotulo}: ` : ""}${brl(input.salarioTabela)}; ${sinal}${brl(Math.abs(e.diferenca))}${pct}). ` +
    `A folha segue o valor da Sólides — corrija lá; o alerta some quando a sincronização trouxer o salário da tabela.`
  );
}
