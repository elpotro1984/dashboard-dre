// ============================================================================
// Tela de Usuários MÓDULO → PERFIL — regras PURAS (client-safe, testadas).
// Desenho: docs/superpowers/specs/2026-10-26-usuarios-modulo-perfil.md
//
// Três funções carregam a tela inteira:
//   - acessosIniciais: o acesso EFETIVO de hoje (computeModuleAccess) vira o
//     formulário — inclusive o de quem ainda não tem perfil gravado por módulo;
//   - validarAcessos: o que impede salvar;
//   - planoDeGravacao: o formulário vira as gravações (o executor no servidor
//     só obedece — ver gravar-acessos.ts).
//
// Regra de ouro: módulo DESMARCADO limpa o escopo dele (empresas, setores,
// linha de perfil). Escopo de um módulo que a pessoa não tem é cadastro
// invisível, e voltaria a valer sozinho numa reconcessão.
// ============================================================================

import { dpBloqueado, type DpRole } from "@/lib/auth/dp";
import { computeModuleAccess, type ModuleRoleRow } from "@/lib/auth/module-access";
import { isCtrlOrgRole, type CtrlOrgRole } from "@/lib/ctrl/roles";
import type { OrcamentoPapel, UserProfileType } from "@/lib/supabase/types";

export type FinanceiroPerfilTela = "visao_financeira" | "csc";
export type OrcamentoPerfilTela = Exclude<OrcamentoPapel, "admin">;

export interface AcessosForm {
  admin: boolean;
  financeiro: { ativo: boolean; perfil: FinanceiroPerfilTela | null; empresas: string[] };
  orcamento: {
    ativo: boolean;
    perfil: OrcamentoPerfilTela | null;
    empresas: string[];
    /** empresa → NOMES dos setores do orçamento (a atribuição casa por nome). */
    setores: Record<string, string[]>;
  };
  compras: {
    ativo: boolean;
    perfil: CtrlOrgRole | null;
    /** Empresas do Compras (ctrl_orgs). */
    empresas: string[];
    /** Papel diferente do perfil numa empresa (ctrl_user_orgs.role). */
    papelPorEmpresa: Record<string, CtrlOrgRole>;
    setores: string[];
  };
  caixa: boolean;
  case: boolean;
  contratos: boolean;
  dp: { ativo: boolean; perfil: DpRole | null; empresas: string[] };
}

// ── Vocabulário da tela ─────────────────────────────────────────────────────

export interface OpcaoPerfil<T extends string> {
  value: T;
  label: string;
  description: string;
}

export const PERFIS_FINANCEIRO: ReadonlyArray<OpcaoPerfil<FinanceiroPerfilTela>> = [
  {
    value: "visao_financeira",
    label: "Visão Financeira",
    description: "Dashboard, Fluxo de Caixa, Budget e Forecast, KPIs, Business Intelligence e Documentos.",
  },
  {
    value: "csc",
    label: "CSC",
    description: "Tudo da Visão Financeira e mais a tela Validação Relatório.",
  },
];

export const PERFIS_ORCAMENTO: ReadonlyArray<OpcaoPerfil<OrcamentoPerfilTela>> = [
  {
    value: "construtor",
    label: "Preenchedor",
    description: "Vê e preenche só os setores marcados.",
  },
  {
    value: "construtor_amplo",
    label: "Preenchedor amplo",
    description: "Vê a empresa inteira e preenche os setores marcados.",
  },
  {
    value: "validador",
    label: "Aprovador",
    description: "Aprova e reprova o orçamento da empresa inteira; preenche os setores marcados.",
  },
];

export const PERFIS_COMPRAS: ReadonlyArray<OpcaoPerfil<CtrlOrgRole>> = [
  { value: "solicitante", label: "Solicitante", description: "Cria requisições nos setores marcados." },
  {
    value: "gerente_setor",
    label: "Gerente",
    description: "Aprova as requisições dos setores marcados; no orçamento do Compras vê só esses setores.",
  },
  {
    value: "gerente",
    label: "Gerente Sócio",
    description: "Aprova as requisições dos setores marcados; no orçamento do Compras vê todos os setores.",
  },
  {
    value: "diretor",
    label: "Diretor",
    description: "Aprova requisições. Com setores marcados, vê só esses; sem setor, vê todos.",
  },
  {
    value: "contas_a_pagar",
    label: "Contas a Pagar",
    description: "Contas a Pagar, fornecedores e as configurações do Compras.",
  },
];

export const PERFIS_DP: ReadonlyArray<OpcaoPerfil<DpRole>> = [
  {
    value: "analista",
    label: "Visão Operacional",
    description: "Folha, cadastros e telas das empresas marcadas, sem as configurações do grupo.",
  },
  {
    value: "gestor",
    label: "Visão Estratégica",
    description: "Tudo da Visão Operacional e mais as configurações do grupo, nas empresas marcadas.",
  },
];

/** Compras: perfis que exigem setor (sem setor não veriam nada). */
export function comprasExigeSetor(perfil: CtrlOrgRole | null): boolean {
  return perfil === "solicitante" || perfil === "gerente" || perfil === "gerente_setor";
}

export function rotuloPerfil(modulo: "financeiro" | "orcamento" | "compras" | "dp", valor: string | null): string {
  if (!valor) return "";
  const lista: ReadonlyArray<OpcaoPerfil<string>> =
    modulo === "financeiro"
      ? PERFIS_FINANCEIRO
      : modulo === "orcamento"
        ? PERFIS_ORCAMENTO
        : modulo === "compras"
          ? PERFIS_COMPRAS
          : PERFIS_DP;
  return lista.find((p) => p.value === valor)?.label ?? valor;
}

export const FORM_VAZIO: AcessosForm = {
  admin: false,
  financeiro: { ativo: false, perfil: null, empresas: [] },
  orcamento: { ativo: false, perfil: null, empresas: [], setores: {} },
  compras: { ativo: false, perfil: null, empresas: [], papelPorEmpresa: {}, setores: [] },
  caixa: false,
  case: false,
  contratos: false,
  dp: { ativo: false, perfil: null, empresas: [] },
};

// ── Estado de hoje → formulário ─────────────────────────────────────────────

export interface AcessoAtual {
  email: string;
  profile: UserProfileType | null;
  legacyRole: string | null;
  contractsOnly: boolean;
  canFinanceiro: boolean;
  canCompras: boolean;
  canCase: boolean;
  moduleRoles: ModuleRoleRow[];
  /** user_company_access (empresas do Financeiro). */
  empresasFinanceiro: string[];
  /** ctrl_user_orgs. */
  comprasEmpresas: Array<{ orgId: string; role: string | null }>;
  /** user_sectors (Compras). */
  setoresCompras: string[];
  /** orcamento_user_empresas. */
  empresasOrcamento: string[];
  /** orcamento_user_setores, empresa → nomes. */
  setoresOrcamento: Record<string, string[]>;
  /** dp_user_empresas. */
  empresasDp: string[];
}

export interface FormInicial {
  form: AcessosForm;
  /**
   * O que muda só de abrir e salvar — dito ANTES, na própria tela. Hoje: quem
   * tem o Financeiro por um perfil do Compras (acesso amplo) passa a Visão
   * Financeira (decisão de 26/10/2026), e o DP do gestor passa a ser por empresa.
   */
  avisos: string[];
}

export function acessosIniciais(a: AcessoAtual): FormInicial {
  const acesso = computeModuleAccess({
    email: a.email,
    profile: a.profile,
    legacyRole: a.legacyRole,
    contractsOnly: a.contractsOnly,
    canFinanceiro: a.canFinanceiro,
    canCompras: a.canCompras,
    canCase: a.canCase,
    canViagens: false,
    canViagensAprovar: false,
    moduleRoles: a.moduleRoles,
  });
  const avisos: string[] = [];

  if (acesso.isAdmin) {
    // Admin tem tudo: a tela mostra os módulos desabilitados. O escopo
    // guardado não é exibido nem regravado (ver planoDeGravacao).
    return { form: { ...FORM_VAZIO, admin: true }, avisos };
  }

  const financeiroAtivo = acesso.financeiroPerfil !== null && a.canFinanceiro;
  let financeiroPerfil: FinanceiroPerfilTela | null = null;
  if (financeiroAtivo) {
    financeiroPerfil = acesso.financeiroPerfil === "csc" ? "csc" : "visao_financeira";
    if (acesso.financeiroPerfil === "legado") {
      avisos.push(
        "Financeiro: hoje esta pessoa vê também Conexões e as demais telas do Financeiro, pelo perfil do Compras. Ao salvar, passa a Visão Financeira.",
      );
    }
  }

  const comprasAtivo = acesso.ctrlRoles.length > 0 && acesso.comprasPerfil !== null;
  const papelPorEmpresa: Record<string, CtrlOrgRole> = {};
  for (const o of a.comprasEmpresas) {
    if (isCtrlOrgRole(o.role) && o.role !== acesso.comprasPerfil) papelPorEmpresa[o.orgId] = o.role;
  }

  const orcamentoPerfil =
    acesso.orcamentoPapel && acesso.orcamentoPapel !== "admin" ? acesso.orcamentoPapel : null;

  if (acesso.dpRole === "gestor" && a.empresasDp.length === 0) {
    avisos.push(
      "Departamento Pessoal: hoje a Visão Estratégica vê todas as empresas. Agora ela vale só nas empresas marcadas — marque as empresas antes de salvar.",
    );
  }

  return {
    form: {
      admin: false,
      financeiro: {
        ativo: financeiroAtivo,
        perfil: financeiroPerfil,
        empresas: financeiroAtivo ? [...a.empresasFinanceiro] : [],
      },
      orcamento: {
        ativo: orcamentoPerfil !== null,
        perfil: orcamentoPerfil,
        empresas: orcamentoPerfil ? [...a.empresasOrcamento] : [],
        setores: orcamentoPerfil ? clonarMapa(a.setoresOrcamento) : {},
      },
      compras: {
        ativo: comprasAtivo,
        perfil: comprasAtivo ? acesso.comprasPerfil : null,
        empresas: comprasAtivo ? a.comprasEmpresas.map((o) => o.orgId) : [],
        papelPorEmpresa: comprasAtivo ? papelPorEmpresa : {},
        setores: comprasAtivo ? [...a.setoresCompras] : [],
      },
      caixa: acesso.canCaixa,
      case: acesso.canCase,
      contratos: acesso.canContratos,
      dp: {
        ativo: acesso.dpRole !== null,
        perfil: acesso.dpRole,
        empresas: acesso.dpRole ? [...a.empresasDp] : [],
      },
    },
    avisos,
  };
}

function clonarMapa(m: Record<string, string[]>): Record<string, string[]> {
  return Object.fromEntries(Object.entries(m).map(([k, v]) => [k, [...v]]));
}

// ── Validação ───────────────────────────────────────────────────────────────

export function validarAcessos(form: AcessosForm, email: string): string | null {
  if (form.admin) return null;

  const algum =
    form.financeiro.ativo ||
    form.orcamento.ativo ||
    form.compras.ativo ||
    form.caixa ||
    form.case ||
    form.contratos ||
    form.dp.ativo;
  if (!algum) return "Marque o Admin ou pelo menos um módulo.";

  if (form.financeiro.ativo) {
    if (!form.financeiro.perfil) return "Financeiro: escolha o perfil.";
    if (form.financeiro.empresas.length === 0) return "Financeiro: marque pelo menos uma empresa.";
  }
  if (form.orcamento.ativo) {
    if (!form.orcamento.perfil) return "Orçamento: escolha o perfil.";
    if (form.orcamento.empresas.length === 0) return "Orçamento: marque pelo menos uma empresa.";
  }
  if (form.compras.ativo) {
    if (!form.compras.perfil) return "Compras: escolha o perfil.";
    if (form.compras.empresas.length === 0) return "Compras: marque pelo menos uma empresa.";
    if (comprasExigeSetor(form.compras.perfil) && form.compras.setores.length === 0) {
      return "Compras: Solicitante, Gerente e Gerente Sócio precisam de pelo menos um setor.";
    }
  }
  if (form.dp.ativo) {
    if (dpBloqueado(email)) return "Este usuário não pode receber o Departamento Pessoal (regra especial).";
    if (!form.dp.perfil) return "Departamento Pessoal: escolha o perfil.";
    if (form.dp.empresas.length === 0) return "Departamento Pessoal: marque pelo menos uma empresa.";
  }
  return null;
}

// ── Formulário → gravações ──────────────────────────────────────────────────

export interface PlanoDeGravacao {
  users: {
    profile: UserProfileType;
    /** Coluna legada `users.role` — é a que is_admin()/is_hero_manager() leem. */
    role: "admin" | "gestor_hero" | "gestor_unidade";
    contracts_only: boolean;
    can_financeiro: boolean;
    can_compras: boolean;
    can_case: boolean;
  };
  /**
   * Escopo por módulo. `null` = NÃO MEXER (admin: herda tudo, e o que estiver
   * guardado — empresas do Compras para a API externa, linha "ver como" do
   * Orçamento, concessões — fica como está).
   */
  escopo: null | {
    linhas: {
      financeiro: FinanceiroPerfilTela | null;
      compras: CtrlOrgRole | null;
      orcamento: OrcamentoPerfilTela | null;
      caixa: boolean;
      contratos: boolean;
      dp: DpRole | null;
    };
    empresasFinanceiro: string[];
    comprasEmpresas: Array<{ org_id: string; role: CtrlOrgRole | null }>;
    setoresCompras: string[];
    empresasOrcamento: string[];
    setoresOrcamento: Record<string, string[]>;
    empresasDp: string[];
  };
}

/**
 * `users.profile` de COMPATIBILIDADE. Vários leitores do banco e dos e-mails
 * ainda olham só ele (get_ctrl_role, notificações, lembrete diário,
 * can_validate_bi_reports) — §3.2 do desenho. O perfil de cada módulo mora
 * nas linhas de user_module_roles; este campo só mantém os leitores antigos
 * coerentes até a fase 3.
 */
export function perfilDeCompatibilidade(form: AcessosForm): UserProfileType {
  if (form.admin) return "admin";
  if (form.compras.ativo && form.compras.perfil) return form.compras.perfil;
  if (form.financeiro.ativo) return form.financeiro.perfil === "csc" ? "csc" : "franqueado";
  // Só Validação de Contratos: o perfil-ilha é exatamente esse acesso, e é o que
  // a função de banco is_contracts_only_user() reconhece.
  const soContratos =
    form.contratos && !form.orcamento.ativo && !form.caixa && !form.case && !form.dp.ativo;
  if (soContratos) return "validador_contrato";
  // Sem Compras e sem Financeiro: o perfil menos privilegiado. can_compras fica
  // false, então ele não dá papel nenhum no Compras.
  return "solicitante";
}

/**
 * users.role é o que is_admin() lê no banco. Nunca mais 'gestor_hero': ele
 * liberava TODAS as empresas no RLS por fora da tela (desligado em 26/10/2026,
 * migration 20261026140000_fim_gestor_hero_rls).
 */
export function papelLegado(profile: UserProfileType): "admin" | "gestor_unidade" {
  return profile === "admin" ? "admin" : "gestor_unidade";
}

export function planoDeGravacao(
  form: AcessosForm,
  /** setor do Compras → empresa do Compras, para descartar setor de empresa não marcada. */
  orgDoSetor: Record<string, string | null>,
): PlanoDeGravacao {
  const profile = perfilDeCompatibilidade(form);
  const users = {
    profile,
    role: papelLegado(profile),
    contracts_only: profile === "validador_contrato",
    can_financeiro: form.admin || form.financeiro.ativo,
    can_compras: form.admin || form.compras.ativo,
    can_case: form.admin || form.case,
  };
  if (form.admin) return { users, escopo: null };

  const fin = form.financeiro.ativo ? form.financeiro : null;
  const orc = form.orcamento.ativo ? form.orcamento : null;
  const comp = form.compras.ativo ? form.compras : null;
  const dp = form.dp.ativo ? form.dp : null;

  const orgsCompras = unicos(comp?.empresas ?? []);
  const empresasOrc = unicos(orc?.empresas ?? []);

  return {
    users,
    escopo: {
      linhas: {
        financeiro: fin?.perfil ?? null,
        compras: comp?.perfil ?? null,
        orcamento: orc?.perfil ?? null,
        caixa: form.caixa,
        contratos: form.contratos,
        dp: dp?.perfil ?? null,
      },
      empresasFinanceiro: unicos(fin?.empresas ?? []),
      comprasEmpresas: orgsCompras.map((org_id) => {
        const papel = comp?.papelPorEmpresa[org_id] ?? null;
        // Igual ao perfil = sem override (NULL), como a tela antiga gravava.
        return { org_id, role: papel && papel !== comp?.perfil ? papel : null };
      }),
      // Setor de empresa não marcada sairia como acesso a um setor que a
      // pessoa nem abre.
      setoresCompras: unicos(comp?.setores ?? []).filter((s) => {
        const org = orgDoSetor[s];
        return org != null && orgsCompras.includes(org);
      }),
      empresasOrcamento: empresasOrc,
      setoresOrcamento: Object.fromEntries(
        Object.entries(orc?.setores ?? {})
          .filter(([empresa, nomes]) => empresasOrc.includes(empresa) && nomes.length > 0)
          .map(([empresa, nomes]) => [empresa, unicos(nomes)]),
      ),
      empresasDp: unicos(dp?.empresas ?? []),
    },
  };
}

function unicos(lista: string[]): string[] {
  return Array.from(new Set(lista));
}
