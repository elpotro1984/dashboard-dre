import "server-only";

import { todayBR } from "@/lib/ctrl/datetime";
import { indexarRegras, resolverEmpresa } from "@/lib/dp/empresa";
import { podeVerEmpresa, type DpEscopo } from "@/lib/dp/escopo";
import { listDpRegras } from "@/lib/dp/queries";
import { alertasExperiencia, type DpAlertaExperiencia } from "@/lib/dp/vinculo";
import type { createAdminClient } from "@/lib/supabase/admin";

type AdminClient = ReturnType<typeof createAdminClient>;

export interface DpAlertaExperienciaComEmpresa extends DpAlertaExperiencia {
  empresa: string | null;
}

/**
 * Períodos de experiência vencendo nos próximos 15 dias, recortados pelo
 * ESCOPO de quem pergunta (as empresas liberadas a ela). É a leitura da tela
 * inicial, que só a chama para quem TEM o módulo (sigilo: nome de colaborador
 * e situação contratual não aparecem para mais ninguém).
 */
export async function listarAlertasExperiencia(db: AdminClient, escopo: DpEscopo): Promise<DpAlertaExperienciaComEmpresa[]> {
  const [regras, companies, colabs] = await Promise.all([
    listDpRegras(db),
    db.from("companies").select("id, name"),
    db
      .from("dp_colaboradores")
      .select("id, nome, ativo, tipo_contrato, data_admissao, experiencia_fim, experiencia_duracao, unidade_id, departamento_id")
      .eq("ativo", true),
  ]);
  if (colabs.error) throw new Error(`dp_colaboradores: ${colabs.error.message}`);
  const idx = indexarRegras(regras);
  const nomes = new Map((companies.data ?? []).map((c) => [c.id as string, c.name as string]));
  const empresaDe = new Map<string, string | null>();
  const pessoas = (colabs.data ?? []).flatMap((r) => {
    const e = resolverEmpresa(
      {
        unidadeId: r.unidade_id === null ? null : Number(r.unidade_id),
        departamentoId: r.departamento_id === null ? null : Number(r.departamento_id),
      },
      idx,
    );
    if (!podeVerEmpresa(escopo, e.companyId)) return [];
    empresaDe.set(r.id as string, e.companyId ? nomes.get(e.companyId) ?? null : null);
    return [{
      id: r.id as string,
      nome: r.nome as string,
      ativo: Boolean(r.ativo),
      tipoContrato: r.tipo_contrato as string | null,
      admissao: r.data_admissao as string | null,
      experienciaFim: r.experiencia_fim as string | null,
      duracao: r.experiencia_duracao as string | null,
    }];
  });
  return alertasExperiencia(pessoas, todayBR()).map((a) => ({ ...a, empresa: empresaDe.get(a.id) ?? null }));
}
