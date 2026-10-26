// O acesso ao módulo Orçamento mora em DOIS lugares: no app
// (resolveOrcamentoPapel, src/lib/auth/orcamento.ts) e no predicado de RLS
// orcamento_has_access(). Desde 26/10/2026 o perfil GRAVADO na linha de
// concessão também concede o módulo (tela de Usuários módulo → perfil). Este
// teste lê a ÚLTIMA definição da função nas migrations e exige que todo papel
// gravável pelo app esteja lá — senão a tela libera e a RLS esconde tudo.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";

import { resolveOrcamentoPapel } from "@/lib/auth/orcamento";

const MIGRATIONS = path.join(process.cwd(), "supabase", "migrations");

function ultimaDefinicao(nome: string): string {
  let ultima: string | null = null;
  for (const f of fs.readdirSync(MIGRATIONS).filter((n) => n.endsWith(".sql")).sort()) {
    const sql = fs.readFileSync(path.join(MIGRATIONS, f), "utf8").replace(/--.*/g, "");
    const re = new RegExp(
      `CREATE OR REPLACE FUNCTION public\\.${nome}\\([^)]*\\)[\\s\\S]*?\\$\\$([\\s\\S]*?)\\$\\$`,
      "g",
    );
    for (const m of Array.from(sql.matchAll(re))) ultima = m[1];
  }
  assert.ok(ultima, `${nome}() não encontrada nas migrations`);
  return ultima;
}

test("orcamento_has_access() aceita todo papel que o app reconhece na linha gravada", () => {
  const sql = ultimaDefinicao("orcamento_has_access");
  const m = sql.match(/r\.role in \(([^)]*)\)/);
  assert.ok(m, "orcamento_has_access() sem a lista de papéis gravados");
  const noBanco = Array.from(m[1].matchAll(/'([^']+)'/g), (x) => x[1]).sort();

  // Os papéis que um SOLICITANTE (perfil não elegível) ganha só pela linha.
  const doApp = ["construtor", "construtor_amplo", "validador", "auto", "qualquer"]
    .filter((role) => resolveOrcamentoPapel("solicitante", [{ module: "orcamento", role }]) !== null)
    .sort();
  assert.deepEqual(noBanco, doApp);
});

test("orcamento_pode_ler_empresa() lê a lista do próprio módulo, não a do Financeiro", () => {
  const sql = ultimaDefinicao("orcamento_pode_ler_empresa");
  assert.match(sql, /orcamento_user_empresas/);
  assert.doesNotMatch(sql, /user_has_company_access/);
});
