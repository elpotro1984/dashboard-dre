import "server-only";

import { BENEFICIOS_COLABORADOR_VAZIO } from "@/lib/dp/beneficios-colaborador";
import { lerBeneficiosDaEmpresa, lerBeneficiosDosColaboradores } from "@/lib/dp/beneficios-queries";
import { lerFeriasDasPessoas, listParametrosVigencias, listPessoasDaFolha, parametrosDaCompetencia } from "@/lib/dp/folha/queries";
import { beneficiosDoMes, colunasCadastradas, diasDoMes, totalDasCelulas, type DpGestaoDados, type DpLinhaGestao } from "@/lib/dp/gestao-beneficios";
import type { createAdminClient } from "@/lib/supabase/admin";

type AdminClient = ReturnType<typeof createAdminClient>;

/**
 * A Gestão de benefícios da EMPRESA no mês: as pessoas da Sólides da folha do
 * mês (a mesma população da Folha — inclusive quem é admitido ou sai no mês),
 * os dias de cada uma (escala da folha + o Pagamento de férias, com a FK) e o
 * card "Benefícios" dela com o valor do cadastro da empresa
 * (@/lib/dp/gestao-beneficios). Avulsos não entram: eles não têm ficha nem card.
 */
export async function getGestaoBeneficios(db: AdminClient, companyId: string, competencia: string): Promise<DpGestaoDados> {
  const [{ pessoas: todas }, vigencias, empresa] = await Promise.all([
    listPessoasDaFolha(db, companyId, competencia),
    listParametrosVigencias(db),
    lerBeneficiosDaEmpresa(db, companyId),
  ]);
  const pessoas = todas.filter((p) => p.avulso === null);
  const ids = pessoas.map((p) => p.solidesId);
  const [ferias, cards] = await Promise.all([lerFeriasDasPessoas(db, ids), lerBeneficiosDosColaboradores(db, ids)]);
  const { vigencia, parametros } = parametrosDaCompetencia(vigencias, competencia);

  const linhas = pessoas.map((p): DpLinhaGestao => {
    const escala = parametros.escalas.find((e) => e.nome === p.cadastro.escala) ?? null;
    const dias = diasDoMes({
      competencia,
      admissao: p.admissao,
      desligamento: p.desligamento,
      ferias: (ferias?.get(p.solidesId) ?? []).map((f) => ({ inicio: f.inicio, fim: f.fim, fk: f.fk })),
      escala: escala ? { nome: escala.nome, diasSemana: escala.diasSemana, feriados: escala.feriados } : null,
    });
    const card = cards?.get(p.solidesId) ?? null;
    const celulas = beneficiosDoMes({
      cfg: empresa.dados,
      escolhas: card?.dados ?? BENEFICIOS_COLABORADOR_VAZIO,
      pessoa: {
        tipoContrato: p.tipoContrato,
        salario: p.salario,
        dependentes: p.dependentesSolides.map((d) => ({ nome: d.nome, nascimento: d.nascimento, parentesco: d.parentesco })),
      },
      dias,
      competencia,
    });
    const avisos: string[] = [];
    if (card?.companyId && card.companyId !== companyId) {
      avisos.push("Os benefícios desta pessoa foram escolhidos no cadastro de outra empresa — confira o card na ficha.");
    }
    if (p.desligamentoEstimado && dias.desligamentoNoMes) {
      avisos.push("Sem data de desligamento na Sólides: usei o dia em que a sincronização percebeu a saída.");
    }
    return {
      solidesId: p.solidesId,
      colaboradorId: p.colaboradorId,
      nome: p.nome,
      // Setor = o departamento da Sólides, como no Custos com colaboradores.
      setor: p.setor,
      dias,
      celulas,
      total: totalDasCelulas(celulas),
      semCadastro: !card,
      avisos,
    };
  });
  linhas.sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"));

  return {
    competencia,
    linhas,
    empresaTemCadastro: empresa.blocosSalvos > 0,
    regraAlimentacao: empresa.dados.alimentacao.regra,
    colunasCadastradas: colunasCadastradas(empresa.dados),
    vigencia,
    faltando: { card: cards === null, ferias: ferias === null },
  };
}
