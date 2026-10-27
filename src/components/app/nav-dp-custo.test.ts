// Visibilidade do "Custo com colaborador" (DP) no menu: só ADMIN com a Visão
// Estratégica (`gestor`). As duas condições — a Visão Estratégica sozinha é de
// gente do DP que não é admin, e ser admin não dá o DP.
//
// Cobre também a FIAÇÃO, que é onde o Caixa quebrou: `isAdmin` é opcional em
// BuildInput, então esquecê-lo num dos dois pontos do app-shell compila limpo e
// o item some para todo mundo. O teste lê o arquivo e exige os dois.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { visibleNavKeys } from "./nav-links";
import { DP_NAV_KEY_CUSTO, DP_NAV_KEY_FOLHA, DP_NAV_KEY_SIMULACOES, podeVerCustoColaborador } from "@/lib/auth/dp";

const BASE = { dreRole: null, segments: [], activeSegmentSlug: null };

function keys(over: Partial<Parameters<typeof visibleNavKeys>[0]>): string[] {
  return visibleNavKeys({ ...BASE, ...over });
}

test("admin com a Visão Estratégica vê o Custo com colaborador", () => {
  assert.ok(keys({ isAdmin: true, dpRole: "gestor" }).includes(DP_NAV_KEY_CUSTO));
});

test("faltando uma das duas condições, não vê", () => {
  assert.ok(!keys({ isAdmin: true, dpRole: "analista" }).includes(DP_NAV_KEY_CUSTO), "admin na Visão Operacional");
  assert.ok(!keys({ isAdmin: true, dpRole: null }).includes(DP_NAV_KEY_CUSTO), "admin sem o DP");
  assert.ok(!keys({ isAdmin: false, dpRole: "gestor" }).includes(DP_NAV_KEY_CUSTO), "Visão Estratégica sem ser admin");
  assert.ok(!keys({ dpRole: "gestor" }).includes(DP_NAV_KEY_CUSTO), "omitir isAdmin não pode liberar");
});

test("o resto do DP não muda: a Visão Estratégica sem admin segue vendo a folha e as simulações", () => {
  const k = keys({ dpRole: "gestor" });
  assert.ok(k.includes(DP_NAV_KEY_FOLHA));
  assert.ok(k.includes(DP_NAV_KEY_SIMULACOES));
});

test("a regra é uma só para menu, middleware e página", () => {
  assert.equal(podeVerCustoColaborador(true, "gestor"), true);
  assert.equal(podeVerCustoColaborador(true, "analista"), false);
  assert.equal(podeVerCustoColaborador(false, "gestor"), false);
  assert.equal(podeVerCustoColaborador(true, null), false);
});

test("fiação: o app-shell passa isAdmin ao menu E ao roteiro do tour", () => {
  const shell = readFileSync(join(process.cwd(), "src/components/app/app-shell.tsx"), "utf8");
  assert.match(shell, /isAdmin=\{isAdmin\}/, "NavLinks sem isAdmin");
  const tour = shell.slice(shell.indexOf("visibleNavKeys({"), shell.indexOf("const sidebarNav"));
  assert.equal((tour.match(/\bisAdmin\b/g) ?? []).length, 2, "visibleNavKeys: isAdmin no objeto e nas dependências");
  const mw = readFileSync(join(process.cwd(), "src/lib/supabase/middleware.ts"), "utf8");
  assert.match(mw, /isDpCustoPath\(pathname\) && !podeVerCustoColaborador\(/, "middleware sem a trava da rota");
});
