import "server-only";

import { dpBloqueado, DP_MODULE, resolveDpRole, type DpRole } from "@/lib/auth/dp";
import type { createAdminClient } from "@/lib/supabase/admin";

// Leituras da tela Configurações › Acessos. Admin client DEPOIS de
// requireDpGestor(): `user_module_roles` e `users` têm RLS de admin, e quem
// administra o DP não precisa ser admin da plataforma.

type AdminClient = ReturnType<typeof createAdminClient>;

export interface DpConcessaoRow {
  userId: string;
  nome: string | null;
  email: string;
  ativo: boolean;
  /** Papel que a sessão reconhece — null quando a linha existe mas não vale (e-mail bloqueado). */
  papel: DpRole | null;
  /** Linha no banco sem efeito: e-mail bloqueado ou papel desconhecido. */
  semEfeito: boolean;
  empresas: string[];
}

export interface DpUsuarioRef {
  id: string;
  nome: string | null;
  email: string;
}

export interface DpConcessaoLog {
  id: string;
  acao: "concedeu" | "alterou" | "removeu";
  papel: DpRole | null;
  empresas: string[];
  alvo: string | null;
  por: string | null;
  createdAt: string;
}

/** Tabela da migration 20261019120000 ainda ausente. */
export function acessosNaoInstalados(error: { code?: string } | null): boolean {
  return error?.code === "PGRST205" || error?.code === "42P01";
}

export async function listDpConcessoes(db: AdminClient): Promise<DpConcessaoRow[]> {
  const [roles, empresas] = await Promise.all([
    db.from("user_module_roles").select("user_id, role, users(id, name, email, active)").eq("module", DP_MODULE),
    db.from("dp_user_empresas").select("user_id, company_id"),
  ]);
  if (roles.error) throw new Error(`user_module_roles: ${roles.error.message}`);
  if (empresas.error && !acessosNaoInstalados(empresas.error)) throw new Error(`dp_user_empresas: ${empresas.error.message}`);

  const porUser = new Map<string, string[]>();
  for (const r of empresas.data ?? []) {
    const l = porUser.get(r.user_id as string) ?? [];
    l.push(r.company_id as string);
    porUser.set(r.user_id as string, l);
  }

  const linhas = new Map<string, { roles: Array<{ module: string; role: string }>; nome: string | null; email: string; ativo: boolean }>();
  for (const r of roles.data ?? []) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const u = (Array.isArray((r as any).users) ? (r as any).users[0] : (r as any).users) as
      | { id: string; name: string | null; email: string; active: boolean | null }
      | null;
    if (!u) continue;
    const l = linhas.get(u.id) ?? { roles: [], nome: u.name, email: u.email, ativo: u.active !== false };
    l.roles.push({ module: DP_MODULE, role: String(r.role) });
    linhas.set(u.id, l);
  }

  return Array.from(linhas, ([userId, l]) => {
    const papel = resolveDpRole(l.roles, l.email);
    return {
      userId,
      nome: l.nome,
      email: l.email,
      ativo: l.ativo,
      papel,
      semEfeito: papel === null,
      empresas: papel === "analista" ? porUser.get(userId) ?? [] : [],
    };
  }).sort((a, b) => Number(b.papel === "gestor") - Number(a.papel === "gestor") || (a.nome ?? a.email).localeCompare(b.nome ?? b.email, "pt-BR"));
}

/** Usuários ativos que podem RECEBER o módulo (sem ele hoje e fora da lista de bloqueio). */
export async function listDpUsuariosElegiveis(db: AdminClient, jaTem: Set<string>): Promise<DpUsuarioRef[]> {
  const { data, error } = await db.from("users").select("id, name, email, active").order("name");
  if (error) throw new Error(`users: ${error.message}`);
  return (data ?? [])
    .filter((u) => u.active !== false && !jaTem.has(u.id as string) && !dpBloqueado(u.email as string))
    .map((u) => ({ id: u.id as string, nome: (u.name as string | null) ?? null, email: u.email as string }));
}

export async function listDpConcessoesLog(db: AdminClient, limit = 30): Promise<DpConcessaoLog[] | null> {
  const { data, error } = await db
    .from("dp_concessoes")
    .select("id, acao, papel, empresas, created_at, alvo:users!dp_concessoes_alvo_user_id_fkey(name, email), por:users!dp_concessoes_por_user_id_fkey(name, email)")
    .order("created_at", { ascending: false })
    .limit(limit);
  if (acessosNaoInstalados(error)) return null;
  if (error) throw new Error(`dp_concessoes: ${error.message}`);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const nome = (u: any) => {
    const x = Array.isArray(u) ? u[0] : u;
    return x ? (x.name as string | null) ?? (x.email as string) : null;
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (data ?? []).map((r: any) => ({
    id: r.id,
    acao: r.acao,
    papel: r.papel,
    empresas: Array.isArray(r.empresas) ? r.empresas : [],
    alvo: nome(r.alvo),
    por: nome(r.por),
    createdAt: r.created_at,
  }));
}
