import { NextResponse } from "next/server";

// Convite pelo modelo velho (perfil único) desligado na varredura de 26/10/2026:
// ele gravava o Financeiro sem perfil por módulo (perfil "legado", mais amplo
// que Visão Financeira). A tela de Usuários convida por POST /api/users/acessos.
export async function POST() {
  return NextResponse.json(
    { error: "Convide pela tela de Usuários (módulo → perfil)." },
    { status: 410 },
  );
}
