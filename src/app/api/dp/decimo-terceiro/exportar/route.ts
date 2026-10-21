import { NextResponse } from "next/server";
import * as XLSX from "xlsx";

import { getDpUser } from "@/lib/dp/auth";
import { podeVerEmpresa } from "@/lib/dp/escopo";
import { getDecimoTerceiro, type Dp13Empresa } from "@/lib/dp/folha/decimo-terceiro-queries";
import { DpNaoInstaladoError } from "@/lib/dp/queries";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

/** Excel do 13º de UMA empresa × ano, do mesmo cálculo da tela. Leva salários: só quem pode ver a empresa baixa. */
export async function GET(request: Request) {
  const user = await getDpUser();
  if (!user) return NextResponse.json({ error: "Acesso negado." }, { status: 403 });
  const url = new URL(request.url);
  const companyId = url.searchParams.get("companyId") ?? "";
  const ano = Number(url.searchParams.get("ano"));
  if (!Number.isInteger(ano) || ano < 2000 || ano > 2100) return NextResponse.json({ error: "Ano inválido." }, { status: 400 });
  if (!podeVerEmpresa(user, companyId)) return NextResponse.json({ error: "Você não tem acesso a esta empresa." }, { status: 403 });

  const db = createAdminClient();
  const { data: company } = await db.from("companies").select("id, name").eq("id", companyId).maybeSingle();
  if (!company) return NextResponse.json({ error: "Empresa não encontrada." }, { status: 400 });

  let dados: Dp13Empresa;
  try {
    dados = await getDecimoTerceiro(db, companyId, ano);
  } catch (error) {
    if (error instanceof DpNaoInstaladoError) return NextResponse.json({ error: "13º ainda não instalado no banco." }, { status: 409 });
    throw error;
  }

  const cab = ["Colaborador", "Setor", "Avos no ano", "Avos da 1ª", "Base", "13º integral", "1ª parcela", "1ª descontada na 2ª", "INSS", "IRRF", "2ª parcela (líquida)", "FGTS", "Custo", "Ajustes manuais", "Avisos"];
  const linhas = dados.linhas
    .filter((l) => !l.fora)
    .map((l) => [
      l.nome,
      l.setor ?? "",
      l.avosAno,
      l.avosPrimeira,
      l.base,
      l.integral,
      l.primeira,
      l.primeiraConsiderada,
      l.inss,
      l.irrf,
      l.segunda,
      l.fgts,
      l.custo,
      Object.keys(l.ajustados).join(", "),
      l.avisos.join(" | "),
    ]);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([cab, ...linhas]), "13º salário");
  const fora = dados.linhas.filter((l) => l.fora).map((l) => [l.nome, l.fora, l.avisos.join(" | ")]);
  if (fora.length) XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([["Colaborador", "Por que não tem 13º aqui", "Avisos"], ...fora]), "Fora");
  const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
  const nome = `13o ${ano} - ${company.name}.xlsx`.replace(/[\/:*?"<>|]/g, "-");
  return new NextResponse(new Uint8Array(buf), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(nome)}`,
      "Cache-Control": "no-store",
    },
  });
}
