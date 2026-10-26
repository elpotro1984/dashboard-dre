import { redirect } from "next/navigation";

import { UsersAcessosManager } from "@/components/app/users-acessos-manager";
import { podeConcederReservado } from "@/lib/auth/concessao-reservada";
import { getCurrentSessionContext } from "@/lib/auth/session";
import { nomesUnicos } from "@/lib/orcamento/setor-atribuicao";
import { createAdminClient } from "@/lib/supabase/admin";
import { acessosIniciais } from "@/lib/usuarios/acessos";
import { carregarAcessos } from "@/lib/usuarios/carregar-acessos";

export const dynamic = "force-dynamic";

/**
 * Tela de Usuários módulo → perfil (docs/superpowers/specs/
 * 2026-10-26-usuarios-modulo-perfil.md). A tela antiga (perfil único) saiu na
 * varredura de 26/10/2026: ela gravava pelo modelo velho — Financeiro sem
 * perfil gravado vira o perfil "legado", mais amplo que Visão Financeira.
 */
export default async function UsuariosPage() {
  const { user, profile } = await getCurrentSessionContext();
  if (!user) redirect("/login");
  if (!profile || profile.profile !== "admin") redirect("/dashboard");

  // Concessões reservadas (@/lib/auth/concessao-reservada): só o Lucas vê e
  // concede o DP e libera as empresas reservadas. Decidido pela SESSÃO.
  return <TelaModulos adminClient={createAdminClient()} reservado={podeConcederReservado(profile.id)} />;
}

type AdminClient = ReturnType<typeof createAdminClient>;

/**
 * Setores do ORÇAMENTO por empresa, para o seletor da tela. De TODOS os anos,
 * deduplicados por nome: a atribuição é year-agnostic (casa por nome), e o
 * mesmo setor aparece uma vez por ano clonado.
 */
async function setoresDoOrcamentoPorEmpresa(adminClient: AdminClient): Promise<Record<string, string[]>> {
  const { data } = await adminClient.from("orcamento_setores").select("company_id, name, active");
  const porEmpresa = new Map<string, string[]>();
  for (const row of (data ?? []) as Array<Record<string, unknown>>) {
    if (row.active === false) continue;
    const cid = row.company_id as string;
    porEmpresa.set(cid, [...(porEmpresa.get(cid) ?? []), (row.name as string) ?? ""]);
  }
  const out: Record<string, string[]> = {};
  for (const [cid, nomes] of Array.from(porEmpresa.entries())) {
    out[cid] = nomesUnicos(nomes).sort((a: string, b: string) =>
      a.localeCompare(b, "pt-BR", { sensitivity: "base" }),
    );
  }
  return out;
}

/**
 * Tela nova: o acesso EFETIVO de hoje de cada pessoa vira o formulário. Sem
 * `reservado`, a seção do DP vai VAZIA para o navegador — o estado do DP de
 * cada pessoa nem sai do servidor.
 */
async function TelaModulos({ adminClient, reservado }: { adminClient: AdminClient; reservado: boolean }) {
  const [{ usuarios, atual }, { data: companies }, { data: orgs }, { data: sectors }, orcamentoSetores] =
    await Promise.all([
      carregarAcessos(adminClient),
      adminClient.from("companies").select("id,name").eq("active", true).order("name"),
      adminClient.from("ctrl_orgs").select("id,nome").eq("ativo", true).order("nome"),
      adminClient.from("ctrl_sectors").select("id,name,org_id").eq("active", true).order("name"),
      setoresDoOrcamentoPorEmpresa(adminClient),
    ]);

  return (
    <UsersAcessosManager
      reservado={reservado}
      usuarios={usuarios.map((u) => {
        const { form, avisos } = acessosIniciais(atual.get(u.id)!, { verDp: reservado });
        return { ...u, form, avisos };
      })}
      companies={(companies ?? []).map((c) => ({ id: c.id as string, name: c.name as string }))}
      ctrlOrgs={(orgs ?? []).map((o) => ({ id: o.id as string, name: o.nome as string }))}
      ctrlSectors={(sectors ?? []).map((s) => ({
        id: s.id as string,
        name: s.name as string,
        orgId: (s.org_id as string | null) ?? null,
      }))}
      orcamentoSetores={orcamentoSetores}
    />
  );
}
