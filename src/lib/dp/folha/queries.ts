import "server-only";

import { getDpCargosPagina, rotuloCentro } from "@/lib/dp/cargos-queries";
import { avulsoNaCompetencia, type DpAvulso } from "@/lib/dp/folha/avulsos";
import { colaboradorNoMes } from "@/lib/dp/folha/calendario";
import { rescisoesSugeridas, textoVariacao, variacoesContraAnterior, type DpRescisaoSugerida } from "@/lib/dp/folha/conferencia";
import { casarNome } from "@/lib/dp/folha/importacao";
import { indexarRegras, resolverEmpresa } from "@/lib/dp/empresa";
import {
  calcularFolhaPessoa,
  CADASTRO_VAZIO,
  grupoContratoFolha,
  LANCAMENTO_PADRAO,
  type DpFolhaCadastro,
  type DpFolhaEntrada,
  type DpFolhaLancamento,
  type DpFolhaResultado,
} from "@/lib/dp/folha/motor";
import { lerParametros, PARAMETROS_PADRAO, rotuloCompetencia, somarMeses, vigenciaPara, type DpFolhaParametros } from "@/lib/dp/folha/parametros";
import { DpNaoInstaladoError, listDpRegras } from "@/lib/dp/queries";
import type { DpDependente } from "@/lib/dp/solides/parse";
import type { createAdminClient } from "@/lib/supabase/admin";

// Leituras da FOLHA GERENCIAL. Admin client DEPOIS do guard do app; quem chama
// já conferiu que a pessoa pode ver a empresa (escopo.ts). O cálculo é sempre
// o do motor — a tela nunca recebe número feito em outro lugar.

type AdminClient = ReturnType<typeof createAdminClient>;

function ausente(error: { code?: string } | null): boolean {
  return error?.code === "PGRST205" || error?.code === "42P01";
}

function check(error: { code?: string; message: string } | null, what: string): void {
  if (!error) return;
  if (ausente(error)) throw new DpNaoInstaladoError();
  throw new Error(`${what}: ${error.message}`);
}

// ── parâmetros ─────────────────────────────────────────────────────────────

export interface DpParametrosVigencia {
  vigencia: string;
  dados: DpFolhaParametros;
  updatedAt: string;
}

export async function listParametrosVigencias(db: AdminClient): Promise<DpParametrosVigencia[]> {
  const { data, error } = await db.from("dp_folha_parametros").select("vigencia, dados, updated_at").order("vigencia");
  check(error, "dp_folha_parametros");
  return (data ?? []).map((r) => ({ vigencia: r.vigencia as string, dados: lerParametros(r.dados), updatedAt: r.updated_at as string }));
}

/** Parâmetros da competência; sem nenhuma vigência cadastrada, o padrão do sistema (dito na tela). */
export function parametrosDaCompetencia(
  vigencias: DpParametrosVigencia[],
  competencia: string,
): { vigencia: string | null; parametros: DpFolhaParametros } {
  const v = vigenciaPara(vigencias, competencia);
  return v ? { vigencia: v.vigencia, parametros: v.dados } : { vigencia: null, parametros: PARAMETROS_PADRAO };
}

// ── cadastro e lançamentos ─────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function toCadastro(r: any): DpFolhaCadastro {
  return {
    planoSaude: r.plano_saude,
    planoDependentes: Array.isArray(r.plano_dependentes) ? r.plano_dependentes : [],
    odontoVidas: Number(r.odonto_vidas),
    salarioFamiliaCotas: Number(r.salario_familia_cotas),
    dependentesIr: Number(r.dependentes_ir),
    adiantamento: Boolean(r.adiantamento),
    alimentacao: Number(r.alimentacao),
    transporteTipo: r.transporte_tipo,
    transporteOpcao: r.transporte_opcao,
    transporteValor: Number(r.transporte_valor),
    escala: r.escala,
    homeOffice: Number(r.home_office),
    semInss: Boolean(r.sem_inss),
    setorFolha: (r.setor_folha as string | null) ?? null,
    recorrentes: Array.isArray(r.recorrentes) ? r.recorrentes : [],
    ferias: Array.isArray(r.ferias) ? r.ferias : [],
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function toLancamento(r: any): DpFolhaLancamento {
  // NULL é "automático", e Number(null) é 0 — a conversão crua transformaria o
  // automático em "zero informado" (ex.: zero dias trabalhados).
  const opc = (v: unknown) => (v === null || v === undefined ? null : Number(v));
  return {
    situacao: r.situacao,
    diasTrabalhados: opc(r.dias_trabalhados),
    outrosProventos: Number(r.outros_proventos),
    diasFerias: opc(r.dias_ferias),
    inssFerias: opc(r.inss_ferias),
    coparticipacao: Number(r.coparticipacao),
    outrosDescontos: Number(r.outros_descontos),
    comissao: Number(r.comissao),
    vtDiasDesconto: opc(r.vt_dias_desconto),
    ajustes: r.ajustes && typeof r.ajustes === "object" ? r.ajustes : {},
  };
}

export interface DpFolhaPessoa {
  colaboradorId: string;
  solidesId: number;
  nome: string;
  ativo: boolean;
  /** Departamento da Sólides (sem o sufixo da empresa). O da folha é `cadastro.setorFolha ?? setor`. */
  setor: string | null;
  centroCusto: string | null;
  /** Centro de custo que vale (exceção da pessoa ?? padrão da linha da tabela salarial). */
  centroId: string | null;
  centroOrigem: "excecao" | "linha" | null;
  /** Pessoa FORA da Sólides (id negativo); null = colaborador do espelho. */
  avulso: DpAvulso | null;
  /** Avulso que agora aparece na Sólides, na mesma empresa: unificar. */
  unificarCom: { solidesId: number; nome: string } | null;
  tipoContrato: string | null;
  salario: number | null;
  nascimento: string | null;
  admissao: string | null;
  /** Desligamento: o da Sólides, ou o dia em que a sincronização percebeu a saída (`desligamentoEstimado`). */
  desligamento: string | null;
  desligamentoEstimado: boolean;
  /** Dependentes da Sólides — sugestão para o plano de saúde (nem todos estão no plano). */
  dependentesSolides: DpDependente[];
  temCadastro: boolean;
  temLancamento: boolean;
  cadastro: DpFolhaCadastro;
  lancamento: DpFolhaLancamento;
  observacaoMes: string | null;
}

export interface DpFolhaRescisao {
  id: string;
  dataPagamento: string | null;
  tipo: string;
  setor: string;
  valor: number;
  solidesId: number | null;
  nome: string;
  observacao: string | null;
}

export interface DpFolhaFechamento {
  fechadoEm: string;
  fechadoPor: string | null;
  vigencia: string | null;
}

export interface DpFolhaEmpresa {
  companyId: string;
  competencia: string;
  vigencia: string | null;
  parametros: DpFolhaParametros;
  fechamento: DpFolhaFechamento | null;
  pessoas: DpFolhaPessoa[];
  linhas: DpFolhaResultado[];
  rescisoes: DpFolhaRescisao[];
  /** Centros de custo da empresa (cadastro do DP), para escolher na folha. */
  centros: Array<{ id: string; rotulo: string }>;
  /** Desligados no mês sem rescisão lançada. */
  rescisoesSugeridas: DpRescisaoSugerida[];
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function toAvulso(r: any): DpAvulso {
  return {
    pessoaId: Number(r.pessoa_id),
    companyId: r.company_id as string,
    nome: r.nome as string,
    cpf: r.cpf ?? null,
    setor: r.setor ?? null,
    tipoContrato: r.tipo_contrato ?? null,
    salario: r.salario === null ? null : Number(r.salario),
    nascimento: r.data_nascimento ?? null,
    admissao: r.data_admissao ?? null,
    desligamento: r.data_desligamento ?? null,
    centroCustoId: r.centro_custo_id ?? null,
    unificadoCom: r.unificado_com === null ? null : Number(r.unificado_com),
    observacao: r.observacao ?? null,
  };
}

export async function listAvulsos(db: AdminClient, companyId: string): Promise<DpAvulso[]> {
  const { data, error } = await db.from("dp_folha_avulsos").select("*").eq("company_id", companyId).order("nome");
  check(error, "dp_folha_avulsos");
  return (data ?? []).map(toAvulso);
}

/** O departamento da Sólides vem como "ÁREA - EMPRESA": o sufixo é a empresa, que a tela já é. */
export function setorDoDepartamento(dep: string | null): string | null {
  const s = (dep ?? "").replace(/\s+-\s+.*$/, "").trim();
  return s || null;
}

async function listRescisoes(db: AdminClient, companyId: string, competencia: string): Promise<DpFolhaRescisao[]> {
  const { data, error } = await db
    .from("dp_folha_rescisoes")
    .select("id, data_pagamento, tipo, setor, valor, solides_id, nome, observacao")
    .eq("company_id", companyId)
    .eq("competencia", competencia)
    .order("data_pagamento", { ascending: true, nullsFirst: false });
  check(error, "dp_folha_rescisoes");
  return (data ?? []).map((r) => ({
    id: r.id as string,
    dataPagamento: r.data_pagamento as string | null,
    tipo: r.tipo as string,
    setor: r.setor as string,
    valor: Number(r.valor),
    solidesId: r.solides_id === null ? null : Number(r.solides_id),
    nome: r.nome as string,
    observacao: r.observacao as string | null,
  }));
}

/**
 * Quem entra na folha da empresa no mês: os ATIVOS dela, e o desligado que já
 * tem lançamento naquela competência (o último mês de quem saiu).
 */
/**
 * A folha da empresa no mês. Com `compararComAnterior`, cada pessoa cujo total
 * mudou mais que o limite dos parâmetros contra o mês anterior ganha um aviso
 * (só na leitura da tela — o retrato do fechamento não leva esse aviso).
 */
export async function getFolhaEmpresa(
  db: AdminClient,
  companyId: string,
  competencia: string,
  opcoes: { compararComAnterior?: boolean } = {},
): Promise<DpFolhaEmpresa> {
  const folha = await montarFolha(db, companyId, competencia);
  if (!opcoes.compararComAnterior) return folha;
  const anteriorComp = somarMeses(competencia, -1);
  const anterior = await montarFolha(db, companyId, anteriorComp).catch(() => null);
  if (!anterior || anterior.linhas.length === 0) return folha;
  const vars = variacoesContraAnterior(
    folha.linhas.map((l) => ({ solidesId: l.solidesId, valor: l.totalGeral })),
    anterior.linhas.map((l) => ({ solidesId: l.solidesId, valor: l.totalGeral })),
    folha.parametros.variacaoAlerta,
  );
  if (vars.size === 0) return folha;
  const rotulo = rotuloCompetencia(anteriorComp);
  return {
    ...folha,
    linhas: folha.linhas.map((l) => {
      const v = vars.get(l.solidesId);
      return v ? { ...l, avisos: [...l.avisos, textoVariacao(v, rotulo)] } : l;
    }),
  };
}

async function montarFolha(db: AdminClient, companyId: string, competencia: string): Promise<DpFolhaEmpresa> {
  const [vigencias, fechRes, regras, colabsRes, lancRes, rescisoes, pagina, avulsos] = await Promise.all([
    listParametrosVigencias(db),
    db.from("dp_folha_fechamentos").select("resultado, fechado_em, users(name, email)").eq("company_id", companyId).eq("competencia", competencia).maybeSingle(),
    listDpRegras(db),
    db
      .from("dp_colaboradores")
      .select(
        "id, solides_id, nome, ativo, unidade_id, departamento_id, departamento_nome, tipo_contrato, salario, data_nascimento, dependentes, data_admissao, data_desligamento, desligado_detectado_em",
      )
      .order("nome"),
    db.from("dp_folha_lancamentos").select("*").eq("competencia", competencia),
    listRescisoes(db, companyId, competencia),
    getDpCargosPagina(db, companyId).catch(() => null),
    listAvulsos(db, companyId),
  ]);
  check(fechRes.error, "dp_folha_fechamentos");
  check(colabsRes.error, "dp_colaboradores");
  check(lancRes.error, "dp_folha_lancamentos");

  const idx = indexarRegras(regras);
  const lancPorSolides = new Map((lancRes.data ?? []).map((r) => [Number(r.solides_id), r]));
  const daEmpresa = (colabsRes.data ?? []).filter((r) => {
    const e = resolverEmpresa(
      {
        unidadeId: r.unidade_id === null ? null : Number(r.unidade_id),
        departamentoId: r.departamento_id === null ? null : Number(r.departamento_id),
      },
      idx,
    );
    return (
      e.companyId === companyId &&
      colaboradorNoMes(
        {
          ativo: Boolean(r.ativo),
          admissao: r.data_admissao as string | null,
          desligamento: r.data_desligamento as string | null,
          desligadoDetectadoEm: r.desligado_detectado_em as string | null,
          temLancamento: lancPorSolides.has(Number(r.solides_id)),
        },
        competencia,
      )
    );
  });

  const avulsosDoMes = avulsos.filter((a) => avulsoNaCompetencia(a, competencia) || (a.unificadoCom === null && lancPorSolides.has(a.pessoaId)));
  const solidesIds = [...daEmpresa.map((r) => Number(r.solides_id)), ...avulsosDoMes.map((a) => a.pessoaId)];
  const cadRes = solidesIds.length
    ? await db.from("dp_folha_cadastro").select("*").in("solides_id", solidesIds)
    : { data: [], error: null };
  check(cadRes.error, "dp_folha_cadastro");
  const cadPorSolides = new Map((cadRes.data ?? []).map((r) => [Number(r.solides_id), r]));
  // Centro de custo pela MESMA regra da tela de cargos (exceção da pessoa ?? padrão da linha).
  const enqPorColab = new Map((pagina?.enquadramento ?? []).map((r) => [r.colaboradorId, r]));
  const centros = (pagina?.centros ?? []).map((c) => ({ id: c.id, rotulo: rotuloCentro(c) }));

  const pessoas: DpFolhaPessoa[] = daEmpresa.map((r) => {
    const cad = cadPorSolides.get(Number(r.solides_id));
    const lan = lancPorSolides.get(Number(r.solides_id));
    return {
      colaboradorId: r.id as string,
      solidesId: Number(r.solides_id),
      nome: r.nome as string,
      ativo: Boolean(r.ativo),
      setor: setorDoDepartamento(r.departamento_nome as string | null),
      centroCusto: enqPorColab.get(r.id as string)?.centroCusto ?? null,
      centroId: enqPorColab.get(r.id as string)?.centroId ?? null,
      centroOrigem: enqPorColab.get(r.id as string)?.origemCentro ?? null,
      avulso: null,
      unificarCom: null,
      tipoContrato: r.tipo_contrato as string | null,
      salario: r.salario === null ? null : Number(r.salario),
      nascimento: (r.data_nascimento as string | null) ?? null,
      admissao: (r.data_admissao as string | null) ?? null,
      desligamento:
        (r.data_desligamento as string | null) ??
        (!r.ativo && r.desligado_detectado_em ? String(r.desligado_detectado_em).slice(0, 10) : null),
      desligamentoEstimado: !r.data_desligamento && !r.ativo && Boolean(r.desligado_detectado_em),
      dependentesSolides: Array.isArray(r.dependentes) ? (r.dependentes as DpDependente[]) : [],
      temCadastro: Boolean(cad),
      temLancamento: Boolean(lan),
      cadastro: cad ? toCadastro(cad) : { ...CADASTRO_VAZIO, planoDependentes: [] },
      lancamento: lan ? toLancamento(lan) : { ...LANCAMENTO_PADRAO, ajustes: {} },
      observacaoMes: (lan?.observacao as string | null) ?? null,
    };
  });

  // Fora da Sólides: entram como pessoa da folha com id negativo. Se o mesmo nome
  // já aparece na Sólides NESTA empresa, a tela oferece unificar.
  const ativosDaEmpresa = daEmpresa.filter((r) => r.ativo).map((r) => ({ solidesId: Number(r.solides_id), nome: r.nome as string }));
  const rotuloCentroPor = new Map((pagina?.centros ?? []).map((c) => [c.id, rotuloCentro(c)]));
  for (const a of avulsosDoMes) {
    const cad = cadPorSolides.get(a.pessoaId);
    const lan = lancPorSolides.get(a.pessoaId);
    const c = casarNome(a.nome, ativosDaEmpresa);
    pessoas.push({
      colaboradorId: `avulso:${a.pessoaId}`,
      solidesId: a.pessoaId,
      nome: a.nome,
      ativo: !a.desligamento,
      setor: a.setor,
      centroCusto: a.centroCustoId ? rotuloCentroPor.get(a.centroCustoId) ?? null : null,
      centroId: a.centroCustoId,
      centroOrigem: a.centroCustoId ? "excecao" : null,
      avulso: a,
      unificarCom: c.tipo === "exato" || c.tipo === "parcial" ? { solidesId: c.solidesId, nome: c.nomeSolides } : null,
      tipoContrato: a.tipoContrato,
      salario: a.salario,
      nascimento: a.nascimento,
      admissao: a.admissao,
      desligamento: a.desligamento,
      desligamentoEstimado: false,
      dependentesSolides: [],
      temCadastro: Boolean(cad),
      temLancamento: Boolean(lan),
      cadastro: cad ? toCadastro(cad) : { ...CADASTRO_VAZIO, planoDependentes: [] },
      lancamento: lan ? toLancamento(lan) : { ...LANCAMENTO_PADRAO, ajustes: {} },
      observacaoMes: (lan?.observacao as string | null) ?? null,
    });
  }
  pessoas.sort((x, y) => x.nome.localeCompare(y.nome, "pt-BR"));

  // Fechada: os números são o RETRATO gravado — mudar parâmetro ou cadastro depois não mexe nela.
  if (fechRes.data) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const res = fechRes.data.resultado as any;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const u = (Array.isArray((fechRes.data as any).users) ? (fechRes.data as any).users[0] : (fechRes.data as any).users) as
      | { name: string | null; email: string }
      | null;
    return {
      companyId,
      competencia,
      vigencia: res?.vigencia ?? null,
      parametros: res?.parametros ? lerParametros(res.parametros) : parametrosDaCompetencia(vigencias, competencia).parametros,
      fechamento: { fechadoEm: fechRes.data.fechado_em as string, fechadoPor: u?.name ?? u?.email ?? null, vigencia: res?.vigencia ?? null },
      pessoas,
      linhas: Array.isArray(res?.linhas) ? res.linhas : [],
      rescisoes: Array.isArray(res?.rescisoes) ? res.rescisoes : rescisoes,
      centros,
      rescisoesSugeridas: rescisoesSugeridas(pessoas, Array.isArray(res?.rescisoes) ? res.rescisoes : rescisoes, competencia),
    };
  }

  const { vigencia, parametros } = parametrosDaCompetencia(vigencias, competencia);
  const linhas = pessoas.map((p) => calcularFolhaPessoa(entradaDe(p, companyId), parametros, competencia));
  return {
    companyId,
    competencia,
    vigencia,
    parametros,
    fechamento: null,
    pessoas,
    linhas,
    rescisoes,
    centros,
    rescisoesSugeridas: rescisoesSugeridas(pessoas, rescisoes, competencia),
  };
}

export function entradaDe(p: DpFolhaPessoa, companyId: string): DpFolhaEntrada {
  return {
    solidesId: p.solidesId,
    nome: p.nome,
    setor: p.cadastro.setorFolha ?? p.setor,
    centroCusto: p.centroCusto,
    empresaId: companyId,
    contrato: grupoContratoFolha(p.tipoContrato),
    salario: p.salario,
    nascimento: p.nascimento,
    admissao: p.admissao,
    desligamento: p.desligamento,
    desligamentoEstimado: p.desligamentoEstimado,
    cadastro: p.cadastro,
    lancamento: p.lancamento,
  };
}

/**
 * A empresa de uma PESSOA da folha — para conferir escopo nas actions. Id
 * negativo = avulso (empresa gravada nele); positivo = de-para da Sólides.
 */
export async function empresaDoSolidesId(db: AdminClient, solidesId: number): Promise<string | null> {
  if (solidesId < 0) {
    const { data, error } = await db.from("dp_folha_avulsos").select("company_id, unificado_com").eq("pessoa_id", solidesId).maybeSingle();
    check(error, "dp_folha_avulsos");
    // Unificado: a pessoa agora é a da Sólides; o id antigo não recebe mais escrita.
    return data && data.unificado_com === null ? (data.company_id as string) : null;
  }
  const [{ data, error }, regras] = await Promise.all([
    db.from("dp_colaboradores").select("unidade_id, departamento_id").eq("solides_id", solidesId).maybeSingle(),
    listDpRegras(db),
  ]);
  if (error) throw new Error(error.message);
  if (!data) return null;
  return resolverEmpresa(
    {
      unidadeId: data.unidade_id === null ? null : Number(data.unidade_id),
      departamentoId: data.departamento_id === null ? null : Number(data.departamento_id),
    },
    indexarRegras(regras),
  ).companyId;
}

export async function folhaFechada(db: AdminClient, companyId: string, competencia: string): Promise<boolean> {
  const { data, error } = await db
    .from("dp_folha_fechamentos")
    .select("company_id")
    .eq("company_id", companyId)
    .eq("competencia", competencia)
    .maybeSingle();
  check(error, "dp_folha_fechamentos");
  return Boolean(data);
}
