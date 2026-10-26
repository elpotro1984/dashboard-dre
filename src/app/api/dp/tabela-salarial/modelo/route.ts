import { NextResponse } from "next/server";
import * as XLSX from "xlsx";

import { getDpUser } from "@/lib/dp/auth";
import { SENIORIDADES, separarCargo } from "@/lib/dp/cargos";
import { podeVerEmpresa } from "@/lib/dp/escopo";
import { getDpTabela, listDpCargosSolidesDaEmpresa } from "@/lib/dp/cargos-queries";
import { DpNaoInstaladoError } from "@/lib/dp/queries";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

/**
 * Modelo .xlsx da tabela salarial de UMA empresa
 * (`Setor | Cargo | Senioridade | Step | Salário`).
 *
 * Vem PREENCHIDO: com a tabela atual, quando ela existe (baixar, ajustar e
 * reimportar é o caminho de quem prefere o Excel); senão, com os cargos que os
 * ativos da empresa têm na Sólides — já separados em cargo, senioridade e step
 * — e o departamento como setor; falta só o salário. Copiar nome de cargo à
 * mão é de onde vem o erro de digitação que depois impede a sugestão do de-para
 * de casar.
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

  let linhas: (string | number)[][];
  try {
    const tabela = await getDpTabela(db, companyId);
    if (tabela.length > 0) {
      // Linha antiga, ainda com tudo no nome, sai separada — é como ela volta pela importação.
      linhas = tabela.map((l) => {
        const p = l.senioridade || l.step ? l : separarCargo(l.cargo);
        return [l.setor, p.cargo, p.senioridade, p.step, l.salario];
      });
    } else {
      const cargos = await listDpCargosSolidesDaEmpresa(db, companyId);
      linhas = cargos.map((c) => {
        const p = separarCargo(c.cargo);
        // "COMERCIAL - VIVA BH" → "COMERCIAL": o sufixo é a empresa, que a planilha já é.
        return [(c.departamento ?? "").replace(/\s+-\s+.*$/, "").trim(), p.cargo, p.senioridade, p.step, ""];
      });
    }
  } catch (error) {
    if (error instanceof DpNaoInstaladoError) {
      return NextResponse.json({ error: "Tabela salarial ainda não instalada no banco (migration 20261002130000)." }, { status: 400 });
    }
    throw error;
  }

  const ws = XLSX.utils.aoa_to_sheet([["Setor", "Cargo", "Senioridade", "Step", "Salário"], ...linhas]);
  ws["!cols"] = [{ wch: 26 }, { wch: 44 }, { wch: 13 }, { wch: 8 }, { wch: 14 }];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Tabela salarial");
  const ajuda = XLSX.utils.aoa_to_sheet([
    ["Coluna", "Como preencher"],
    ["Cargo", "O cargo sem senioridade e step. Ex.: Analista de Relacionamento."],
    ["Senioridade", `${SENIORIDADES.join(", ")} — ou vazio, se o cargo não tem senioridade.`],
    ["Step", "Algarismo romano (I, II, III…) — ou vazio. Número (1, 2, 3) também é aceito e vira romano."],
    ["Salário", "Valor do mês. Ex.: 3500 ou 3.500,00."],
  ]);
  ajuda["!cols"] = [{ wch: 14 }, { wch: 90 }];
  XLSX.utils.book_append_sheet(wb, ajuda, "Como preencher");
  const buffer = XLSX.write(wb, { bookType: "xlsx", type: "buffer" }) as Buffer;

  const nome = String(company.name).normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^A-Za-z0-9]+/g, "-").toLowerCase();
  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      "content-type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "content-disposition": `attachment; filename="tabela-salarial-${nome}.xlsx"`,
    },
  });
}
