// Fiação da empresa ativa do DP (o esquema do Compras). Três pontos que, se
// divergirem, quebram em silêncio — compila, passa no lint e no build:
//  - o nome do cookie no navegador (aba desencontrada) × o do servidor;
//  - /api/context gravando a confirmação do login ao trocar de empresa (sem
//    ela, a escolha obrigatória reapareceria a cada página);
//  - o logout apagando a confirmação.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ler = (p: string) => readFileSync(join(process.cwd(), p), "utf8");
const valorDe = (fonte: string, nome: string) => fonte.match(new RegExp(String.raw`${nome}\s*=\s*"([^"]+)"`))?.[1] ?? null;

test("o cookie que o navegador lê é o mesmo que o servidor grava", () => {
  const servidor = valorDe(ler("src/lib/context/active-context.ts"), "ACTIVE_DP_EMPRESA_COOKIE");
  const navegador = valorDe(ler("src/components/dp/dp-empresa-ativa.tsx"), "ACTIVE_DP_EMPRESA_COOKIE");
  assert.ok(servidor);
  assert.equal(navegador, servidor);
});

test("trocar de empresa grava a confirmação deste login; o logout a apaga", () => {
  const ctx = ler("src/lib/context/active-context.ts");
  const confirmada = valorDe(ctx, "DP_EMPRESA_CONFIRMED_COOKIE");
  assert.ok(confirmada);
  const rota = ler("src/app/api/context/route.ts");
  const blocoDp = rota.slice(rota.indexOf("body.dpEmpresaId !== undefined"));
  assert.match(blocoDp, /store\.set\(\s*DP_EMPRESA_CONFIRMED_COOKIE/);
  assert.ok(ler("src/components/app/sign-out-button.tsx").includes(`${confirmada}=; Max-Age=0`));
});

test("o layout do DP mostra a escolha no LUGAR da página, e a faixa some enquanto isso", () => {
  const layout = ler("src/app/(dp)/dp/layout.tsx");
  assert.match(layout, /escolha\.pendente[^\n]*<DpEmpresaGate/);
  assert.match(layout, /dpEmpresaSelectionPending=\{escolha\.pendente\}/);
  assert.match(ler("src/components/app/app-shell.tsx"), /!dpEmpresaSelectionPending && \(\s*<DpEmpresaBanner/);
});
