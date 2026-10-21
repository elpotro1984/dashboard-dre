// ============================================================================
// Importação da aba CONTROLE da planilha de folha do DP — puro e testado.
//
// A Sólides já traz nome, empresa, setor, contrato, salário, nascimento e
// dependentes. O que SÓ a planilha sabe (plano, odonto, alimentação,
// transporte, escala, adiantamento, home office, dependentes de IR,
// salário-família) vira o CADASTRO DA FOLHA de cada pessoa; os campos do mês
// (dias, férias, coparticipação, descontos…) viram o LANÇAMENTO da competência
// escolhida. É um gesto de uma vez, para o DP não redigitar 124 linhas.
//
// O casamento é por NOME (a planilha não tem CPF). Exato primeiro, sem acento e
// caixa; depois por continência de palavras, e só se houver UM candidato. O que
// não casa volta listado — nunca é descartado calado, senão o DP acharia que
// importou todo mundo.
// ============================================================================

import {
  CADASTRO_VAZIO,
  LANCAMENTO_PADRAO,
  type DpColunaAjustavel,
  type DpFolhaCadastro,
  type DpFolhaLancamento,
} from "@/lib/dp/folha/motor";
import type { DpFolhaParametros } from "@/lib/dp/folha/parametros";

export function normalizarNome(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const PALAVRAS_VAZIAS = new Set(["de", "da", "do", "das", "dos", "e"]);
const palavras = (s: string) => normalizarNome(s).split(" ").filter((p) => p && !PALAVRAS_VAZIAS.has(p));

export interface DpPessoaParaCasar {
  solidesId: number;
  nome: string;
}

export type DpCasamento =
  | { tipo: "exato" | "parcial"; solidesId: number; nomeSolides: string }
  | { tipo: "ambiguo"; candidatos: string[] }
  | { tipo: "nenhum" };

export function casarNome(nome: string, pessoas: DpPessoaParaCasar[]): DpCasamento {
  const alvo = normalizarNome(nome);
  if (!alvo) return { tipo: "nenhum" };
  const exatos = pessoas.filter((p) => normalizarNome(p.nome) === alvo);
  if (exatos.length === 1) return { tipo: "exato", solidesId: exatos[0].solidesId, nomeSolides: exatos[0].nome };
  if (exatos.length > 1) return { tipo: "ambiguo", candidatos: exatos.map((p) => p.nome) };

  // Continência: todas as palavras de um nome estão no outro (nome abreviado na
  // planilha ou na Sólides). Exige pelo menos 2 palavras para "Ana" não casar com metade do grupo.
  const pa = palavras(nome);
  if (pa.length < 2) return { tipo: "nenhum" };
  const contem = (maior: string[], menor: string[]) => menor.every((w) => maior.includes(w));
  const parciais = pessoas.filter((p) => {
    const pb = palavras(p.nome);
    return pb.length >= 2 && (contem(pb, pa) || contem(pa, pb));
  });
  if (parciais.length === 1) return { tipo: "parcial", solidesId: parciais[0].solidesId, nomeSolides: parciais[0].nome };
  if (parciais.length > 1) return { tipo: "ambiguo", candidatos: parciais.map((p) => p.nome) };
  return { tipo: "nenhum" };
}

// ── leitura das células ────────────────────────────────────────────────────

/** Data em ISO (AAAA-MM-DD) a partir de Date, serial do Excel ou "DD/MM/AAAA". */
export function lerData(v: unknown): string | null {
  if (v instanceof Date && !Number.isNaN(v.getTime())) {
    return `${v.getFullYear()}-${String(v.getMonth() + 1).padStart(2, "0")}-${String(v.getDate()).padStart(2, "0")}`;
  }
  if (typeof v === "number" && v > 1000 && v < 80000) {
    const d = new Date(Date.UTC(1899, 11, 30) + Math.round(v) * 86_400_000);
    return d.toISOString().slice(0, 10);
  }
  if (typeof v === "string") {
    const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(v.trim());
    if (m) return `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
    if (/^\d{4}-\d{2}-\d{2}/.test(v.trim())) return v.trim().slice(0, 10);
  }
  return null;
}

/** Número da célula; "1.234,56" e "R$ 1.234,56" também. Vazio = 0. */
export function lerNumero(v: unknown): number {
  if (typeof v === "number") return Number.isFinite(v) ? v : 0;
  if (typeof v !== "string") return 0;
  const t = v.replace(/R\$|\s/g, "");
  if (!t) return 0;
  const x = Number(t.includes(",") ? t.replace(/\./g, "").replace(",", ".") : t);
  return Number.isFinite(x) ? x : 0;
}

/** O número no fim de um rótulo: "Odonto 3" → 3, "Gasolina 97,50" → 97.5. */
function numeroDoRotulo(s: string): number | null {
  const m = /(\d+(?:[.,]\d+)?)\s*$/.exec(s.trim());
  return m ? Number(m[1].replace(",", ".")) : null;
}

const igual = (a: string, b: string) => normalizarNome(a) === normalizarNome(b);
const vazio = (v: unknown) => v === undefined || v === null || (typeof v === "string" && !v.trim());

// ── a linha da planilha ────────────────────────────────────────────────────

export interface DpLinhaControle {
  linha: number;
  nome: string;
  /** Como a planilha classifica (só para conferência na prévia). */
  empresaPlanilha: string;
  setorPlanilha: string;
  centroPlanilha: string;
  contratoPlanilha: string;
  cadastro: DpFolhaCadastro;
  lancamento: DpFolhaLancamento;
  avisos: string[];
}

const COLUNA = {
  nome: "funcionarios",
  empresa: "empresa registrada",
  centro: "centro de custo",
  setor: "setor",
  contrato: "tipo de contrato",
  dias: "dias trabalhados",
  outros: "insuf de saldo outros proventos",
  salFamilia: "salario familia",
  homeOffice: "auxilio home office",
  diasFerias: "dias de ferias",
  inssFerias: "inss ferias",
  plano: "plano de saude",
  copart: "copart plano de saude",
  odonto: "plano odontologico",
  depIr: "dependentes irrf",
  outrosDesc: "outros descontos",
  adiant: "adiantamento",
  comissao: "comissao meta",
  alimentacao: "alimentacao",
  transporte: "transporte",
  escala: "dias trab p semana",
  vtDias: "desconto vt dias proporcionais",
} as const;

/**
 * As OPÇÕES da aba TABELAS da própria planilha: rótulo → valor. É dela que as
 * fórmulas da SALÁRIO tiram o valor da alimentação e da gasolina (PROCV no
 * rótulo), e cada planilha tem a sua — a das "demais empresas" tem opções por
 * unidade ("Alimentação - VIVA MIXX - R$20,85/dia" = 437,85 no mês; "Gasolina
 * CGR + Bônus R$1000,00" = 1.150). Ler o número do fim do rótulo erra os dois
 * casos (zero no primeiro, só o bônus no segundo), e foi o que a 1ª versão fez.
 *
 * A aba é uma colagem de listas lado a lado, sem cabeçalho por lista: a regra é
 * "texto com número na célula à direita". Rótulo que aparece com valores
 * DIFERENTES vira null (ambíguo) — quem o usa recebe aviso em vez de um palpite.
 */
export function lerTabelasDaPlanilha(matriz: unknown[][]): Map<string, number | null> {
  const out = new Map<string, number | null>();
  for (const row of matriz) {
    const r = row ?? [];
    for (let j = 0; j + 1 < r.length; j++) {
      const rotulo = r[j];
      const valor = r[j + 1];
      if (typeof rotulo !== "string" || !rotulo.trim() || typeof valor !== "number" || !Number.isFinite(valor)) continue;
      const k = normalizarNome(rotulo);
      const v = Math.round(valor * 100) / 100;
      out.set(k, out.has(k) && out.get(k) !== v ? null : v);
    }
  }
  return out;
}

/**
 * Lê a aba CONTROLE (linhas já como matriz, a 1ª com os cabeçalhos). Falha por
 * ARQUIVO só quando não há a coluna FUNCIONÁRIOS; o resto falha por linha.
 * `tabelas` (da aba TABELAS da mesma planilha) vence os parâmetros e o número
 * do rótulo na alimentação e na gasolina — é a fonte que a própria planilha usa.
 */
export function lerControle(
  matriz: unknown[][],
  p: DpFolhaParametros,
  tabelas?: ReadonlyMap<string, number | null>,
): { ok: DpLinhaControle[] } | { erro: string } {
  const iCab = matriz.findIndex((row) => (row ?? []).some((c) => typeof c === "string" && normalizarNome(c) === COLUNA.nome));
  if (iCab < 0) return { erro: "Não encontrei a coluna FUNCIONÁRIOS — a planilha é a aba CONTROLE da folha?" };
  const cab = (matriz[iCab] ?? []).map((c) => (typeof c === "string" ? normalizarNome(c) : ""));
  const col = (k: keyof typeof COLUNA) => cab.indexOf(COLUNA[k]);
  // "DN DEPENDENTE 1..5" e "DN BENEFICIÁRIO"
  const dnDep = [1, 2, 3, 4, 5].map((i) => cab.indexOf(`dn dependente ${i}`));

  const out: DpLinhaControle[] = [];
  for (let r = iCab + 1; r < matriz.length; r++) {
    const row = matriz[r] ?? [];
    const cel = (k: keyof typeof COLUNA) => (col(k) >= 0 ? row[col(k)] : undefined);
    const txt = (k: keyof typeof COLUNA) => {
      const v = cel(k);
      return v === undefined || v === null ? "" : String(v).trim();
    };
    const nome = txt("nome");
    if (!nome) continue;
    const avisos: string[] = [];

    const cadastro: DpFolhaCadastro = { ...CADASTRO_VAZIO, planoDependentes: [] };
    const plano = normalizarNome(txt("plano"));
    if (plano === "ambulatorial" || plano === "enfermaria" || plano === "apartamento") cadastro.planoSaude = plano;
    else if (plano && plano !== "nenhum") avisos.push(`Plano de saúde "${txt("plano")}" não reconhecido.`);
    if (cadastro.planoSaude !== "nenhum") {
      dnDep.forEach((ci, i) => {
        const d = ci >= 0 ? lerData(row[ci]) : null;
        if (d) cadastro.planoDependentes.push({ nome: `Dependente ${i + 1}`, nascimento: d });
      });
    }
    const odonto = txt("odonto");
    cadastro.odontoVidas = igual(odonto, "nenhum") || !odonto ? 0 : numeroDoRotulo(odonto) ?? 0;
    const sf = txt("salFamilia");
    cadastro.salarioFamiliaCotas = igual(sf, "nenhum") || !sf ? 0 : numeroDoRotulo(sf) ?? 0;
    const dep = txt("depIr");
    cadastro.dependentesIr = igual(dep, "nenhum") || !dep ? 0 : numeroDoRotulo(dep) ?? 0;
    cadastro.adiantamento = igual(txt("adiant"), "sim");
    cadastro.homeOffice = lerNumero(cel("homeOffice"));
    cadastro.semInss = igual(txt("setor"), "diretor");

    // Valor de uma opção pela aba TABELAS da planilha; undefined = a tabela não tem o rótulo.
    const daTabela = (rotulo: string): number | null | undefined => tabelas?.get(normalizarNome(rotulo));
    const alim = txt("alimentacao");
    if (alim && !igual(alim, "nenhum")) {
      const t = daTabela(alim);
      const op = p.alimentacoes.find((a) => igual(a.nome, alim));
      const v = t ?? op?.valor ?? numeroDoRotulo(alim);
      if (t === null) avisos.push(`Alimentação "${alim}" aparece com valores diferentes na aba TABELAS — confira.`);
      if (v === null) avisos.push(`Alimentação "${alim}" não reconhecida.`);
      else cadastro.alimentacao = v;
    }
    const tr = txt("transporte");
    if (tr && !igual(tr, "nenhum")) {
      const b = p.bilhetes.find((x) => igual(x.nome, tr));
      if (b) {
        cadastro.transporteTipo = "bilhete";
        cadastro.transporteOpcao = b.nome;
      } else if (normalizarNome(tr).startsWith("gasolina")) {
        cadastro.transporteTipo = "gasolina";
        const t = daTabela(tr);
        const v = t ?? numeroDoRotulo(tr);
        if (t === null) avisos.push(`Transporte "${tr}" aparece com valores diferentes na aba TABELAS — confira.`);
        if (v === null) avisos.push(`Gasolina "${tr}" sem valor (nem na aba TABELAS, nem no rótulo).`);
        cadastro.transporteValor = v ?? 0;
      } else avisos.push(`Transporte "${tr}" não está nos parâmetros.`);
    }
    const esc = txt("escala");
    const escala = p.escalas.find((e) => igual(e.nome, esc));
    if (esc && !escala) avisos.push(`Escala "${esc}" não está nos parâmetros.`);
    cadastro.escala = escala?.nome ?? CADASTRO_VAZIO.escala;

    const contrato = normalizarNome(txt("contrato"));
    const lancamento: DpFolhaLancamento = {
      ...LANCAMENTO_PADRAO,
      situacao: contrato === "afastado" ? "afastado" : contrato === "licenca maternidade" ? "licenca_maternidade" : "normal",
      // Célula vazia = automático (admissão/desligamento − férias); preenchida = o que o DP informou.
      diasTrabalhados: vazio(cel("dias")) ? null : lerNumero(cel("dias")),
      outrosProventos: lerNumero(cel("outros")),
      diasFerias: vazio(cel("diasFerias")) ? null : lerNumero(cel("diasFerias")),
      // Vazio = calculado como no recibo (a planilha tratava como zero, e o INSS do mês saía em dobro).
      inssFerias: vazio(cel("inssFerias")) ? null : Math.abs(lerNumero(cel("inssFerias"))),
      coparticipacao: lerNumero(cel("copart")),
      outrosDescontos: lerNumero(cel("outrosDesc")),
      comissao: lerNumero(cel("comissao")),
      // Aqui vazio é ZERO de propósito: na planilha, vazio era "VT do mês cheio", e é isso que se importa.
      vtDiasDesconto: lerNumero(cel("vtDias")),
    };

    out.push({
      linha: r + 1,
      nome,
      empresaPlanilha: txt("empresa"),
      setorPlanilha: txt("setor"),
      centroPlanilha: txt("centro"),
      contratoPlanilha: txt("contrato"),
      cadastro,
      lancamento,
      avisos,
    });
  }
  return { ok: out };
}

// ── valores digitados na aba SALÁRIO → ajustes manuais ─────────────────────

/** Cabeçalho da aba SALÁRIO → coluna ajustável do motor. */
export const COLUNA_SALARIO_PLANILHA: Record<string, DpColunaAjustavel> = {
  "salario bruto do mes": "salarioMes",
  "salario familia": "salarioFamilia",
  "auxilio home office": "homeOffice",
  ferias: "ferias",
  "1 3 ferias": "tercoFerias",
  "premio de ferias": "premioFerias",
  "desconto inss": "inss",
  "desconto vale transporte": "vtDesconto",
  "desconto plano de saude": "planoSaude",
  "descont plano odont": "odonto",
  "desconto irrf": "irrf",
  adiantamento: "adiantamento",
  alimentacao: "alimentacao",
  "vale transporte": "valeTransporte",
  "vale gasolina": "valeGasolina",
  fgts: "fgts",
};

/**
 * Na planilha, o DP digita valor por cima da fórmula quando a regra não cobre
 * o caso (39 células em setembro/2026). Essas células — e só elas — viram
 * AJUSTE MANUAL, com o motivo dizendo de onde vieram. Célula com fórmula não
 * vira ajuste: o sistema recalcula.
 */
export function ajustesDaPlanilha(
  linhas: Array<{ nome: string; celulas: Record<string, { valor: number; digitado: boolean }> }>,
  rotulo: string,
): Map<string, DpFolhaLancamento["ajustes"]> {
  const out = new Map<string, DpFolhaLancamento["ajustes"]>();
  for (const l of linhas) {
    const ajustes: DpFolhaLancamento["ajustes"] = {};
    for (const [cab, cel] of Object.entries(l.celulas)) {
      const col = COLUNA_SALARIO_PLANILHA[normalizarNome(cab)];
      if (!col || !cel.digitado || !Number.isFinite(cel.valor)) continue;
      ajustes[col] = { valor: Math.round(cel.valor * 100) / 100, motivo: `valor digitado na planilha de ${rotulo}` };
    }
    if (Object.keys(ajustes).length > 0) out.set(normalizarNome(l.nome), ajustes);
  }
  return out;
}
