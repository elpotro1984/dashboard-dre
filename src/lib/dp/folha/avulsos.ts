// ============================================================================
// Pessoas da folha FORA da Sólides — puro e testado (decisão de 19/10/2026:
// 11 das 124 linhas da planilha de set/2026 não existiam na Sólides — 6 CLT,
// 4 PJ, 1 estágio). O avulso é incluído na própria folha, marcado como "fora
// da Sólides", com id NEGATIVO: é o número que cadastro, lançamentos e
// rescisões usam no lugar do solides_id. Quando a pessoa aparece na Sólides,
// a folha avisa e oferece UNIFICAR (o cadastro e os meses passam para o id da
// Sólides) — duas linhas da mesma pessoa na folha pagariam em dobro.
// ============================================================================

import { normalizarNome } from "@/lib/dp/folha/importacao";

export interface DpAvulso {
  pessoaId: number;
  companyId: string;
  nome: string;
  cpf: string | null;
  setor: string | null;
  tipoContrato: string | null;
  salario: number | null;
  nascimento: string | null;
  admissao: string | null;
  desligamento: string | null;
  centroCustoId: string | null;
  unificadoCom: number | null;
  observacao: string | null;
}

export const CONTRATOS_AVULSO = ["CLT", "Jovem Aprendiz", "Estagiário", "Prestador de Serviço", "Sócio"] as const;

const RE_DATA = /^\d{4}-\d{2}-\d{2}$/;

function ultimoDia(competencia: string): string {
  const [y, m] = competencia.split("-").map(Number);
  const d = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return `${competencia}-${String(d).padStart(2, "0")}`;
}

/** O avulso entra na folha do mês? Não se já foi unificado; e só entre admissão e desligamento. */
export function avulsoNaCompetencia(a: Pick<DpAvulso, "admissao" | "desligamento" | "unificadoCom">, competencia: string): boolean {
  if (a.unificadoCom !== null) return false;
  if (a.admissao && a.admissao > ultimoDia(competencia)) return false;
  if (a.desligamento && a.desligamento < `${competencia}-01`) return false;
  return true;
}

/** "PJ" / "ESTÁGIO" da planilha → o vocabulário da Sólides, que o motor já entende. */
export function contratoDaPlanilha(rotulo: string): string {
  const t = normalizarNome(rotulo);
  if (t === "pj" || t.includes("prestador") || t === "rpa") return "Prestador de Serviço";
  if (t.includes("estag")) return "Estagiário";
  if (t.includes("aprendiz")) return "Jovem Aprendiz";
  if (t.includes("socio")) return "Sócio";
  return "CLT";
}

/**
 * A "EMPRESA REGISTRADA" da planilha (ex.: "V EVENTOS") → empresa do Control
 * Hub, APRENDIDA de quem casou com a Sólides: para cada rótulo, a empresa que
 * a maioria das pessoas casadas daquele rótulo tem. Empate não decide —
 * criar o avulso na empresa errada é pior que não criar e avisar.
 */
export function empresasPorRotulo(pares: Array<{ rotulo: string; companyId: string }>): Map<string, string> {
  const cont = new Map<string, Map<string, number>>();
  for (const p of pares) {
    const k = normalizarNome(p.rotulo);
    if (!k) continue;
    const m = cont.get(k) ?? new Map<string, number>();
    m.set(p.companyId, (m.get(p.companyId) ?? 0) + 1);
    cont.set(k, m);
  }
  const out = new Map<string, string>();
  for (const [k, m] of Array.from(cont)) {
    const ordem = Array.from(m).sort((a, b) => b[1] - a[1]);
    if (ordem.length === 1 || ordem[0][1] > ordem[1][1]) out.set(k, ordem[0][0]);
  }
  return out;
}

export interface DpAvulsoEntrada {
  nome: string;
  cpf: string | null;
  setor: string | null;
  tipoContrato: string | null;
  salario: number | null;
  nascimento: string | null;
  admissao: string | null;
  desligamento: string | null;
  observacao: string | null;
}

const texto = (v: string | null | undefined, max: number) => String(v ?? "").replace(/\s+/g, " ").trim().slice(0, max) || null;

export function validarAvulso(a: DpAvulsoEntrada): DpAvulsoEntrada {
  const nome = texto(a.nome, 200);
  if (!nome) throw new Error("Informe o nome.");
  for (const [campo, v] of [
    ["Nascimento", a.nascimento],
    ["Admissão", a.admissao],
    ["Desligamento", a.desligamento],
  ] as const) {
    if (v && !RE_DATA.test(v)) throw new Error(`${campo}: data inválida.`);
  }
  if (a.admissao && a.desligamento && a.desligamento < a.admissao) throw new Error("O desligamento é antes da admissão.");
  if (a.salario !== null && (!Number.isFinite(a.salario) || a.salario < 0 || a.salario > 10_000_000)) throw new Error("Salário inválido.");
  const cpf = (a.cpf ?? "").replace(/\D/g, "") || null;
  if (cpf && cpf.length !== 11) throw new Error("CPF precisa de 11 dígitos.");
  return {
    nome,
    cpf,
    setor: texto(a.setor, 120),
    tipoContrato: texto(a.tipoContrato, 60),
    salario: a.salario === null ? null : Math.round(a.salario * 100) / 100,
    nascimento: a.nascimento || null,
    admissao: a.admissao || null,
    desligamento: a.desligamento || null,
    observacao: texto(a.observacao, 500),
  };
}
