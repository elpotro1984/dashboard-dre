// O banco espelha a regra do app (@/lib/auth/dp): só a CONCESSÃO abre o DP —
// admin não herda — e quem concede é só o Lucas (@/lib/auth/concessao-reservada).
// dp_has_access() fecha a leitura direta pelo PostgREST; este teste lê a ÚLTIMA
// definição dela nas migrations. Uma migration que volte a deixar o admin
// entrar compila, passa no lint e no build — e abriria o DP a qualquer admin,
// inclusive a um admin criado só para isso.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";

const MIGRATIONS = path.join(process.cwd(), "supabase", "migrations");

function ultimaDefinicao(): string {
  let ultima: string | null = null;
  for (const f of fs.readdirSync(MIGRATIONS).filter((n) => n.endsWith(".sql")).sort()) {
    // Comentários fora antes de ler: eles citam papéis e funções em prosa.
    const sql = fs.readFileSync(path.join(MIGRATIONS, f), "utf8").replace(/--.*/g, "");
    const re = /CREATE OR REPLACE FUNCTION public\.dp_has_access\(\)[\s\S]*?\$\$([\s\S]*?)\$\$/g;
    for (const m of Array.from(sql.matchAll(re))) ultima = m[1];
  }
  assert.ok(ultima, "dp_has_access() não encontrada nas migrations");
  return ultima;
}

test("dp_has_access() não deixa admin entrar sem a concessão", () => {
  const corpo = ultimaDefinicao();
  assert.doesNotMatch(corpo, /admin/i, "dp_has_access() voltou a citar admin — admin não herda o DP");
});

test("dp_has_access() exige a linha module='dp' com papel gestor (analista não lê direto)", () => {
  const corpo = ultimaDefinicao();
  assert.match(corpo, /r\.module = 'dp'/);
  assert.match(corpo, /r\.role = 'gestor'/);
});
