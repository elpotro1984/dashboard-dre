// Toda server action do DP confere a concessão E o recorte de empresa (ou é
// só do gestor). Uma action nova sem o recorte compila limpo, passa no lint e
// no build — e só apareceria com uma analista gravando na empresa de outra.
// Este teste lê os arquivos de action do disco e cobra a chamada de guard no
// corpo de cada `export async function`.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";

const DIR = path.join(process.cwd(), "src", "lib", "dp");
const GUARDS = ["requireDpGestor(", "requireDpEmpresa(", "exigirEmpresa(user,"];

function acoes(): Array<{ arquivo: string; nome: string; corpo: string }> {
  const out: Array<{ arquivo: string; nome: string; corpo: string }> = [];
  for (const arquivo of fs.readdirSync(DIR).filter((f) => /^actions.*\.ts$/.test(f) && !f.endsWith(".test.ts"))) {
    const src = fs.readFileSync(path.join(DIR, arquivo), "utf8");
    assert.match(src, /^"use server";/, `${arquivo} deveria ser "use server"`);
    for (const p of src.split(/^export async function /m).slice(1)) {
      out.push({ arquivo, nome: p.slice(0, p.indexOf("(")), corpo: p });
    }
  }
  return out;
}

test("há actions para conferir (o teste não está olhando o lugar errado)", () => {
  assert.ok(acoes().length >= 15);
});

test("toda action do DP passa por um guard de empresa ou de gestor", () => {
  const sem = acoes()
    .filter((a) => !GUARDS.some((g) => a.corpo.includes(g)))
    .map((a) => `${a.arquivo}: ${a.nome}`);
  assert.deepEqual(sem, []);
});
