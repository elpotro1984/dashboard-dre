import { NextResponse } from "next/server";
import * as XLSX from "xlsx";

import { getDpUser } from "@/lib/dp/auth";
import { podeVerEmpresa } from "@/lib/dp/escopo";
import { COLUNAS_FOLHA, ROTULO_COLUNA, ROTULO_SITUACAO } from "@/lib/dp/folha/motor";
import { competenciaValida, rotuloCompetencia } from "@/lib/dp/folha/parametros";
import { getFolhaEmpresa, type DpFolhaEmpresa } from "@/lib/dp/folha/queries";
import { ROTULO_CATEGORIA, totalizar } from "@/lib/dp/folha/totais";
import { DpNaoInstaladoError } from "@/lib/dp/queries";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

/**
 * Excel da folha gerencial de UMA empresa × mês — as abas da planilha do DP
 * (folha, benefícios, rescisões, totais), saídas do mesmo cálculo da tela. Leva
 * salários: só quem pode ver a empresa baixa (escopo do DP).
 */
export async function GET(request: Request) {
  const user = await getDpUser();
  if (!user) return NextResponse.json({ error: "Acesso negado." }, { status: 403 });
  const url = new URL(request.url);
  const companyId = url.searchParams.get("companyId") ?? "";
  const competencia = url.searchParams.get("competencia") ?? "";
  if (!competenciaValida(competencia)) return NextResponse.json({ error: "Competência inválida." }, { status: 400 });
  if (!podeVerEmpresa(user, companyId)) return NextResponse.json({ error: "Você não tem acesso a esta empresa." }, { status: 403 });

  const db = createAdminClient();
  const { data: company } = await db.from("companies").select("id, name").eq("id", companyId).maybeSingle();
  if (!company) return NextResponse.json({ error: "Empresa não encontrada." }, { status: 400 });

  let folha: DpFolhaEmpresa;
  try {
    folha = await getFolhaEmpresa(db, companyId, competencia);
  } catch (error) {
    if (error instanceof DpNaoInstaladoError) return NextResponse.json({ error: "Folha ainda não instalada no banco." }, { status: 409 });
    throw error;
  }

  const wb = XLSX.utils.book_new();
  const cab = ["Colaborador", "Setor", "Centro de custo", "Situação", "Salário de carteira", ...COLUNAS_FOLHA.map((k) => ROTULO_COLUNA[k]), "Ajustes manuais", "Avisos"];
  const linhas = folha.linhas.map((l) => [
    l.nome,
    l.setor ?? "",
    l.centroCusto ?? "",
    ROTULO_SITUACAO[l.situacao],
    l.salarioCarteira,
    ...COLUNAS_FOLHA.map((k) => l[k]),
    Object.keys(l.ajustados ?? {}).map((k) => ROTULO_COLUNA[k as keyof typeof ROTULO_COLUNA]).join(", "),
    (l.avisos ?? []).join(" | "),
  ]);
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([cab, ...linhas]), "Folha");

  const pessoaPor = new Map(folha.pessoas.map((p) => [p.solidesId, p]));
  const beneficios = folha.linhas.map((l) => {
    const p = pessoaPor.get(l.solidesId);
    const tr = p?.cadastro.transporteTipo === "bilhete" ? p.cadastro.transporteOpcao ?? "" : p?.cadastro.transporteTipo === "gasolina" ? "Gasolina" : "";
    return [l.nome, l.centroCusto ?? "", l.alimentacao, tr, l.valeTransporte + l.valeGasolina, l.alimentacao + l.valeTransporte + l.valeGasolina];
  });
  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.aoa_to_sheet([["Colaborador", "Centro de custo", "Alimentação", "Transporte", "Valor transporte", "Total benefício"], ...beneficios]),
    "Benefícios",
  );

  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.aoa_to_sheet([
      ["Data do pagamento", "Tipo", "Setor", "Valor", "Colaborador", "Observações"],
      ...folha.rescisoes.map((r) => [r.dataPagamento ?? "", r.tipo, r.setor, r.valor, r.nome, r.observacao ?? ""]),
    ]),
    "Rescisões",
  );

  const resc = (grupo: (r: (typeof folha.rescisoes)[number]) => string | null) => folha.rescisoes.map((r) => ({ grupo: grupo(r), valor: r.valor }));
  for (const [nome, t] of [
    ["Totais por setor", totalizar(folha.linhas, (l) => l.setor, resc((r) => r.setor))],
    ["Totais por centro de custo", totalizar(folha.linhas, (l) => l.centroCusto, [])],
  ] as const) {
    XLSX.utils.book_append_sheet(
      wb,
      XLSX.utils.aoa_to_sheet([
        ["Categoria", ...t.grupos, "Total"],
        ...t.linhas.map((l) => [ROTULO_CATEGORIA[l.categoria], ...t.grupos.map((g) => l.valores[g]), l.total]),
      ]),
      nome,
    );
  }

  const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
  const arquivo = `Folha ${company.name} ${rotuloCompetencia(competencia).replace("/", "-")}.xlsx`;
  return new NextResponse(new Uint8Array(buf), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(arquivo)}`,
      "Cache-Control": "no-store",
    },
  });
}
