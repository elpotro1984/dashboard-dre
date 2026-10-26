/**
 * RETRATO das permissões efetivas de TODOS os usuários — SOMENTE LEITURA.
 *
 *   npx tsx scripts/usuarios-retrato-permissoes.ts [arquivo-saida.json]
 *   npx tsx scripts/usuarios-retrato-permissoes.ts --comparar <antes.json> <depois.json>
 *
 * Base de comparação da reorganização "módulo → perfil" da tela de Usuários
 * (docs/superpowers/specs/2026-10-26-usuarios-modulo-perfil.md). Cada passo da
 * migração é conferido rodando o retrato de novo e comparando: a diferença tem
 * de ser ZERO, ou só as mudanças decididas pelo dono do projeto.
 *
 * O acesso por módulo sai de `computeModuleAccess` — a MESMA função que a
 * sessão usa (src/lib/auth/session.ts) —, e as rotas de canAccessPathByProfile.
 * Não há espelho à mão: se a regra da sessão mudar, o retrato muda junto.
 *
 * NÃO escreve nada no banco. O arquivo de saída contém e-mails e permissões:
 * o padrão é gravá-lo FORA do repositório (../_retratos/), para não ir a commit.
 */
import { createClient } from "@supabase/supabase-js";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

import { canAccessPathByProfile } from "@/lib/auth/access";
import { dpBloqueado } from "@/lib/auth/dp";
import { computeModuleAccess } from "@/lib/auth/module-access";
import { describeUserExceptions } from "@/lib/auth/user-exceptions";
import { hasCtrlFullView } from "@/lib/ctrl/full-view";
import { isCtrlOrgRole, resolveCtrlRolesForOrg } from "@/lib/ctrl/roles";
import { VIAGENS_ENABLED } from "@/lib/viagens/flags";
import type { DreRole, UserProfileType } from "@/lib/supabase/types";

// Rotas representativas de cada módulo. A pergunta é "o middleware deixa
// entrar?" — o recorte fino (por empresa, setor, papel) vai nos outros campos.
const ROTAS = [
  "/dashboard",
  "/fluxo-de-caixa",
  "/budget-forecast",
  "/comparativos-anuais",
  "/kpis",
  "/conexoes",
  "/financeiro/business-intelligence",
  "/financeiro/documentos",
  "/financeiro/validacao-relatorio",
  "/financeiro/relatorios",
  "/mapeamento",
  "/configuracoes",
  "/s/segmento/dashboard",
  "/s/segmento/kpis",
  "/s/segmento/mapeamento",
  "/ctrl/requisicoes",
  "/ctrl/aprovacoes",
  "/ctrl/contas-a-pagar",
  "/ctrl/orcamento",
  "/ctrl/orcamento/editar",
  "/ctrl/relatorios",
  "/ctrl/admin/fornecedores",
  "/ctrl/configuracoes",
  "/ctrl/manual",
  "/orcamento",
  "/orcamento/configuracoes-gerais",
  "/case",
  "/contratos",
  "/caixa",
  "/dp",
  "/dp/configuracoes/acessos",
  "/vb",
  "/viagens",
  "/usuarios",
  "/admin",
] as const;

const ROTAS_FINANCEIRO = ROTAS.filter(
  (r) =>
    r.startsWith("/dashboard") ||
    r.startsWith("/fluxo") ||
    r.startsWith("/budget") ||
    r.startsWith("/comparativos") ||
    r.startsWith("/kpis") ||
    r.startsWith("/conexoes") ||
    r.startsWith("/financeiro") ||
    r.startsWith("/s/"),
);

type Row = Record<string, unknown>;

interface Retrato {
  id: string;
  email: string;
  name: string | null;
  active: boolean;
  profile: UserProfileType | null;
  legacy_role: string | null;
  flags: Record<string, boolean>;
  modulos: {
    financeiro: DreRole | null;
    compras: string[];
    compras_por_empresa: Record<string, { override: string | null; papeis: string[] }>;
    orcamento: string | null;
    case: boolean;
    contratos: boolean;
    caixa: boolean;
    dp: string | null;
    vb: string | null;
    viagens: { aprovador: boolean } | null;
  };
  empresas: string[];
  setores_compras: string[];
  orcamento_setores: Record<string, string[]>;
  dp_empresas: string[];
  /** Alcance EFETIVO no Orçamento (passo 3). Ausente em retratos anteriores. */
  orcamento_empresas?: string[];
  rotas: Record<string, boolean>;
  regras_especiais: string[];
  /** Perfis por módulo (passo 2). Ausente em retratos anteriores a ele. */
  perfis_modulo?: { financeiro: string | null; compras: string | null };
}

function env(): (k: string) => string {
  const txt = readFileSync(".env.local", "utf8");
  return (k) => (txt.match(new RegExp(`^${k}=(.*)$`, "m"))?.[1] ?? "").trim();
}

const get = env();
const db = createClient(get("NEXT_PUBLIC_SUPABASE_URL"), get("SUPABASE_SERVICE_ROLE_KEY"), {
  auth: { persistSession: false },
});

// PostgREST corta em 1000 linhas (db-max-rows) — paginar sempre, ordenando por
// uma chave estável, senão linha some ou duplica na fronteira da página.
async function lerTudo(tabela: string, colunas: string, ordem: string[]): Promise<Row[]> {
  const out: Row[] = [];
  const passo = 1000;
  for (let de = 0; ; de += passo) {
    let q = db.from(tabela).select(colunas);
    for (const c of ordem) q = q.order(c, { ascending: true });
    const { data, error } = await q.range(de, de + passo - 1);
    if (error) {
      // Tabela que ainda não existe (migration pendente) não derruba o retrato,
      // mas fica DITA — retrato calado sobre uma fonte é retrato errado.
      console.warn(`  ! ${tabela}: ${error.code ?? ""} ${error.message}`);
      return out;
    }
    out.push(...((data ?? []) as unknown as Row[]));
    if (!data || data.length < passo) return out;
  }
}

function agrupar<T>(rows: Row[], chave: string, valor: (r: Row) => T): Map<string, T[]> {
  const m = new Map<string, T[]>();
  for (const r of rows) {
    const k = r[chave] as string;
    const lista = m.get(k) ?? [];
    lista.push(valor(r));
    m.set(k, lista);
  }
  return m;
}

async function tirarRetrato(): Promise<Retrato[]> {
  const [users, umr, sectors, uca, uorgs, orcSet, dpEmp] = await Promise.all([
    lerTudo(
      "users",
      "id, email, name, role, active, contracts_only, profile, can_financeiro, can_compras, can_case, can_viagens, can_viagens_aprovar",
      ["id"],
    ),
    lerTudo("user_module_roles", "user_id, module, role", ["user_id", "module", "role"]),
    lerTudo("user_sectors", "user_id, sector_id", ["user_id", "sector_id"]),
    lerTudo("user_company_access", "user_id, company_id", ["user_id", "company_id"]),
    lerTudo("ctrl_user_orgs", "user_id, org_id, role", ["user_id", "org_id"]),
    lerTudo("orcamento_user_setores", "user_id, company_id, setor_nome", [
      "user_id",
      "company_id",
      "setor_nome",
    ]),
    lerTudo("dp_user_empresas", "user_id, company_id", ["user_id", "company_id"]),
  ]);

  // Empresas do Orçamento (migration 20261026120000). Sem a tabela, o app usa
  // user_company_access — o retrato faz o mesmo, para medir o alcance EFETIVO.
  const sondaOrc = await db.from("orcamento_user_empresas").select("user_id").limit(1);
  const temTabelaOrc = !sondaOrc.error;
  const orcEmp = temTabelaOrc
    ? await lerTudo("orcamento_user_empresas", "user_id, company_id", ["user_id", "company_id"])
    : uca;
  const orcEmpPorUser = agrupar(orcEmp, "user_id", (r) => r.company_id as string);
  console.log(
    temTabelaOrc
      ? "  Orçamento: empresas lidas de orcamento_user_empresas."
      : "  Orçamento: orcamento_user_empresas ausente — usando user_company_access (como o app).",
  );

  const umrPorUser = agrupar(umr, "user_id", (r) => ({
    module: r.module as string,
    role: r.role as string,
  }));
  const setoresPorUser = agrupar(sectors, "user_id", (r) => r.sector_id as string);
  const empresasPorUser = agrupar(uca, "user_id", (r) => r.company_id as string);
  const orgsPorUser = agrupar(uorgs, "user_id", (r) => ({
    org: r.org_id as string,
    role: (r.role as string | null) ?? null,
  }));
  const orcPorUser = agrupar(orcSet, "user_id", (r) => ({
    company: r.company_id as string,
    setor: r.setor_nome as string,
  }));
  const dpPorUser = agrupar(dpEmp, "user_id", (r) => r.company_id as string);

  return users.map((u) => {
    const id = u.id as string;
    const email = (u.email as string) ?? "";
    const profile = (u.profile as UserProfileType | null) ?? null;
    const rows = umrPorUser.get(id) ?? [];

    // A MESMA conta da sessão (getSessionContext → computeModuleAccess).
    const {
      isAdmin: isAdminUser,
      canFinanceiro,
      canCompras,
      canCase,
      canViagens,
      canViagensAprovar,
      canContratos,
      vbRole,
      dpRole,
      canCaixa,
      orcamentoPapel,
      dreRole,
      ctrlRoles,
      financeiroPerfil,
      comprasPerfil,
    } = computeModuleAccess({
      email,
      profile,
      legacyRole: (u.role as string | null) ?? null,
      contractsOnly: Boolean(u.contracts_only),
      canFinanceiro: Boolean(u.can_financeiro),
      canCompras: Boolean(u.can_compras),
      canCase: Boolean(u.can_case),
      canViagens: Boolean(u.can_viagens),
      canViagensAprovar: Boolean(u.can_viagens_aprovar),
      moduleRoles: umrPorUser.has(id) ? rows : null,
    });
    const perfilEfetivo: UserProfileType = profile ?? "solicitante";

    const porEmpresa: Retrato["modulos"]["compras_por_empresa"] = {};
    for (const o of orgsPorUser.get(id) ?? []) {
      const override = isCtrlOrgRole(o.role) ? o.role : null;
      porEmpresa[o.org] = {
        override: o.role,
        papeis: ctrlRoles.length ? resolveCtrlRolesForOrg(profile, ctrlRoles, override) : [],
      };
    }

    const rotas: Record<string, boolean> = {};
    for (const r of ROTAS) {
      rotas[r] = canAccessPathByProfile(
        r,
        perfilEfetivo,
        canFinanceiro,
        canCompras,
        canCase,
        canViagens,
        canContratos,
        email,
        vbRole !== null,
        canCaixa,
        orcamentoPapel !== null,
        dpRole !== null,
        { financeiro: financeiroPerfil, compras: comprasPerfil },
      );
    }

    const orcSetores: Record<string, string[]> = {};
    for (const s of orcPorUser.get(id) ?? []) (orcSetores[s.company] ??= []).push(s.setor);
    for (const k of Object.keys(orcSetores)) orcSetores[k].sort();

    return {
      id,
      email,
      name: (u.name as string | null) ?? null,
      active: Boolean(u.active),
      profile,
      legacy_role: (u.role as string | null) ?? null,
      flags: {
        can_financeiro: canFinanceiro,
        can_compras: canCompras,
        contracts_only: Boolean(u.contracts_only),
        is_admin: isAdminUser,
        dp_bloqueado: dpBloqueado(email),
        ctrl_full_view: hasCtrlFullView(email),
      },
      modulos: {
        financeiro: canFinanceiro ? dreRole : null,
        compras: ctrlRoles,
        compras_por_empresa: porEmpresa,
        orcamento: orcamentoPapel,
        case: canCase,
        contratos: canContratos,
        caixa: canCaixa,
        dp: dpRole,
        vb: vbRole,
        viagens: canViagens ? { aprovador: canViagensAprovar } : null,
      },
      empresas: [...(empresasPorUser.get(id) ?? [])].sort(),
      setores_compras: [...(setoresPorUser.get(id) ?? [])].sort(),
      orcamento_setores: orcSetores,
      dp_empresas: [...(dpPorUser.get(id) ?? [])].sort(),
      orcamento_empresas: orcamentoPapel
        ? orcamentoPapel === "admin"
          ? ["(todas)"]
          : [...(orcEmpPorUser.get(id) ?? [])].sort()
        : [],
      rotas,
      regras_especiais: describeUserExceptions({ id, email }).map((e) => e.key).sort(),
      perfis_modulo: { financeiro: financeiroPerfil, compras: comprasPerfil },
    };
  });
}

// ── Análise: quem cada decisão do desenho afeta ─────────────────────────────

async function analisar(retrato: Retrato[]) {
  const ativos = retrato.filter((r) => r.active);
  const quem = (r: Retrato) => `${r.name ?? "(sem nome)"} <${r.email}> [${r.profile}]`;

  const orgCompanies = await lerTudo("ctrl_org_companies", "org_id, company_id", [
    "org_id",
    "company_id",
  ]);
  const empresasDaOrg = agrupar(orgCompanies, "org_id", (r) => r.company_id as string);

  console.log(`\nUsuários: ${retrato.length} (${ativos.length} ativos)`);
  const porPerfil = new Map<string, number>();
  for (const r of ativos) porPerfil.set(String(r.profile), (porPerfil.get(String(r.profile)) ?? 0) + 1);
  console.log("Perfis (ativos):", Object.fromEntries(porPerfil));

  // Decisão 1 — Financeiro: todo não-admin vira "Visão Financeira".
  console.log("\n[1] Financeiro → Visão Financeira: quem PERDE rota hoje liberada");
  for (const r of ativos) {
    if (!r.flags.can_financeiro || r.flags.is_admin) continue;
    if (r.profile === "franqueado" || r.profile === "csc") continue;
    const perde = ROTAS_FINANCEIRO.filter(
      (rota) =>
        r.rotas[rota] &&
        !canAccessPathByProfile(rota, "franqueado", true, false, false, false, false, r.email),
    );
    console.log(`  - ${quem(r)}: ${perde.length ? perde.join(", ") : "nada"}`);
  }

  // Decisão 2 — Orçamento: papel atual (vira Preenchedor/Preenchedor amplo/Aprovador).
  console.log("\n[2] Orçamento — papel efetivo hoje");
  for (const r of ativos.filter((x) => x.modulos.orcamento && !x.flags.is_admin)) {
    console.log(
      `  - ${quem(r)}: ${r.modulos.orcamento} · empresas ${r.empresas.length} · setores ${Object.keys(r.orcamento_setores).length ? JSON.stringify(r.orcamento_setores) : "nenhum"}`,
    );
  }

  // Decisão 3 — DP: concessões de hoje e admins que PASSAM a ver.
  console.log("\n[3] DP — concessões de hoje");
  for (const r of retrato.filter((x) => x.modulos.dp)) {
    console.log(`  - ${quem(r)}: ${r.modulos.dp} · empresas ${r.dp_empresas.length}${r.active ? "" : " (INATIVO)"}`);
  }
  console.log("    Admins que GANHAM o DP com 'Admin = tudo' (fora o bloqueio nominal):");
  for (const r of ativos.filter((x) => x.flags.is_admin && !x.modulos.dp)) {
    console.log(`  + ${quem(r)}${r.flags.dp_bloqueado ? "  → BLOQUEADO (regra especial), continua sem DP" : ""}`);
  }

  // Decisão 4 — Lista mestre: empresas do Compras/DP fora de user_company_access.
  console.log("\n[4] Lista mestre (user_company_access): acesso de hoje que ficaria FORA dela");
  for (const r of ativos) {
    const mestre = new Set(r.empresas);
    const orgsFora = Object.keys(r.modulos.compras_por_empresa).filter(
      (org) => !(empresasDaOrg.get(org) ?? []).some((c) => mestre.has(c)),
    );
    const dpFora = r.dp_empresas.filter((c) => !mestre.has(c));
    const orcFora = Object.keys(r.orcamento_setores).filter((c) => !mestre.has(c));
    if (r.flags.is_admin || (!orgsFora.length && !dpFora.length && !orcFora.length)) continue;
    console.log(
      `  - ${quem(r)}: compras ${orgsFora.length} empresa(s) · dp ${dpFora.length} · orçamento ${orcFora.length} · financeiro ${r.flags.can_financeiro ? "sim" : "NÃO"}`,
    );
  }

  // Fora da lista do pedido: não podem perder nada.
  // Até a tela nova, o Orçamento tem de alcançar EXATAMENTE as unidades do
  // Financeiro (era o que valia antes do passo 3). Divergência aqui = espelho
  // quebrado (backfill incompleto ou gatilho ausente).
  console.log("\n[4b] Orçamento: alcance = unidades do Financeiro (espelho do passo 3)");
  let divergentes = 0;
  for (const r of retrato) {
    if (!r.modulos.orcamento || r.modulos.orcamento === "admin") continue;
    const a = JSON.stringify(r.orcamento_empresas ?? []);
    const b = JSON.stringify(r.empresas);
    if (a !== b) {
      divergentes++;
      console.log(`  ! ${quem(r)}: orçamento ${a} × financeiro ${b}`);
    }
  }
  console.log(divergentes === 0 ? "  espelho OK" : `  ${divergentes} divergência(s)`);

  console.log("\n[5] Módulos fora da lista do pedido (devem ficar intactos)");
  console.log(`  VB: ${ativos.filter((r) => r.modulos.vb).map(quem).join("; ") || "ninguém"}`);
  console.log(`  Viagens (VIAGENS_ENABLED=${VIAGENS_ENABLED}): ${ativos.filter((r) => r.modulos.viagens && !r.flags.is_admin).length} não-admin`);

  // Perfis "dormentes": perfil do Compras sem o módulo, mas que alimenta o Orçamento.
  console.log("\n[6] Perfil do Compras SEM o módulo Compras (o perfil só serve a outro módulo)");
  for (const r of ativos) {
    if (r.flags.can_compras || r.flags.is_admin) continue;
    if (!["solicitante", "gerente", "gerente_setor", "diretor", "contas_a_pagar"].includes(String(r.profile))) continue;
    const usa = [
      r.flags.can_financeiro && "financeiro",
      r.modulos.orcamento && `orçamento(${r.modulos.orcamento})`,
      r.modulos.case && "case",
      r.modulos.contratos && "contratos",
      r.modulos.caixa && "caixa",
    ].filter(Boolean);
    console.log(`  - ${quem(r)}: ${usa.join(", ") || "nenhum módulo"}`);
  }

  console.log("\n[7] Regras especiais que casaram com usuários");
  for (const r of retrato.filter((x) => x.regras_especiais.length)) {
    console.log(`  - ${quem(r)}: ${r.regras_especiais.join(", ")}`);
  }
}

// ── Comparação de dois retratos ─────────────────────────────────────────────

function comparar(antesPath: string, depoisPath: string) {
  const antes = JSON.parse(readFileSync(antesPath, "utf8")) as { usuarios: Retrato[] };
  const depois = JSON.parse(readFileSync(depoisPath, "utf8")) as { usuarios: Retrato[] };
  const mapa = new Map(depois.usuarios.map((u) => [u.id, u]));
  let diferencas = 0;

  const achatar = (o: unknown, prefixo = "", out: Record<string, string> = {}) => {
    if (o && typeof o === "object" && !Array.isArray(o)) {
      for (const [k, v] of Object.entries(o)) achatar(v, prefixo ? `${prefixo}.${k}` : k, out);
    } else {
      out[prefixo] = JSON.stringify(o);
    }
    return out;
  };

  for (const a of antes.usuarios) {
    const d = mapa.get(a.id);
    if (!d) {
      console.log(`- ${a.email}: sumiu do retrato novo`);
      diferencas++;
      continue;
    }
    mapa.delete(a.id);
    // Perfil e role legado podem mudar de representação; o que importa é o
    // ACESSO EFETIVO, então eles ficam fora da comparação.
    const fa = achatar({ ...a, profile: undefined, legacy_role: undefined, flags: { ...a.flags } });
    const fd = achatar({ ...d, profile: undefined, legacy_role: undefined, flags: { ...d.flags } });
    // Campo que o retrato ANTIGO nem tinha (ex.: perfis_modulo, que nasceu no
    // passo 2) não é diferença de acesso — fica fora quando só existe no novo.
    const camposNovos = new Set(
      Object.keys(d).filter((k) => !(k in (a as unknown as Record<string, unknown>))),
    );
    for (const k of Array.from(new Set(Object.keys(fa).concat(Object.keys(fd))))) {
      if (camposNovos.has(k.split(".")[0])) continue;
      if (fa[k] !== fd[k]) {
        console.log(`~ ${a.email} · ${k}: ${fa[k] ?? "∅"} → ${fd[k] ?? "∅"}`);
        diferencas++;
      }
    }
  }
  for (const d of Array.from(mapa.values())) {
    console.log(`+ ${d.email}: novo no retrato`);
    diferencas++;
  }
  console.log(diferencas === 0 ? "\nDIFERENÇA ZERO." : `\n${diferencas} diferença(s).`);
  process.exit(diferencas === 0 ? 0 : 2);
}

async function main() {
  if (process.argv[2] === "--comparar") {
    const [a, d] = process.argv.slice(3);
    if (!a || !d) throw new Error("Uso: --comparar <antes.json> <depois.json>");
    comparar(a, d);
    return;
  }

  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const saida = resolve(process.argv[2] ?? `../_retratos/usuarios-${stamp}.json`);

  console.log("Lendo produção (somente leitura)…");
  const usuarios = await tirarRetrato();
  mkdirSync(dirname(saida), { recursive: true });
  writeFileSync(
    saida,
    JSON.stringify({ gerado_em: new Date().toISOString(), rotas: ROTAS, usuarios }, null, 2),
  );
  console.log(`Retrato gravado em ${saida}`);

  await analisar(usuarios);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
