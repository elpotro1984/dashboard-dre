import type { SupabaseClient } from "@supabase/supabase-js";

import type { ModuleRoleRow } from "@/lib/auth/module-access";
import type { UserProfileType } from "@/lib/supabase/types";
import type { AcessoAtual } from "@/lib/usuarios/acessos";

// Leitura do estado de acesso de TODOS os usuários, no formato que
// `acessosIniciais` consome. Recebe o client de fora (service role) e não
// importa nada de servidor: a página de Usuários, as rotas e o script da
// migração dos perfis (scripts/usuarios-migrar-perfis.ts) usam a MESMA leitura.

export interface UsuarioCadastro {
  id: string;
  email: string;
  name: string;
  phone: string;
  position: string;
  active: boolean;
  /** Viagens saiu da tela; segue exibido para quem ainda tem. */
  canViagens: boolean;
  canViagensAprovar: boolean;
  vbRole: string | null;
}

export interface AcessosCarregados {
  usuarios: UsuarioCadastro[];
  atual: Map<string, AcessoAtual>;
}

const PASSO = 1000;

// PostgREST corta em 1000 linhas (db-max-rows): pagina, ordenando por chave
// estável, senão linha some ou duplica na fronteira da página.
async function lerTudo(
  db: SupabaseClient,
  tabela: string,
  colunas: string,
  ordem: string[],
  { opcional = false } = {},
): Promise<Array<Record<string, unknown>>> {
  const out: Array<Record<string, unknown>> = [];
  for (let de = 0; ; de += PASSO) {
    let q = db.from(tabela).select(colunas);
    for (const c of ordem) q = q.order(c, { ascending: true });
    const { data, error } = await q.range(de, de + PASSO - 1);
    if (error) {
      if (opcional) return out;
      throw new Error(`${tabela}: ${error.message}`);
    }
    out.push(...((data ?? []) as unknown as Array<Record<string, unknown>>));
    if (!data || data.length < PASSO) return out;
  }
}

function agrupar<T>(rows: Array<Record<string, unknown>>, valor: (r: Record<string, unknown>) => T) {
  const m = new Map<string, T[]>();
  for (const r of rows) {
    const k = r.user_id as string;
    const lista = m.get(k) ?? [];
    lista.push(valor(r));
    m.set(k, lista);
  }
  return m;
}

export async function carregarAcessos(db: SupabaseClient): Promise<AcessosCarregados> {
  const [users, umr, uca, uorgs, sectors, orcEmp, orcSet, dpEmp] = await Promise.all([
    lerTudo(
      db,
      "users",
      "id, email, name, phone, position, role, active, contracts_only, profile, can_financeiro, can_compras, can_case, can_viagens, can_viagens_aprovar",
      ["id"],
    ),
    lerTudo(db, "user_module_roles", "user_id, module, role", ["user_id", "module", "role"]),
    lerTudo(db, "user_company_access", "user_id, company_id", ["user_id", "company_id"]),
    lerTudo(db, "ctrl_user_orgs", "user_id, org_id, role", ["user_id", "org_id"]),
    lerTudo(db, "user_sectors", "user_id, sector_id", ["user_id", "sector_id"]),
    lerTudo(db, "orcamento_user_empresas", "user_id, company_id", ["user_id", "company_id"]),
    lerTudo(db, "orcamento_user_setores", "user_id, company_id, setor_nome", ["user_id", "company_id", "setor_nome"]),
    lerTudo(db, "dp_user_empresas", "user_id, company_id", ["user_id", "company_id"], { opcional: true }),
  ]);

  const roles = agrupar<ModuleRoleRow>(umr, (r) => ({ module: r.module as string, role: r.role as string }));
  const empFin = agrupar(uca, (r) => r.company_id as string);
  const orgs = agrupar(uorgs, (r) => ({ orgId: r.org_id as string, role: (r.role as string | null) ?? null }));
  const setores = agrupar(sectors, (r) => r.sector_id as string);
  const empOrc = agrupar(orcEmp, (r) => r.company_id as string);
  const setOrc = agrupar(orcSet, (r) => ({ company: r.company_id as string, nome: r.setor_nome as string }));
  const empDp = agrupar(dpEmp, (r) => r.company_id as string);

  const usuarios: UsuarioCadastro[] = [];
  const atual = new Map<string, AcessoAtual>();
  for (const u of users) {
    const id = u.id as string;
    const linhas = roles.get(id) ?? [];
    const setoresOrcamento: Record<string, string[]> = {};
    for (const s of setOrc.get(id) ?? []) (setoresOrcamento[s.company] ??= []).push(s.nome);

    usuarios.push({
      id,
      email: (u.email as string) ?? "",
      name: (u.name as string | null) ?? "",
      phone: (u.phone as string | null) ?? "",
      position: (u.position as string | null) ?? "",
      active: Boolean(u.active),
      canViagens: Boolean(u.can_viagens),
      canViagensAprovar: Boolean(u.can_viagens_aprovar),
      vbRole: (linhas.find((l) => l.module === "vb")?.role as string | undefined) ?? null,
    });
    atual.set(id, {
      email: (u.email as string) ?? "",
      profile: (u.profile as UserProfileType | null) ?? null,
      legacyRole: (u.role as string | null) ?? null,
      contractsOnly: Boolean(u.contracts_only),
      canFinanceiro: Boolean(u.can_financeiro),
      canCompras: Boolean(u.can_compras),
      canCase: Boolean(u.can_case),
      moduleRoles: linhas,
      empresasFinanceiro: empFin.get(id) ?? [],
      comprasEmpresas: orgs.get(id) ?? [],
      setoresCompras: setores.get(id) ?? [],
      empresasOrcamento: empOrc.get(id) ?? [],
      setoresOrcamento,
      empresasDp: empDp.get(id) ?? [],
    });
  }
  usuarios.sort((a, b) =>
    (a.name.trim() || a.email).localeCompare(b.name.trim() || b.email, "pt-BR", { sensitivity: "base" }),
  );
  return { usuarios, atual };
}
