import { NextResponse } from "next/server";

import { getDpUser } from "@/lib/dp/auth";
import { podeVerEmpresa } from "@/lib/dp/escopo";
import { getDpCargosPagina, listDpCargosSolidesDaEmpresa, rotuloCentro } from "@/lib/dp/cargos-queries";
import { planilhaDoPlano } from "@/lib/dp/plano-xlsx";
import { DpNaoInstaladoError } from "@/lib/dp/queries";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

/**
 * "Baixar plano" da tela de Cargos e salários: o plano de UMA empresa como está
 * na tela, com todas as colunas (a planilha é montada em @/lib/dp/plano-xlsx).
 * Empresa sem plano baixa o ponto de partida: os cargos da Sólides dela.
 */
export async function GET(request: Request) {
  const user = await getDpUser();
  if (!user) return NextResponse.json({ error: "Acesso negado." }, { status: 403 });

  const companyId = new URL(request.url).searchParams.get("companyId") ?? "";
  // A planilha leva os salários da tabela: a analista só baixa a das empresas dela.
  if (!podeVerEmpresa(user, companyId)) return NextResponse.json({ error: "Você não tem acesso a esta empresa." }, { status: 403 });
  const db = createAdminClient();
  const { data: company } = await db.from("companies").select("id, name").eq("id", companyId).maybeSingle();
  if (!company) return NextResponse.json({ error: "Empresa não encontrada." }, { status: 400 });

  let planilha: ReturnType<typeof planilhaDoPlano>;
  try {
    const pagina = await getDpCargosPagina(db, companyId);
    const centro = new Map(pagina.centros.map((c) => [c.id, rotuloCentro(c)]));
    planilha = planilhaDoPlano(
      pagina.tabela.map((l) => ({
        setor: l.setor,
        cargo: l.cargo,
        senioridade: l.senioridade,
        step: l.step,
        salario: l.salario,
        centroCusto: l.centroCustoId ? centro.get(l.centroCustoId) ?? "" : "",
        pessoas: l.pessoas,
      })),
      pagina.tabela.length === 0 ? await listDpCargosSolidesDaEmpresa(db, companyId) : [],
    );
  } catch (error) {
    if (error instanceof DpNaoInstaladoError) {
      return NextResponse.json({ error: "Tabela salarial ainda não instalada no banco (migration 20261002130000)." }, { status: 400 });
    }
    throw error;
  }

  const nome = String(company.name).normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^A-Za-z0-9]+/g, "-").toLowerCase();
  const arquivo = planilha.vazia ? `cargos-da-solides-${nome}.xlsx` : `plano-de-cargos-e-salarios-${nome}.xlsx`;
  return new NextResponse(new Uint8Array(planilha.buffer), {
    headers: {
      "content-type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "content-disposition": `attachment; filename="${arquivo}"`,
    },
  });
}
