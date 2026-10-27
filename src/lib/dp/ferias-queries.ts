import "server-only";

import { diasDeFerias, feriasQueComecamNoMes, mesesDoPeriodo, reciboDeFerias, valorDasFerias, type DpReciboFerias } from "@/lib/dp/ferias";
import { grupoContratoFolha, type DpContratoFolha } from "@/lib/dp/folha/motor";
import { rotuloCompetencia, type DpFolhaParametros } from "@/lib/dp/folha/parametros";
import { lerFeriasDasPessoas, listParametrosVigencias, listPessoasDaFolha, parametrosDaCompetencia } from "@/lib/dp/folha/queries";
import type { createAdminClient } from "@/lib/supabase/admin";

type AdminClient = ReturnType<typeof createAdminClient>;

export interface DpFeriasLinha {
  id: string;
  solidesId: number;
  nome: string;
  setor: string | null;
  centroCusto: string | null;
  inicio: string;
  fim: string;
  dias: number;
  /** O recibo com as regras do salário: férias + 1/3 − INSS − IRRF. */
  recibo: DpReciboFerias;
  valorManual: number | null;
  /** O que vale: o manual, senão o líquido do recibo. */
  valor: number;
  observacao: string | null;
  /** A folha de um mês que o período toca está fechada: as férias não mudam (frase pronta), ou null. */
  travada: string | null;
}

/** Uma pessoa da folha do mês, para o formulário: o salário (valor calculado ao vivo) e as outras férias dela. */
export interface DpPessoaFerias {
  solidesId: number;
  nome: string;
  salario: number | null;
  contrato: DpContratoFolha;
  semInss: boolean;
  dependentesIr: number;
  periodos: Array<{ id: string; inicio: string; fim: string }>;
}

export interface DpFeriasDoMes {
  competencia: string;
  linhas: DpFeriasLinha[];
  pessoas: DpPessoaFerias[];
  /** Tabelas de INSS e IRRF da vigência do mês — o formulário calcula o recibo ao vivo com elas. */
  parametros: Pick<DpFolhaParametros, "inss" | "irrf">;
  /** Vigência dos Parâmetros da folha usada; null = padrão do sistema. */
  vigencia: string | null;
  /** false = a tabela dp_ferias ainda não existe no banco. */
  instalado: boolean;
}

/**
 * As férias que COMEÇAM no mês, das pessoas da folha da empresa nele (a mesma
 * população da Folha do mês), com o valor calculado pelo salário que a folha
 * usa no mês.
 */
export async function getFeriasDoMes(db: AdminClient, companyId: string, competencia: string): Promise<DpFeriasDoMes> {
  const [{ pessoas }, { data: fech }, vigencias] = await Promise.all([
    listPessoasDaFolha(db, companyId, competencia),
    db.from("dp_folha_fechamentos").select("competencia").eq("company_id", companyId),
    listParametrosVigencias(db),
  ]);
  const { vigencia, parametros: todos } = parametrosDaCompetencia(vigencias, competencia);
  const parametros = { inss: todos.inss, irrf: todos.irrf };
  const ativas = pessoas.filter((p) => !p.avulso || p.avulso.unificadoCom === null);
  const ferias = await lerFeriasDasPessoas(
    db,
    ativas.map((p) => p.solidesId),
  );
  if (ferias === null) return { competencia, linhas: [], pessoas: [], parametros, vigencia, instalado: false };
  const fechadas = new Set((fech ?? []).map((r) => r.competencia as string));

  const linhas: DpFeriasLinha[] = [];
  for (const p of ativas) {
    const contrato = grupoContratoFolha(p.tipoContrato);
    for (const f of feriasQueComecamNoMes(ferias.get(p.solidesId) ?? [], competencia)) {
      const dias = diasDeFerias(f.inicio, f.fim);
      const recibo = reciboDeFerias(
        { salario: p.salario, contrato, dias, semInss: p.cadastro.semInss, dependentesIr: p.cadastro.dependentesIr },
        parametros,
      );
      const fechado = mesesDoPeriodo(f.inicio, f.fim).find((m) => fechadas.has(m)) ?? null;
      linhas.push({
        id: f.id,
        solidesId: p.solidesId,
        nome: p.nome,
        setor: p.cadastro.setorFolha ?? p.setor,
        centroCusto: p.centroCusto,
        inicio: f.inicio,
        fim: f.fim,
        dias,
        recibo,
        valorManual: f.valorManual,
        valor: valorDasFerias(f.valorManual, recibo.liquido),
        observacao: f.observacao,
        travada: fechado ? `A folha de ${rotuloCompetencia(fechado)} está fechada — reabra para mudar estas férias.` : null,
      });
    }
  }
  linhas.sort((a, b) => a.inicio.localeCompare(b.inicio) || a.nome.localeCompare(b.nome, "pt-BR"));

  return {
    competencia,
    linhas,
    pessoas: ativas
      .map((p) => ({
        solidesId: p.solidesId,
        nome: p.nome,
        salario: p.salario,
        contrato: grupoContratoFolha(p.tipoContrato),
        semInss: p.cadastro.semInss,
        dependentesIr: p.cadastro.dependentesIr,
        periodos: (ferias.get(p.solidesId) ?? []).map((f) => ({ id: f.id, inicio: f.inicio, fim: f.fim })),
      }))
      .sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR")),
    parametros,
    vigencia,
    instalado: true,
  };
}
