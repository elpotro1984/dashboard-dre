// O bloqueio nominal do DP (a Carol) mora em DOIS lugares: no app
// (DP_EMAILS_BLOQUEADOS) e no predicado de RLS dp_has_access(), que fecha a
// leitura direta pelo PostgREST. Este teste lê a ÚLTIMA definição da função
// nas migrations e exige a mesma lista — mudar uma sem a outra quebra a suíte.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";

import { DP_EMAILS_BLOQUEADOS } from "@/lib/auth/dp";

const MIGRATIONS = path.join(process.cwd(), "supabase", "migrations");

function ultimaDefinicao(): string {
  let ultima: string | null = null;
  for (const f of fs.readdirSync(MIGRATIONS).filter((n) => n.endsWith(".sql")).sort()) {
    // Comentários fora antes de ler: eles citam e-mails e funções em prosa.
    const sql = fs.readFileSync(path.join(MIGRATIONS, f), "utf8").replace(/--.*/g, "");
    const re = /CREATE OR REPLACE FUNCTION public\.dp_has_access\(\)[\s\S]*?\$\$([\s\S]*?)\$\$/g;
    for (const m of Array.from(sql.matchAll(re))) ultima = m[1];
  }
  assert.ok(ultima, "dp_has_access() não encontrada nas migrations");
  return ultima;
}

test("dp_has_access() bloqueia exatamente os e-mails de DP_EMAILS_BLOQUEADOS", () => {
  const m = ultimaDefinicao().match(/NOT IN \(([^)]*)\)/);
  assert.ok(m, "dp_has_access() sem o NOT IN de e-mails bloqueados");
  const noBanco = Array.from(m[1].matchAll(/'([^']+)'/g), (x) => x[1].toLowerCase()).sort();
  assert.deepEqual(noBanco, DP_EMAILS_BLOQUEADOS.map((e) => e.toLowerCase()).sort());
});

test("dp_has_access() segue exigindo o papel gestor (analista não lê direto)", () => {
  assert.match(ultimaDefinicao(), /r\.role = 'gestor'/);
});
