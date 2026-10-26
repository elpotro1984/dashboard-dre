// ============================================================================
// Tabela salarial do DP — leitura da planilha, plano de importação, reajuste e
// ordem das linhas. Puro e testado (sem I/O).
//
// Formato: `Setor | Cargo | Senioridade | Step | Salário`, uma planilha por
// empresa. O cabeçalho é procurado nas primeiras linhas e a ordem das colunas é
// livre (mesma convenção das planilhas do Orçamento). Cargo e Salário são
// obrigatórios; Setor, Senioridade e Step podem ficar vazios.
//
// Planilha no formato ANTIGO (sem as colunas Senioridade e Step, o nome inteiro
// em Cargo — "Analista de Relacionamento JÚNIOR I") continua servindo: aí o
// nome é separado pela regra de `separarCargo`. Com as colunas no cabeçalho, o
// cargo é lido como está (ver `normalizarCargo`). Step em número (o formato de
// 02/10/2026, "1", "2"…) vira romano.
// ============================================================================

import { chaveCargo, chaveNome, nomeCargo, normalizarCargo } from "@/lib/dp/cargos";

export interface DpTabelaPlanilhaLinha {
  /** Linha na planilha (1-based), para apontar o problema ao usuário. */
  linha: number;
  setor: string;
  /** Cargo SEM senioridade e step. */
  cargo: string;
  senioridade: string;
  step: string;
  salario: number;
}

export interface DpTabelaPlanilha {
  linhas: DpTabelaPlanilhaLinha[];
  /** Linhas recusadas na leitura, já com o motivo. */
  problemas: string[];
}

/**
 * Chave de casamento de uma linha: setor + cargo, senioridade e step pela
 * regra de `chaveCargo` — uma linha antiga, ainda com tudo no nome, casa com a
 * mesma linha já separada em três colunas (e é atualizada, não duplicada).
 */
export function chaveLinha(l: { setor: string; cargo: string; senioridade?: string | null; step?: string | null }): string {
  return `${chaveNome(l.setor)}|${chaveCargo(l)}`;
}

const ALIAS = {
  setor: ["setor", "setores", "area", "departamento"],
  cargo: ["cargo", "cargos", "funcao"],
  senioridade: ["senioridade", "senioridades"],
  step: ["step", "steps", "nivel", "niveis", "faixa", "classe", "grau", "referencia"],
  salario: ["salario", "salarios", "valor", "remuneracao", "salario base"],
} as const;

type Campo = keyof typeof ALIAS;

/**
 * Valor de salário de uma célula. Número do Excel passa direto; texto aceita
 * "R$ 3.500,00", "3500,5" e "3500.50". Vazio ou ilegível → null.
 */
export function lerSalario(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  const s = String(v ?? "").replace(/R\$/i, "").replace(/\s/g, "");
  if (!s) return null;
  // Com vírgula, ela é o decimal e o ponto é milhar; sem vírgula, o ponto é o decimal.
  const normal = s.includes(",") ? s.replace(/\./g, "").replace(",", ".") : s;
  if (!/^-?\d+(\.\d+)?$/.test(normal)) return null;
  const n = Number(normal);
  return Number.isFinite(n) ? n : null;
}

export function parseTabelaPlanilha(data: unknown[][]): { ok: DpTabelaPlanilha } | { erro: string } {
  let headerIdx = -1;
  const cols: Record<Campo, number> = { setor: -1, cargo: -1, senioridade: -1, step: -1, salario: -1 };
  for (let i = 0; i < Math.min(data.length, 20) && headerIdx < 0; i += 1) {
    const achadas: Record<Campo, number> = { setor: -1, cargo: -1, senioridade: -1, step: -1, salario: -1 };
    (data[i] ?? []).forEach((celula, idx) => {
      const chave = chaveNome(String(celula ?? ""));
      (Object.keys(ALIAS) as Campo[]).forEach((campo) => {
        if (achadas[campo] === -1 && (ALIAS[campo] as readonly string[]).includes(chave)) achadas[campo] = idx;
      });
    });
    if (achadas.cargo >= 0 && achadas.salario >= 0) {
      headerIdx = i;
      Object.assign(cols, achadas);
    }
  }
  if (headerIdx < 0) {
    return { erro: "Não encontrei o cabeçalho. A planilha precisa das colunas Cargo e Salário (Setor, Senioridade e Step são opcionais)." };
  }

  const linhas: DpTabelaPlanilhaLinha[] = [];
  const problemas: string[] = [];
  const vistas = new Map<string, number>();
  const texto = (row: unknown[], c: number) => (c >= 0 ? String(row[c] ?? "").replace(/\s+/g, " ").trim() : "");
  // Só se tira do NOME o que a planilha não tem em coluna própria.
  const doNome = { senioridade: cols.senioridade < 0, step: cols.step < 0 };

  for (let i = headerIdx + 1; i < data.length; i += 1) {
    const row = data[i] ?? [];
    const numero = i + 1;
    const setor = texto(row, cols.setor);
    const senioridade = texto(row, cols.senioridade);
    const step = texto(row, cols.step);
    const cargoBruto = texto(row, cols.cargo);
    const bruto = cols.salario >= 0 ? row[cols.salario] : "";
    // Linha inteira vazia é separador, não erro.
    if (!setor && !cargoBruto && !senioridade && !step && String(bruto ?? "").trim() === "") continue;

    // Step sem cargo não vira um "cargo" chamado "I": continua sendo linha sem cargo.
    if (!cargoBruto) {
      problemas.push(`Linha ${numero}: sem cargo.`);
      continue;
    }
    const partes = normalizarCargo({ cargo: cargoBruto, senioridade, step }, doNome);
    if ("erro" in partes) {
      problemas.push(`Linha ${numero} (${cargoBruto}): ${partes.erro}`);
      continue;
    }
    const nome = nomeCargo(partes.ok);
    const salario = lerSalario(bruto);
    if (salario === null) {
      problemas.push(`Linha ${numero} (${nome}): salário vazio ou ilegível.`);
      continue;
    }
    if (salario < 0) {
      problemas.push(`Linha ${numero} (${nome}): salário negativo.`);
      continue;
    }
    const chave = chaveLinha({ setor, ...partes.ok });
    const anterior = vistas.get(chave);
    if (anterior !== undefined) {
      // A mesma linha duas vezes com salários diferentes não tem como ser
      // decidida aqui: fica a primeira, e o usuário é avisado.
      problemas.push(`Linha ${numero}: repete a linha ${anterior} (mesmo setor, cargo, senioridade e step) e foi ignorada.`);
      continue;
    }
    vistas.set(chave, numero);
    linhas.push({ linha: numero, setor, ...partes.ok, salario: Math.round(salario * 100) / 100 });
  }
  return { ok: { linhas, problemas } };
}

export interface DpTabelaExistente {
  id: string;
  setor: string;
  cargo: string;
  senioridade: string;
  step: string;
  salario: number;
}

export interface DpPlanoImportacao {
  inserir: DpTabelaPlanilhaLinha[];
  atualizar: Array<{ id: string; salario: number; de: number }>;
  /** Já estavam na tabela com o mesmo salário. */
  iguais: number;
  /** Estão na tabela e não vieram na planilha — MANTIDAS (remover é ato explícito). */
  foraDaPlanilha: number;
}

/**
 * O que importar faz: casa por setor + cargo, ATUALIZA o salário do que
 * já existe, INSERE o que é novo e NÃO APAGA o que ficou fora da planilha.
 * Aditivo e idempotente, como as importações do Orçamento: reimportar o mesmo
 * arquivo não muda nada, e uma planilha parcial nunca esvazia a tabela.
 */
export function planejarImportacao(planilha: DpTabelaPlanilhaLinha[], existentes: DpTabelaExistente[]): DpPlanoImportacao {
  const porChave = new Map(existentes.map((e) => [chaveLinha(e), e]));
  const usadas = new Set<string>();
  const inserir: DpTabelaPlanilhaLinha[] = [];
  const atualizar: DpPlanoImportacao["atualizar"] = [];
  let iguais = 0;
  for (const l of planilha) {
    const k = chaveLinha(l);
    const e = porChave.get(k);
    if (!e) {
      inserir.push(l);
      continue;
    }
    usadas.add(k);
    if (Math.abs(e.salario - l.salario) < 0.005) iguais += 1;
    else atualizar.push({ id: e.id, salario: l.salario, de: e.salario });
  }
  const foraDaPlanilha = existentes.filter((e) => !usadas.has(chaveLinha(e))).length;
  return { inserir, atualizar, iguais, foraDaPlanilha };
}

// ── Cópia de outra empresa ──────────────────────────────────────────────────

export interface DpPlanoCopia {
  /** Linhas novas, na ordem da origem, com o centro de custo já traduzido para o destino. */
  inserir: Array<{ setor: string; cargo: string; senioridade: string; step: string; salario: number; centroCustoId: string | null }>;
  /** Só preenchido com `atualizarSalarios`: linhas que já existem aqui e passam a ter o salário da origem. */
  atualizar: Array<{ id: string; salario: number; de: number }>;
  /** Já existem aqui com o mesmo salário. */
  iguais: number;
  /** Já existem aqui com salário DIFERENTE (atualizadas ou mantidas, conforme a opção). */
  diferentes: number;
  /** Linhas que só existem aqui — ficam como estão. */
  soNoDestino: number;
  /** Linhas novas que levaram o centro de custo (o destino tem um centro com o mesmo nome). */
  comCentro: number;
  /** Centros da origem que o destino não tem: as linhas novas que os usavam entram sem centro. */
  centrosSemPar: string[];
}

/**
 * "Copiar de outra empresa": a mesma regra da importação por planilha — casa
 * por setor + cargo, insere o que é novo e NUNCA apaga o que só existe aqui —,
 * com uma diferença deliberada: o salário de uma linha que JÁ EXISTE só é
 * trocado quando pedido (`atualizarSalarios`). Na planilha o usuário escreveu
 * o número de propósito; na cópia, o número é da outra empresa, e sobrescrever
 * a tabela daqui sem pedir mudaria o enquadramento de quem já está nela.
 *
 * Centro de custo é cadastro POR EMPRESA (o id da origem não existe aqui):
 * a linha nova leva o centro do destino com o MESMO NOME, e entra sem centro
 * quando não há par — dito na prévia, nunca criado por conta própria.
 */
export function planejarCopia(
  origem: Array<{ setor: string; cargo: string; senioridade: string; step: string; salario: number; centroNome: string | null }>,
  existentes: DpTabelaExistente[],
  centrosDestino: Array<{ id: string; nome: string }>,
  atualizarSalarios: boolean,
): DpPlanoCopia {
  const plano = planejarImportacao(
    origem.map((l, i) => ({ linha: i + 1, setor: l.setor, cargo: l.cargo, senioridade: l.senioridade, step: l.step, salario: l.salario })),
    existentes,
  );
  const centroPorNome = new Map(centrosDestino.map((c) => [chaveNome(c.nome), c.id]));
  const origemPorChave = new Map(origem.map((l) => [chaveLinha(l), l]));
  const semPar = new Set<string>();
  let comCentro = 0;
  const inserir = plano.inserir.map((l) => {
    const nome = origemPorChave.get(chaveLinha(l))?.centroNome?.trim() || null;
    const centroCustoId = nome ? centroPorNome.get(chaveNome(nome)) ?? null : null;
    if (centroCustoId) comCentro += 1;
    else if (nome) semPar.add(nome);
    return { setor: l.setor, cargo: l.cargo, senioridade: l.senioridade, step: l.step, salario: l.salario, centroCustoId };
  });
  return {
    inserir,
    atualizar: atualizarSalarios ? plano.atualizar : [],
    iguais: plano.iguais,
    diferentes: plano.atualizar.length,
    soNoDestino: plano.foraDaPlanilha,
    comCentro,
    centrosSemPar: Array.from(semPar).sort((a, b) => a.localeCompare(b, "pt-BR")),
  };
}

// ── Reajuste ────────────────────────────────────────────────────────────────

/** Teto de sanidade: 1.000% num campo de reajuste é quase sempre um zero a mais. */
export const REAJUSTE_MAXIMO = 100;

/** Percentual digitado ("5", "5,5", "5.5") → número, ou a mensagem de recusa. */
export function lerPercentual(v: string): { ok: number } | { erro: string } {
  const s = v.replace("%", "").replace(/\s/g, "").replace(",", ".");
  if (!s) return { erro: "Informe o percentual do reajuste." };
  if (!/^\d+(\.\d+)?$/.test(s)) return { erro: "O reajuste precisa ser um número maior ou igual a zero." };
  const n = Number(s);
  if (n > REAJUSTE_MAXIMO) return { erro: `Reajuste acima de ${REAJUSTE_MAXIMO}% — confira o valor.` };
  return { ok: n };
}

/** Mesmo arredondamento da função do banco (`round(salario * (1 + p/100), 2)`), para a prévia bater com o aplicado. */
export function reajustar(salario: number, percentual: number): number {
  return Math.round(salario * (1 + percentual / 100) * 100) / 100;
}

export function previaReajuste(salarios: number[], percentual: number): { linhas: number; antes: number; depois: number } {
  const antes = salarios.reduce((s, v) => s + v, 0);
  const depois = salarios.reduce((s, v) => s + reajustar(v, percentual), 0);
  return { linhas: salarios.length, antes: Math.round(antes * 100) / 100, depois: Math.round(depois * 100) / 100 };
}

// ── Ordem ───────────────────────────────────────────────────────────────────

/**
 * Ordem para uma linha nova entre `antes` e `depois` (null = ponta). A ordem é
 * fracionária para inserir sem renumerar a tabela; "Ordenar" no banco
 * (dp_ordenar_tabela) devolve inteiros quando os números ficarem feios.
 */
export function ordemEntre(antes: number | null, depois: number | null): number {
  if (antes === null && depois === null) return 1;
  if (antes === null) return (depois as number) - 1;
  if (depois === null) return antes + 1;
  return (antes + depois) / 2;
}
