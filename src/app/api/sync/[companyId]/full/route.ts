import { NextResponse } from "next/server";
import { getCurrentSessionContext } from "@/lib/auth/session";
import { runCompanySync } from "@/lib/omie/sync";

interface Params {
  params: {
    companyId: string;
  };
}

export async function POST(_: Request, { params }: Params) {
  const { user, profile } = await getCurrentSessionContext();
  if (!user || !profile) {
    return NextResponse.json({ error: "Nao autenticado." }, { status: 401 });
  }
  // Conexões e sincronização são só de admin (a tela /conexoes também).
  if (profile.role !== "admin") {
    return NextResponse.json({ error: "Acesso negado." }, { status: 403 });
  }

  try {
    const result = await runCompanySync(params.companyId, profile, "full");
    return NextResponse.json({
      ok: true,
      recordsImported: result.recordsImported,
      recordsDeleted: result.recordsDeleted,
      categoriesImported: result.categories.length,
      newUnmappedCategories: result.newUnmappedCategories.length,
    });
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "Falha inesperada ao sincronizar empresa.";
    return NextResponse.json({ ok: false, error: message }, { status: 400 });
  }
}
