import "server-only";

import {
  calcular13,
  classificarMeses13,
  dataLimite13,
  validarAjustes13,
  type Dp13Ajustes,
  type Dp13Resultado,
} from "@/lib/dp/folha/decimo-terceiro";
import { grupoContratoFolha } from "@/lib/dp/folha/motor";
import { lerParametros, type DpFolhaParametros } from "@/lib/dp/folha/parametros";
import { listParametrosVigencias, listPessoasDaFolha, parametrosDaCompetencia } from "@/lib/dp/folha/queries";
import { DpNaoInstaladoError } from "@/lib/dp/queries";
import type { createAdminClient } from "@/lib/supabase/admin";

// Leituras do 13º SALÁRIO. Mesmo enquadramento da folha do mês: admin client
// DEPOIS do guard do app (quem chama já conferiu a empresa) e o número é sempre
// o do motor (decimo-terceiro.ts) — ou o retrato, quando a parcela está fechada.

type AdminClient = ReturnType<typeof createAdminClient>;

function ausente(error: { code?: string } | null): boolean {
  return error?.code === "PGRST205" || error?.code === "42P01";
}

function check(error: { code?: string; message: string } | null, what: string): void {
  if (!error) return;
  if (ausente(error)) throw new DpNaoInstaladoError();
  throw new Error(`${what}: ${error.message}`);
}

export interface Dp13Fechamento {
  fechadoEm: string;
  fechadoPor: string | null;
}

/** O que se edita do 13º de cada pessoa (dp_folha_13). */
export interface Dp13Edicao {
  ajustes: Dp13Ajustes;
  primeiraFerias: number | null;
  observacao: string | null;
}

export interface Dp13Empresa {
  companyId: string;
  ano: number;
  vigencia: string | null;
  parametros: DpFolhaParametros;
  fechamentos: { 1: Dp13Fechamento | null; 2: Dp13Fechamento | null };
  linhas: Dp13Resultado[];
  edicoes: Record<number, Dp13Edicao>;
  /** Pagos na 1ª parcela que não estão mais na empresa: a 1ª se desconta na rescisão. */
  saidasDepoisDaPrimeira: Array<{ solidesId: number; nome: string; primeira: number }>;
  limites: { primeira: string; segunda: string };
}

interface Retrato {
  vigencia: string | null;
  parametros: unknown;
  linhas: Dp13Resultado[];
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function lerFechamento(r: any): { retrato: Retrato; fech: Dp13Fechamento } {
  const u = (Array.isArray(r.users) ? r.users[0] : r.users) as { name: string | null; email: string } | null;
  const res = (r.resultado ?? {}) as Partial<Retrato>;
  return {
    retrato: { vigencia: res.vigencia ?? null, parametros: res.parametros, linhas: Array.isArray(res.linhas) ? res.linhas : [] },
    fech: { fechadoEm: r.fechado_em as string, fechadoPor: u?.name ?? u?.email ?? null },
  };
}

/** Lançamentos do ano que dizem algo para os avos (afastado, licença, dias informados), em páginas de 1000. */
async function lancamentosDoAno(db: AdminClient, ano: number, ids: number[]) {
  const out: Array<{ competencia: string; solides_id: number; situacao: string; dias_trabalhados: number | null; dias_ferias: number | null }> = [];
  if (ids.length === 0) return out;
  for (let de = 0; ; de += 1000) {
    const { data, error } = await db
      .from("dp_folha_lancamentos")
      .select("competencia, solides_id, situacao, dias_trabalhados, dias_ferias")
      .gte("competencia", `${ano}-01`)
      .lte("competencia", `${ano}-12`)
      .in("solides_id", ids)
      .or("situacao.neq.normal,dias_trabalhados.not.is.null")
      .order("competencia")
      .order("solides_id")
      .range(de, de + 999);
    check(error, "dp_folha_lancamentos");
    out.push(
      ...(data ?? []).map((r) => ({
        competencia: r.competencia as string,
        solides_id: Number(r.solides_id),
        situacao: r.situacao as string,
        dias_trabalhados: r.dias_trabalhados === null ? null : Number(r.dias_trabalhados),
        dias_ferias: r.dias_ferias === null ? null : Number(r.dias_ferias),
      })),
    );
    if ((data ?? []).length < 1000) return out;
  }
}

export async function getDecimoTerceiro(db: AdminClient, companyId: string, ano: number): Promise<Dp13Empresa> {
  const dezembro = `${ano}-12`;
  const [vigencias, fechRes, { pessoas }] = await Promise.all([
    listParametrosVigencias(db),
    db.from("dp_folha_13_fechamentos").select("parcela, resultado, fechado_em, users(name, email)").eq("company_id", companyId).eq("ano", ano),
    listPessoasDaFolha(db, companyId, dezembro),
  ]);
  check(fechRes.error, "dp_folha_13_fechamentos");
  const fech1 = (fechRes.data ?? []).find((r) => Number(r.parcela) === 1);
  const fech2 = (fechRes.data ?? []).find((r) => Number(r.parcela) === 2);
  const f1 = fech1 ? lerFechamento(fech1) : null;
  const f2 = fech2 ? lerFechamento(fech2) : null;
  const limites = { primeira: dataLimite13(ano, 1), segunda: dataLimite13(ano, 2) };
  const fechamentos = { 1: f1?.fech ?? null, 2: f2?.fech ?? null };

  const ids = pessoas.map((p) => p.solidesId);
  const [edRes, lancs] = await Promise.all([
    ids.length ? db.from("dp_folha_13").select("solides_id, ajustes, primeira_ferias, observacao").eq("ano", ano).in("solides_id", ids) : Promise.resolve({ data: [], error: null }),
    f2 ? Promise.resolve([]) : lancamentosDoAno(db, ano, ids),
  ]);
  check(edRes.error, "dp_folha_13");
  const edicoes: Record<number, Dp13Edicao> = {};
  for (const r of edRes.data ?? []) {
    let ajustes: Dp13Ajustes = {};
    try {
      ajustes = validarAjustes13(r.ajustes);
    } catch {
      ajustes = {};
    }
    edicoes[Number(r.solides_id)] = {
      ajustes,
      primeiraFerias: r.primeira_ferias === null ? null : Number(r.primeira_ferias),
      observacao: (r.observacao as string | null) ?? null,
    };
  }

  const linhasDoRetrato = (linhas: Dp13Resultado[]) => new Map(linhas.map((l) => [l.solidesId, l]));
  const r1 = f1 ? linhasDoRetrato(f1.retrato.linhas) : null;
  const saidas = (atuais: Dp13Resultado[]) => {
    if (!r1) return [];
    const dentro = new Set(atuais.filter((l) => !l.fora).map((l) => l.solidesId));
    return f1!.retrato.linhas
      .filter((l) => !l.fora && l.primeira > 0 && !dentro.has(l.solidesId))
      .map((l) => ({ solidesId: l.solidesId, nome: l.nome, primeira: l.primeira }));
  };

  // 2ª fechada: tudo é retrato.
  if (f2) {
    return {
      companyId,
      ano,
      vigencia: f2.retrato.vigencia,
      parametros: lerParametros(f2.retrato.parametros),
      fechamentos,
      linhas: f2.retrato.linhas,
      edicoes,
      saidasDepoisDaPrimeira: saidas(f2.retrato.linhas),
      limites,
    };
  }

  const { vigencia, parametros } = parametrosDaCompetencia(vigencias, dezembro);
  const lancPor = new Map<number, typeof lancs>();
  for (const l of lancs) {
    const lista = lancPor.get(l.solides_id) ?? [];
    lista.push(l);
    lancPor.set(l.solides_id, lista);
  }
  const linhas = pessoas.map((p) => {
    const meses = classificarMeses13(
      (lancPor.get(p.solidesId) ?? []).map((l) => ({
        competencia: l.competencia,
        situacao: l.situacao,
        diasTrabalhados: l.dias_trabalhados,
        diasFerias: l.dias_ferias,
      })),
      { admissao: p.admissao, desligamento: p.desligamento, ferias: p.cadastro.ferias },
    );
    const ed = edicoes[p.solidesId];
    const doRetrato = r1?.get(p.solidesId);
    return calcular13(
      {
        solidesId: p.solidesId,
        nome: p.nome,
        setor: p.cadastro.setorFolha ?? p.setor,
        contrato: grupoContratoFolha(p.tipoContrato),
        salario: p.salario,
        admissao: p.admissao,
        desligamento: p.desligamento,
        dependentesIr: p.cadastro.dependentesIr,
        semInss: p.cadastro.semInss,
        ...meses,
        primeiraNasFerias: ed?.primeiraFerias ?? null,
        primeiraEstaFechada: Boolean(r1),
        primeiraFechada: doRetrato && !doRetrato.fora ? doRetrato.primeira : null,
        ajustes: ed?.ajustes ?? {},
      },
      parametros,
      ano,
    );
  });
  // Com a 1ª fechada, a coluna da 1ª parcela é a do retrato até para quem saiu depois.
  return {
    companyId,
    ano,
    vigencia: f1 ? f1.retrato.vigencia ?? vigencia : vigencia,
    parametros,
    fechamentos,
    linhas,
    edicoes,
    saidasDepoisDaPrimeira: saidas(linhas),
    limites,
  };
}

/**
 * Para a calculadora de rescisão: a 1ª parcela do 13º já paga no ano (retrato
 * da 1ª fechada, ou a paga nas férias) e os meses afastados, por pessoa. Sem as
 * tabelas do 13º (migration não aplicada), devolve vazio — a calculadora segue
 * funcionando com o campo para informar.
 */
export async function dadosRescisaoDoAno(
  db: AdminClient,
  companyId: string,
  ano: number,
  ids: number[],
): Promise<{ primeira13: Record<number, number>; afastados: Record<number, string[]> }> {
  const primeira13: Record<number, number> = {};
  const afastados: Record<number, string[]> = {};
  if (ids.length === 0) return { primeira13, afastados };
  const [fRes, edRes, aRes] = await Promise.all([
    db.from("dp_folha_13_fechamentos").select("resultado").eq("company_id", companyId).eq("ano", ano).eq("parcela", 1).maybeSingle(),
    db.from("dp_folha_13").select("solides_id, primeira_ferias").eq("ano", ano).in("solides_id", ids).not("primeira_ferias", "is", null),
    db
      .from("dp_folha_lancamentos")
      .select("competencia, solides_id")
      .gte("competencia", `${ano}-01`)
      .lte("competencia", `${ano}-12`)
      .in("solides_id", ids)
      .eq("situacao", "afastado"),
  ]);
  if (!fRes.error && fRes.data) {
    const linhas = ((fRes.data.resultado as { linhas?: Dp13Resultado[] } | null)?.linhas ?? []) as Dp13Resultado[];
    for (const l of linhas) if (!l.fora && l.primeira > 0) primeira13[l.solidesId] = l.primeira;
  } else if (fRes.error && !ausente(fRes.error)) throw new Error(`dp_folha_13_fechamentos: ${fRes.error.message}`);
  if (!edRes.error) {
    for (const r of edRes.data ?? []) if (Number(r.primeira_ferias) > 0) primeira13[Number(r.solides_id)] = Number(r.primeira_ferias);
  } else if (!ausente(edRes.error)) throw new Error(`dp_folha_13: ${edRes.error.message}`);
  check(aRes.error, "dp_folha_lancamentos");
  for (const r of aRes.data ?? []) (afastados[Number(r.solides_id)] ??= []).push(r.competencia as string);
  return { primeira13, afastados };
}
