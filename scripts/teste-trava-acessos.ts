/**
 * Teste da TRAVA de acesso por empresa no Financeiro, contra o banco de
 * produção, do jeito que um usuário logado o enxerga.
 *
 *   npm run teste:trava
 *
 * Por que existe: a varredura de 26/10/2026 achou 8 pessoas que liam TODAS as
 * empresas direto pelo banco (is_hero_manager). Telas e testes unitários não
 * pegam isso — o furo estava no RLS. Este script entra no banco COMO USUÁRIO
 * (anon key + login, a mesma porta do navegador) e tenta ler e alterar dados de
 * empresas que não são dele.
 *
 * Como, sem pedir nada a ninguém:
 *   1. Cria um usuário TEMPORÁRIO (e-mail @example.com, senha aleatória
 *      descartada) e dá a ele acesso pela MESMA rotina da tela de Usuários
 *      (planoValidado + gravarAcessos).
 *   2. Loga com ele e confere, em cada cenário, que só vê o que a tela deu.
 *   3. Apaga o usuário no fim — inclusive se algo falhar no meio.
 * Escritas de teste são NO-OP (gravam o mesmo valor que já está lá): se a
 * trava estiver furada, o teste acusa sem alterar dado nenhum.
 *
 * Também confere, sem logar como ninguém, invariantes dos cadastros reais
 * (ninguém com o papel gestor_hero, nenhum users.company_id, nenhuma empresa
 * do Financeiro sem o módulo).
 *
 * Sai com código 1 se qualquer verificação falhar.
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";

import { computeModuleAccess } from "@/lib/auth/module-access";
import { FORM_VAZIO, type AcessosForm } from "@/lib/usuarios/acessos";
import { gravarAcessos, planoValidado } from "@/lib/usuarios/gravar-acessos";

function env(): (k: string) => string {
  const txt = readFileSync(".env.local", "utf8");
  return (k) => (txt.match(new RegExp(`^${k}=(.*)$`, "m"))?.[1] ?? "").trim();
}
const get = env();
const URL_ = get("NEXT_PUBLIC_SUPABASE_URL");
const ANON = get("NEXT_PUBLIC_SUPABASE_ANON_KEY");
const admin = createClient(URL_, get("SUPABASE_SERVICE_ROLE_KEY"), { auth: { persistSession: false } });

const EMAIL_TESTE = "teste.trava.acessos@example.com";

// Tabelas com dado financeiro por empresa. Tabela que não existe (migration
// não aplicada) é pulada e avisada, não reprovada.
const TABELAS = [
  "financial_entries",
  "dre_monthly_aggregates",
  "cash_flow_monthly_aggregates",
  "budget_entries",
  "manual_entries",
  "manual_account_values",
  "company_partners",
  "company_documents",
  "company_fee_vvr",
  "company_feat_projetos",
  "company_departments",
  "company_excluded_projects",
  "cash_flow_opening_balances",
  "cash_flow_category_mappings",
  "category_mapping",
  "project_mapping",
  "omie_categories",
  "sync_log",
  "case_shows_custody_competencia",
  "user_company_access",
];

let falhas = 0;
let avisos = 0;
function ok(cond: boolean, msg: string, detalhe = "") {
  if (cond) console.log(`  ✔ ${msg}`);
  else {
    falhas++;
    console.log(`  ✘ ${msg}${detalhe ? ` — ${detalhe}` : ""}`);
  }
}
function aviso(msg: string) {
  avisos++;
  console.log(`  ! ${msg}`);
}
const tabelaFalta = (code?: string) => code === "42P01" || code === "PGRST205" || code === "42703";

// ── Invariantes dos cadastros reais ───────────────────────────────────────────

async function lerTudo(t: string, cols: string, ordem: string[]) {
  const out: Array<Record<string, unknown>> = [];
  for (let de = 0; ; de += 1000) {
    let q = admin.from(t).select(cols).range(de, de + 999);
    for (const o of ordem) q = q.order(o);
    const { data, error } = await q;
    if (error) throw new Error(`${t}: ${error.message}`);
    out.push(...((data ?? []) as unknown as Array<Record<string, unknown>>));
    if (!data || data.length < 1000) break;
  }
  return out;
}

async function invariantes() {
  console.log("\n[1] Cadastros reais");
  const users = await lerTudo("users", "*", ["id"]);
  const uca = await lerTudo("user_company_access", "user_id, company_id", ["user_id", "company_id"]);
  const umr = await lerTudo("user_module_roles", "user_id, module, role", ["user_id", "module", "role"]);
  const ucaPor = new Map<string, number>();
  for (const r of uca) ucaPor.set(r.user_id as string, (ucaPor.get(r.user_id as string) ?? 0) + 1);
  const umrPor = new Map<string, Array<{ module: string; role: string }>>();
  for (const r of umr) {
    const l = umrPor.get(r.user_id as string) ?? [];
    l.push({ module: r.module as string, role: r.role as string });
    umrPor.set(r.user_id as string, l);
  }
  const reais = users.filter((u) => u.email !== EMAIL_TESTE);

  const hero = reais.filter((u) => u.role === "gestor_hero");
  ok(hero.length === 0, "ninguém com users.role = gestor_hero (abria todas as empresas)", hero.map((u) => u.email).join(", "));

  const legado = reais.filter((u) => u.company_id);
  ok(legado.length === 0, "ninguém com users.company_id (empresa por fora da tela)", legado.map((u) => u.email).join(", "));

  const semModulo = reais.filter((u) => {
    if (!ucaPor.get(u.id as string)) return false;
    const acc = computeModuleAccess({
      email: u.email as string,
      profile: u.profile as never,
      legacyRole: u.role as string,
      contractsOnly: Boolean(u.contracts_only),
      canFinanceiro: Boolean(u.can_financeiro),
      canCompras: Boolean(u.can_compras),
      canCase: Boolean(u.can_case),
      canViagens: Boolean(u.can_viagens),
      canViagensAprovar: Boolean(u.can_viagens_aprovar),
      moduleRoles: umrPor.get(u.id as string) ?? [],
    });
    return !acc.isAdmin && !acc.canFinanceiro;
  });
  ok(
    semModulo.length === 0,
    "ninguém com empresa no Financeiro sem ter o módulo (o RLS leria mesmo assim)",
    semModulo.map((u) => u.email).join(", "),
  );

  const admins = reais.filter((u) => u.active && (u.role === "admin" || u.profile === "admin"));
  console.log(`  · admins ativos (veem todas as empresas): ${admins.map((u) => u.email).join(", ")}`);
}

// ── Usuário temporário ────────────────────────────────────────────────────────

async function apagarTemporario() {
  const { data } = await admin.from("users").select("id").eq("email", EMAIL_TESTE);
  for (const u of data ?? []) await admin.auth.admin.deleteUser(u.id as string);
}

async function criarTemporario(): Promise<{ id: string; senha: string }> {
  await apagarTemporario();
  const senha = randomBytes(24).toString("base64url");
  const { data, error } = await admin.auth.admin.createUser({
    email: EMAIL_TESTE,
    password: senha,
    email_confirm: true,
    user_metadata: { name: "Teste automático da trava (apagar)" },
  });
  if (error || !data.user) throw new Error(`criar usuário de teste: ${error?.message}`);
  return { id: data.user.id, senha };
}

/** Dá acesso pela rotina da tela de Usuários e ajusta o que o cenário pede. */
async function configurar(
  id: string,
  form: AcessosForm,
  extra: { active?: boolean; role?: string; profile?: string } = {},
) {
  const r = await planoValidado(admin as never, form, EMAIL_TESTE);
  if ("error" in r) throw new Error(`plano: ${r.error}`);
  const g = await gravarAcessos(admin as never, id, r.plano, id);
  if (g.error) throw new Error(`gravar: ${g.error}`);
  const { error } = await admin
    .from("users")
    .update({ active: extra.active ?? true, ...(extra.role ? { role: extra.role } : {}), ...(extra.profile ? { profile: extra.profile } : {}) })
    .eq("id", id);
  if (error) throw new Error(`users: ${error.message}`);
}

async function logar(senha: string): Promise<SupabaseClient> {
  const c = createClient(URL_, ANON, { auth: { persistSession: false, autoRefreshToken: false } });
  const { error } = await c.auth.signInWithPassword({ email: EMAIL_TESTE, password: senha });
  if (error) throw new Error(`login: ${error.message}`);
  return c;
}

// ── O que o usuário logado consegue ───────────────────────────────────────────

async function conferir(c: SupabaseClient, empresas: string[], outra: { id: string; nome: string }, amostraOutra: string | null) {
  const minhas = new Set(empresas);

  const { data: comps } = await c.from("companies").select("id");
  const vistas = (comps ?? []).map((x) => x.id as string);
  ok(
    vistas.every((id) => minhas.has(id)),
    `lista de empresas: vê ${vistas.length} (permitidas: ${empresas.length})`,
    `vê ${vistas.filter((id) => !minhas.has(id)).length} fora da lista`,
  );

  const { data: acc } = await c.rpc("accessible_company_ids");
  const accIds = ((acc ?? []) as unknown[]).map((x) => (typeof x === "string" ? x : Object.values(x as object)[0] as string));
  ok(accIds.every((id) => minhas.has(id)), `accessible_company_ids(): ${accIds.length} empresa(s), todas permitidas`);

  const { data: temOutra } = await c.rpc("user_has_company_access", { target_company_id: outra.id });
  ok(temOutra !== true, `user_has_company_access(${outra.nome}) = false`);

  const { data: semMap } = await c.rpc("count_unmapped_categories");
  ok(!semMap, "count_unmapped_categories() não conta empresas alheias (0)");

  for (const t of TABELAS) {
    // company_id NULL = configuração global (ex.: mapeamentos de categoria do
    // segmento), não dado de empresa.
    let q = c.from(t).select("company_id").not("company_id", "is", null).limit(1);
    q = empresas.length > 0 ? q.not("company_id", "in", `(${empresas.join(",")})`) : q;
    const { data, error } = await q;
    if (error) {
      if (tabelaFalta(error.code)) aviso(`${t}: não existe ou sem company_id — pulada`);
      else ok(false, `${t}: leitura`, `${error.code} ${error.message}`);
      continue;
    }
    ok((data ?? []).length === 0, `${t}: nenhuma linha de outra empresa`);
  }

  const hoje = new Date();
  const de = `${hoje.getFullYear() - 1}-01-01`;
  const ate = hoje.toISOString().slice(0, 10);
  const { data: dre, error: dreErr } = await c.rpc("dashboard_dre_aggregate", {
    p_company_ids: [outra.id],
    p_date_from: de,
    p_date_to: ate,
  });
  if (dreErr) ok(false, "dashboard_dre_aggregate da outra empresa", dreErr.message);
  else {
    const linhas = (dre ?? []) as Array<Record<string, unknown>>;
    // Soma TODO campo numérico da resposta: não depende do nome da coluna.
    const soma = linhas.reduce(
      (s, l) => s + Object.values(l).reduce<number>((t, v) => t + (typeof v === "number" ? Math.abs(v) : 0), 0),
      0,
    );
    ok(soma === 0, `DRE da ${outra.nome} pela RPC: vazia (${linhas.length} linhas, soma ${soma})`);
  }

  // Escrita NO-OP: regrava o mesmo company_id numa linha da outra empresa. Se a
  // trava estiver furada, a linha volta no retorno — e nada mudou de fato.
  if (amostraOutra) {
    const { data: up } = await c
      .from("financial_entries")
      .update({ company_id: outra.id })
      .eq("id", amostraOutra)
      .select("id");
    ok((up ?? []).length === 0, "não consegue alterar lançamento de outra empresa");
  }
}

async function conferirPositivo(c: SupabaseClient, empresa: { id: string; nome: string }) {
  const { count } = await c
    .from("financial_entries")
    .select("id", { count: "exact", head: true })
    .eq("company_id", empresa.id);
  ok((count ?? 0) > 0, `vê os lançamentos da própria empresa (${empresa.nome}: ${count ?? 0})`);
}

// ── Escolha das empresas ──────────────────────────────────────────────────────

async function escolherEmpresas() {
  const { data: comps } = await admin.from("companies").select("id, name").eq("active", true).order("name");
  // Empresa A não pode ser DESTINO de roteamento por departamento: os
  // lançamentos roteados para ela vêm com o company_id da origem, e o teste
  // "nenhuma linha de outra empresa" os acusaria (eles são permitidos).
  const { data: rot } = await admin
    .from("company_departments")
    .select("routed_to_company_id")
    .not("routed_to_company_id", "is", null);
  const destinos = new Set((rot ?? []).map((r) => r.routed_to_company_id as string));
  const comDados: Array<{ id: string; nome: string; amostra: string }> = [];
  for (const c of comps ?? []) {
    const { data } = await admin.from("financial_entries").select("id").eq("company_id", c.id).limit(1);
    if (data?.[0]) comDados.push({ id: c.id as string, nome: c.name as string, amostra: data[0].id as string });
    if (comDados.length >= 6) break;
  }
  const a = comDados.find((c) => !destinos.has(c.id));
  const b = comDados.find((c) => c.id !== a?.id);
  if (!a || !b) throw new Error("não achei duas empresas com lançamentos para o teste");
  return { a, b };
}

// ── Cenários ──────────────────────────────────────────────────────────────────

async function main() {
  await invariantes();

  const { a, b } = await escolherEmpresas();
  console.log(`\nEmpresa permitida: ${a.nome} · empresa alheia: ${b.nome}`);
  const formA: AcessosForm = {
    ...FORM_VAZIO,
    financeiro: { ativo: true, perfil: "visao_financeira", empresas: [a.id] },
  };

  const { id, senha } = await criarTemporario();
  try {
    console.log("\n[2] Visão Financeira só com a empresa permitida");
    await configurar(id, formA);
    let c = await logar(senha);
    await conferirPositivo(c, a);
    await conferir(c, [a.id], b, b.amostra);
    await c.auth.signOut();

    console.log("\n[3] Mesmo acesso, mas com o papel antigo gestor_hero e perfil Diretor (regressão da brecha)");
    await configurar(id, formA, { role: "gestor_hero", profile: "diretor" });
    c = await logar(senha);
    await conferir(c, [a.id], b, b.amostra);
    await c.auth.signOut();

    console.log("\n[4] Sem o Financeiro (só o módulo Case)");
    await configurar(id, { ...FORM_VAZIO, case: true });
    c = await logar(senha);
    await conferir(c, [], b, b.amostra);
    await c.auth.signOut();

    console.log("\n[5] Usuário desativado que ainda tem a empresa gravada");
    await configurar(id, formA, { active: false });
    c = await logar(senha);
    await conferir(c, [], b, b.amostra);
    await c.auth.signOut();
  } finally {
    await apagarTemporario();
    const { data } = await admin.from("users").select("id").eq("email", EMAIL_TESTE);
    ok((data ?? []).length === 0, "usuário temporário apagado");
  }

  console.log(
    `\n${falhas === 0 ? "TRAVA OK" : `TRAVA COM FALHA: ${falhas} verificação(ões)`}${avisos ? ` · ${avisos} aviso(s)` : ""}`,
  );
  process.exit(falhas === 0 ? 0 : 1);
}

main().catch(async (e) => {
  console.error("\nERRO:", e instanceof Error ? e.message : e);
  await apagarTemporario().catch(() => {});
  process.exit(1);
});
