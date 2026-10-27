import assert from "node:assert/strict";
import { test } from "node:test";

import { computeModuleAccess } from "@/lib/auth/module-access";
import {
  acessosIniciais,
  FORM_VAZIO,
  perfilDeCompatibilidade,
  planoDeGravacao,
  validarAcessos,
  type AcessoAtual,
  type AcessosForm,
} from "@/lib/usuarios/acessos";

const base: AcessoAtual = {
  email: "pessoa@exemplo.com",
  profile: "solicitante",
  legacyRole: "gestor_unidade",
  contractsOnly: false,
  canFinanceiro: false,
  canCompras: false,
  canCase: false,
  moduleRoles: [],
  empresasFinanceiro: [],
  comprasEmpresas: [],
  setoresCompras: [],
  empresasOrcamento: [],
  setoresOrcamento: {},
  empresasDp: [],
};

const ORG_DO_SETOR = { s1: "viva", s2: "viva", s3: "feat" };

/** Acesso efetivo depois de gravar o plano (como o Lucas, que concede o DP) — o mesmo cálculo da sessão. */
function depoisDeSalvar(form: AcessosForm, email = base.email) {
  const plano = planoDeGravacao(form, ORG_DO_SETOR, { gravarDp: true });
  const e = plano.escopo;
  const rows = [
    ...(e
      ? [
          e.linhas.financeiro && { module: "financeiro", role: e.linhas.financeiro },
          e.linhas.compras && { module: "compras", role: e.linhas.compras },
          e.linhas.orcamento && { module: "orcamento", role: e.linhas.orcamento },
          e.linhas.caixa && { module: "caixa", role: "user" },
          e.linhas.contratos && { module: "contratos", role: "validador" },
        ]
      : []),
    plano.dp?.papel && { module: "dp", role: plano.dp.papel },
  ].filter(Boolean);
  return {
    plano,
    acesso: computeModuleAccess({
      email,
      profile: plano.users.profile,
      legacyRole: plano.users.role,
      contractsOnly: plano.users.contracts_only,
      canFinanceiro: plano.users.can_financeiro,
      canCompras: plano.users.can_compras,
      canCase: plano.users.can_case,
      canViagens: false,
      canViagensAprovar: false,
      moduleRoles: rows as Array<{ module: string; role: string }>,
    }),
  };
}

function hoje(a: AcessoAtual) {
  return computeModuleAccess({
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
}

// ── Abrir e salvar sem mexer ────────────────────────────────────────────────

const CASOS: Array<[string, AcessoAtual]> = [
  ["só Compras (solicitante)", {
    ...base, canCompras: true, comprasEmpresas: [{ orgId: "viva", role: null }], setoresCompras: ["s1"],
  }],
  ["Gerente (de setor) com papel diferente numa empresa", {
    ...base, profile: "gerente_setor", canCompras: true,
    comprasEmpresas: [{ orgId: "viva", role: null }, { orgId: "feat", role: "solicitante" }],
    setoresCompras: ["s1", "s3"],
  }],
  ["Visão Financeira", { ...base, profile: "franqueado", canFinanceiro: true, empresasFinanceiro: ["c1", "c2"] }],
  ["CSC + Caixa + Contratos", {
    ...base, profile: "csc", canFinanceiro: true, empresasFinanceiro: ["c1"],
    moduleRoles: [{ module: "caixa", role: "user" }, { module: "contratos", role: "validador" }],
  }],
  ["Validador de contrato (ilha)", { ...base, profile: "validador_contrato", contractsOnly: true }],
  ["Diretor + Orçamento", {
    ...base, profile: "diretor", legacyRole: "gestor_hero", canCompras: true,
    comprasEmpresas: [{ orgId: "viva", role: null }],
    moduleRoles: [{ module: "orcamento", role: "auto" }],
    empresasOrcamento: ["c1"], setoresOrcamento: { c1: ["Financeiro"] },
  }],
  ["Gerente Sócio só no Orçamento (sem Compras)", {
    ...base, profile: "gerente", moduleRoles: [{ module: "orcamento", role: "auto" }], empresasOrcamento: ["c1"],
  }],
  ["Analista do DP", {
    ...base, profile: "franqueado", canFinanceiro: true, empresasFinanceiro: ["c1"],
    moduleRoles: [{ module: "dp", role: "analista" }], empresasDp: ["c1"],
  }],
];

for (const [nome, atual] of CASOS) {
  test(`abrir e salvar sem mexer não muda o acesso: ${nome}`, () => {
    const { form, avisos } = acessosIniciais(atual, { verDp: true });
    assert.equal(validarAcessos(form, { verDp: true }), null, "o formulário inicial tem de ser salvável");
    assert.deepEqual(avisos, [], "sem aviso: nada muda");
    const { acesso } = depoisDeSalvar(form, atual.email);
    const antes = hoje(atual);
    for (const k of ["ctrlRoles", "orcamentoPapel", "canCaixa", "canCase", "canContratos", "dpRole", "canFinanceiro", "canCompras", "isAdmin"] as const) {
      assert.deepEqual(acesso[k], antes[k], `${nome}: ${k}`);
    }
    // O perfil de cada módulo também é o mesmo (agora gravado em vez de derivado).
    assert.equal(acesso.financeiroPerfil, antes.financeiroPerfil, `${nome}: financeiroPerfil`);
    // Perfil do Compras só significa algo com o módulo (sem ele, ctrlRoles é
    // vazio e o valor derivado do users.profile não alcança tela nenhuma).
    if (antes.ctrlRoles.length > 0) {
      assert.equal(acesso.comprasPerfil, antes.comprasPerfil, `${nome}: comprasPerfil`);
    }
  });
}

test("Financeiro pelo perfil do Compras (legado) vira Visão Financeira — e a tela avisa", () => {
  const atual: AcessoAtual = {
    ...base, profile: "diretor", legacyRole: "gestor_hero", canFinanceiro: true, canCompras: true,
    empresasFinanceiro: ["c1"], comprasEmpresas: [{ orgId: "viva", role: null }],
  };
  assert.equal(hoje(atual).financeiroPerfil, "legado");
  const { form, avisos } = acessosIniciais(atual, { verDp: true });
  assert.equal(form.financeiro.perfil, "visao_financeira");
  assert.equal(avisos.length, 1);
  const { acesso, plano } = depoisDeSalvar(form);
  assert.equal(acesso.financeiroPerfil, "visao_financeira");
  assert.deepEqual(acesso.ctrlRoles, ["diretor"], "o Compras não muda");
  assert.equal(plano.users.profile, "diretor");
});

test("Visão Estratégica do DP sem empresa: avisa e não deixa salvar sem marcar", () => {
  const atual: AcessoAtual = { ...base, profile: "franqueado", canFinanceiro: true, empresasFinanceiro: ["c1"], moduleRoles: [{ module: "dp", role: "gestor" }] };
  const { form, avisos } = acessosIniciais(atual, { verDp: true });
  assert.equal(avisos.length, 1);
  assert.match(validarAcessos(form, { verDp: true }) ?? "", /Departamento Pessoal/);
});

// ── Admin ───────────────────────────────────────────────────────────────────

test("admin: o formulário marca Admin, o plano não mexe no escopo — e o DP NÃO vem junto", () => {
  const { form } = acessosIniciais({ ...base, profile: "admin", legacyRole: "admin" }, { verDp: true });
  assert.equal(form.admin, true);
  assert.equal(form.compras.ativo, false);
  assert.equal(form.dp.ativo, false, "admin não herda o DP");
  const plano = planoDeGravacao(form, ORG_DO_SETOR, { gravarDp: true });
  assert.equal(plano.escopo, null);
  assert.deepEqual(plano.dp, { papel: null, empresas: [] });
  assert.equal(plano.users.profile, "admin");
  assert.equal(plano.users.role, "admin");
});

const adminDp: AcessoAtual = { ...base, profile: "admin", legacyRole: "admin", moduleRoles: [{ module: "dp", role: "gestor" }] };

test("admin COM o DP e sem empresa marcada: 'Todas as empresas' (o Lucas e o Marcelo), regravado como está", () => {
  const { form } = acessosIniciais({ ...adminDp, empresasDp: [] }, { verDp: true });
  assert.deepEqual(form.dp, { ativo: true, perfil: "gestor", empresas: [], todasEmpresas: true });
  assert.equal(validarAcessos(form, { verDp: true }), null);
  assert.deepEqual(planoDeGravacao(form, ORG_DO_SETOR, { gravarDp: true }).dp, { papel: "gestor", empresas: [] });
});

test("admin COM o DP e empresas marcadas: fica recortado nelas, como qualquer pessoa", () => {
  const { form } = acessosIniciais({ ...adminDp, empresasDp: ["c1", "c2"] }, { verDp: true });
  assert.deepEqual(form.dp, { ativo: true, perfil: "gestor", empresas: ["c1", "c2"], todasEmpresas: false });
  assert.deepEqual(planoDeGravacao(form, ORG_DO_SETOR, { gravarDp: true }).dp, { papel: "gestor", empresas: ["c1", "c2"] });
});

test("conceder o DP a uma admin (a Carol): começa SEM 'todas' — o Lucas escolhe as empresas", () => {
  const { form } = acessosIniciais({ ...base, profile: "admin", legacyRole: "admin" }, { verDp: true });
  assert.equal(form.dp.todasEmpresas, false);
  const concedido: AcessosForm = { ...form, dp: { ...form.dp, ativo: true, perfil: "gestor" } };
  assert.match(validarAcessos(concedido, { verDp: true }) ?? "", /marque as empresas ou “Todas as empresas”/);
  const comEmpresa = { ...concedido, dp: { ...concedido.dp, empresas: ["c1"] } };
  assert.equal(validarAcessos(comEmpresa, { verDp: true }), null);
  assert.deepEqual(planoDeGravacao(comEmpresa, ORG_DO_SETOR, { gravarDp: true }).dp, { papel: "gestor", empresas: ["c1"] });
  // "Todas" vence a lista: guardar as marcadas recortaria quem deveria ver tudo.
  const todas = { ...comEmpresa, dp: { ...comEmpresa.dp, todasEmpresas: true } };
  assert.deepEqual(planoDeGravacao(todas, ORG_DO_SETOR, { gravarDp: true }).dp, { papel: "gestor", empresas: [] });
});

test("'Todas as empresas' só vale para admin: fora dele, lista vazia é nenhuma empresa", () => {
  const form: AcessosForm = { ...FORM_VAZIO, caixa: true, dp: { ativo: true, perfil: "gestor", empresas: [], todasEmpresas: true } };
  assert.match(validarAcessos(form, { verDp: true }) ?? "", /Departamento Pessoal: marque pelo menos uma empresa/);
  const comEmpresa = { ...form, dp: { ...form.dp, empresas: ["c1"] } };
  assert.deepEqual(planoDeGravacao(comEmpresa, ORG_DO_SETOR, { gravarDp: true }).dp, { papel: "gestor", empresas: ["c1"] });
});

test("admin pela coluna legada também é reconhecido", () => {
  assert.equal(acessosIniciais({ ...base, profile: "gerente", legacyRole: "admin" }, { verDp: true }).form.admin, true);
});

// ── DP: só o Lucas vê e grava ───────────────────────────────────────────────

const analistaDp: AcessoAtual = {
  ...base, profile: "franqueado", canFinanceiro: true, empresasFinanceiro: ["c1"],
  moduleRoles: [{ module: "dp", role: "gestor" }], empresasDp: [],
};

test("quem não concede o DP recebe a seção VAZIA — o estado do DP não sai do servidor", () => {
  const { form, avisos } = acessosIniciais(analistaDp, { verDp: false });
  assert.deepEqual(form.dp, { ativo: false, perfil: null, empresas: [], todasEmpresas: false });
  assert.deepEqual(avisos, [], "nem o aviso do DP");
  // Admin também: para quem não é o Lucas, o admin "tem tudo" e o DP não aparece.
  const admin = acessosIniciais({ ...analistaDp, profile: "admin", legacyRole: "admin" }, { verDp: false }).form;
  assert.deepEqual(admin.dp, { ativo: false, perfil: null, empresas: [], todasEmpresas: false });
});

test("sem gravarDp o plano NÃO mexe no DP, diga o formulário o que disser", () => {
  const form: AcessosForm = { ...FORM_VAZIO, caixa: true, dp: { ativo: true, perfil: "gestor", empresas: ["c1"], todasEmpresas: false } };
  assert.equal(planoDeGravacao(form, ORG_DO_SETOR, { gravarDp: false }).dp, null);
  // A validação de quem não vê o DP também ignora a seção.
  assert.equal(
    validarAcessos({ ...FORM_VAZIO, caixa: true, dp: { ativo: true, perfil: null, empresas: [], todasEmpresas: false } }, { verDp: false }),
    null,
  );
});

test("quem não vê o DP não é barrado por 'marque um módulo' na edição — a recusa contaria que a pessoa tem o DP", () => {
  assert.equal(validarAcessos(FORM_VAZIO, { verDp: false }), null);
  // No convite não há DP a esconder.
  assert.match(validarAcessos(FORM_VAZIO, { verDp: false, novo: true }) ?? "", /pelo menos um módulo/);
});

test("Contratos + DP escondido NÃO vira o perfil-ilha (que cortaria o DP calado)", () => {
  const form: AcessosForm = { ...FORM_VAZIO, contratos: true };
  assert.equal(planoDeGravacao(form, ORG_DO_SETOR, { gravarDp: false, dpAtualAtivo: true }).users.profile, "solicitante");
  assert.equal(planoDeGravacao(form, ORG_DO_SETOR, { gravarDp: false, dpAtualAtivo: false }).users.profile, "validador_contrato");
});

// ── Validação ───────────────────────────────────────────────────────────────

test("validação: módulo marcado exige perfil e empresa; Compras exige setor nos perfis de setor", () => {
  const lucas = { verDp: true };
  assert.match(validarAcessos(FORM_VAZIO, lucas) ?? "", /pelo menos um módulo/);
  const f = (patch: Partial<AcessosForm>): AcessosForm => ({ ...FORM_VAZIO, ...patch });
  assert.match(validarAcessos(f({ financeiro: { ativo: true, perfil: null, empresas: ["c1"] } }), lucas) ?? "", /perfil/);
  assert.match(validarAcessos(f({ financeiro: { ativo: true, perfil: "csc", empresas: [] } }), lucas) ?? "", /empresa/);
  const compras = { ativo: true, perfil: "solicitante" as const, empresas: ["viva"], papelPorEmpresa: {}, setores: [] };
  assert.match(validarAcessos(f({ compras }), lucas) ?? "", /setor/);
  assert.equal(validarAcessos(f({ compras: { ...compras, perfil: "diretor" } }), lucas), null, "diretor sem setor = todos");
  assert.equal(validarAcessos(f({ caixa: true }), lucas), null);
});

test("validação: o DP exige perfil e empresa (ou, só para admin, 'Todas as empresas') — vale para a admin Carol", () => {
  const lucas = { verDp: true };
  const dp = (patch: Partial<AcessosForm["dp"]>, admin = false): AcessosForm => ({
    ...FORM_VAZIO, admin, dp: { ativo: true, perfil: "analista", empresas: ["c1"], todasEmpresas: false, ...patch },
  });
  assert.equal(validarAcessos(dp({}), lucas), null);
  assert.match(validarAcessos(dp({ perfil: null }), lucas) ?? "", /Departamento Pessoal: escolha o perfil/);
  assert.match(validarAcessos(dp({ empresas: [] }), lucas) ?? "", /Departamento Pessoal: marque/);
  assert.match(validarAcessos(dp({ empresas: [] }, true), lucas) ?? "", /Todas as empresas/, "admin sem empresa e sem 'todas'");
  assert.equal(validarAcessos(dp({ empresas: [], todasEmpresas: true }, true), lucas), null, "admin com 'Todas as empresas'");
  assert.equal(validarAcessos(dp({}, true), lucas), null, "admin com empresa marcada");
  assert.match(validarAcessos(dp({ perfil: null }, true), lucas) ?? "", /escolha o perfil/);
});

// ── Plano ───────────────────────────────────────────────────────────────────

test("módulo desmarcado limpa o escopo dele", () => {
  const form: AcessosForm = {
    ...FORM_VAZIO,
    caixa: true,
    financeiro: { ativo: false, perfil: "csc", empresas: ["c1"] },
    compras: { ativo: false, perfil: "diretor", empresas: ["viva"], papelPorEmpresa: {}, setores: ["s1"] },
    orcamento: { ativo: false, perfil: "validador", empresas: ["c1"], setores: { c1: ["X"] } },
    dp: { ativo: false, perfil: "gestor", empresas: ["c1"], todasEmpresas: false },
  };
  const plano = planoDeGravacao(form, ORG_DO_SETOR, { gravarDp: true });
  const e = plano.escopo!;
  assert.deepEqual(e.empresasFinanceiro, []);
  assert.deepEqual(e.comprasEmpresas, []);
  assert.deepEqual(e.setoresCompras, []);
  assert.deepEqual(e.empresasOrcamento, []);
  assert.deepEqual(e.setoresOrcamento, {});
  assert.deepEqual(e.linhas, { financeiro: null, compras: null, orcamento: null, caixa: true, contratos: false });
  assert.deepEqual(plano.dp, { papel: null, empresas: [] });
});

test("setor de empresa não marcada e setor do orçamento de empresa não marcada saem", () => {
  const form: AcessosForm = {
    ...FORM_VAZIO,
    compras: { ativo: true, perfil: "gerente", empresas: ["viva"], papelPorEmpresa: { viva: "gerente", feat: "diretor" }, setores: ["s1", "s3"] },
    orcamento: { ativo: true, perfil: "construtor", empresas: ["c1"], setores: { c1: ["A"], c2: ["B"] } },
  };
  const e = planoDeGravacao(form, ORG_DO_SETOR, { gravarDp: true }).escopo!;
  assert.deepEqual(e.setoresCompras, ["s1"]);
  assert.deepEqual(e.comprasEmpresas, [{ org_id: "viva", role: null }], "papel igual ao perfil grava NULL");
  assert.deepEqual(e.setoresOrcamento, { c1: ["A"] });
});

test("perfil de compatibilidade", () => {
  const f = (patch: Partial<AcessosForm>): AcessosForm => ({ ...FORM_VAZIO, ...patch });
  const compras = { ativo: true, perfil: "contas_a_pagar" as const, empresas: ["viva"], papelPorEmpresa: {}, setores: [] };
  const financeiro = { ativo: true, perfil: "csc" as const, empresas: ["c1"] };
  assert.equal(perfilDeCompatibilidade(f({ admin: true, compras })), "admin");
  assert.equal(perfilDeCompatibilidade(f({ compras, financeiro })), "contas_a_pagar");
  assert.equal(perfilDeCompatibilidade(f({ financeiro })), "csc");
  assert.equal(perfilDeCompatibilidade(f({ financeiro: { ...financeiro, perfil: "visao_financeira" } })), "franqueado");
  assert.equal(perfilDeCompatibilidade(f({ contratos: true })), "validador_contrato");
  assert.equal(perfilDeCompatibilidade(f({ contratos: true, caixa: true })), "solicitante");
  assert.equal(perfilDeCompatibilidade(f({ orcamento: { ativo: true, perfil: "validador", empresas: ["c1"], setores: {} } })), "solicitante");
});

test("Visão Financeira + Diretor + Case: o Case continua (não fica atrás da whitelist)", () => {
  const form: AcessosForm = {
    ...FORM_VAZIO,
    case: true,
    financeiro: { ativo: true, perfil: "visao_financeira", empresas: ["c1"] },
    compras: { ativo: true, perfil: "diretor", empresas: ["viva"], papelPorEmpresa: {}, setores: [] },
  };
  const { acesso } = depoisDeSalvar(form);
  assert.equal(acesso.canCase, true);
  assert.equal(acesso.financeiroPerfil, "visao_financeira");
  assert.deepEqual(acesso.ctrlRoles, ["diretor"]);
});

test("Orçamento sem Compras: o papel gravado vale (perfil de compatibilidade é solicitante)", () => {
  const form: AcessosForm = {
    ...FORM_VAZIO,
    orcamento: { ativo: true, perfil: "construtor_amplo", empresas: ["c1"], setores: {} },
  };
  const { acesso } = depoisDeSalvar(form);
  assert.equal(acesso.orcamentoPapel, "construtor_amplo");
  assert.deepEqual(acesso.ctrlRoles, []);
});
