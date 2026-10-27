import "server-only";

import { feriasQueComecamNoMes, mesesDoPeriodo, valorCalculadoFerias, valorDasFerias, diasDeFerias } from "@/lib/dp/ferias";
import { grupoContratoFolha, type DpContratoFolha } from "@/lib/dp/folha/motor";
import { rotuloCompetencia } from "@/lib/dp/folha/parametros";
import { lerFeriasDasPessoas, listPessoasDaFolha } from "@/lib/dp/folha/queries";
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
  calculado: { ferias: number; terco: number; total: number };
  valorManual: number | null;
  /** O que vale: o manual, senão o calculado. */
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
  periodos: Array<{ id: string; inicio: string; fim: string }>;
}

export interface DpFeriasDoMes {
  competencia: string;
  linhas: DpFeriasLinha[];
  pessoas: DpPessoaFerias[];
  /** false = a tabela dp_ferias ainda não existe no banco. */
  instalado: boolean;
}

/**
 * As férias que COMEÇAM no mês, das pessoas da folha da empresa nele (a mesma
 * população da Folha do mês), com o valor calculado pelo salário que a folha
 * usa no mês.
 */
export async function getFeriasDoMes(db: AdminClient, companyId: string, competencia: string): Promise<DpFeriasDoMes> {
  const [{ pessoas }, { data: fech }] = await Promise.all([
    listPessoasDaFolha(db, companyId, competencia),
    db.from("dp_folha_fechamentos").select("competencia").eq("company_id", companyId),
  ]);
  const ativas = pessoas.filter((p) => !p.avulso || p.avulso.unificadoCom === null);
  const ferias = await lerFeriasDasPessoas(
    db,
    ativas.map((p) => p.solidesId),
  );
  if (ferias === null) return { competencia, linhas: [], pessoas: [], instalado: false };
  const fechadas = new Set((fech ?? []).map((r) => r.competencia as string));

  const linhas: DpFeriasLinha[] = [];
  for (const p of ativas) {
    const contrato = grupoContratoFolha(p.tipoContrato);
    for (const f of feriasQueComecamNoMes(ferias.get(p.solidesId) ?? [], competencia)) {
      const dias = diasDeFerias(f.inicio, f.fim);
      const calculado = valorCalculadoFerias(p.salario, contrato, dias);
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
        calculado,
        valorManual: f.valorManual,
        valor: valorDasFerias(f.valorManual, calculado.total),
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
        periodos: (ferias.get(p.solidesId) ?? []).map((f) => ({ id: f.id, inicio: f.inicio, fim: f.fim })),
      }))
      .sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR")),
    instalado: true,
  };
}
