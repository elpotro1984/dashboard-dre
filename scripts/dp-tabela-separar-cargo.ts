// Separa o cargo das linhas JÁ EXISTENTES da tabela salarial do DP em
// Cargo | Senioridade | Step (migration 20261026160000), pela MESMA regra do
// app (`normalizarCargo` em src/lib/dp/cargos.ts) — "Analista de
// Relacionamento JÚNIOR I" → "Analista de Relacionamento" · Júnior · I.
//
//   npx tsx scripts/dp-tabela-separar-cargo.ts          → prévia, não grava
//   DRY=0 npx tsx scripts/dp-tabela-separar-cargo.ts    → grava
//
// Só mexe em linha que ainda não tem senioridade nem step (rodar de novo não
// muda nada) e só grava se o nome no banco ainda for o lido — linha editada
// na tela enquanto o script roda fica como está. Para se a separação fizer
// duas linhas virarem a mesma: decidir qual fica é de quem cadastrou.
// Imprime só contagens e nomes de cargo — nunca salário nem pessoa.
import fs from "node:fs";

import { createClient } from "@supabase/supabase-js";

import { chaveCargo, chaveNome, nomeCargo, normalizarCargo, separarCargo } from "@/lib/dp/cargos";

for (const line of fs.readFileSync(".env.local", "utf8").split(/\r?\n/)) {
  const i = line.indexOf("=");
  if (i > 0 && !process.env[line.slice(0, i).trim()]) process.env[line.slice(0, i).trim()] = line.slice(i + 1).trim().replace(/^"|"$/g, "");
}

const GRAVAR = process.env.DRY === "0";

interface Linha {
  id: string;
  company_id: string;
  setor_chave: string;
  cargo: string;
  senioridade: string;
  step: string;
}

async function main() {
  const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });

  const sonda = await db.from("dp_tabela_salarial").select("senioridade, step").limit(1);
  const instalada = !sonda.error;
  if (!instalada) {
    if (sonda.error?.code !== "42703") throw new Error(sonda.error?.message);
    console.log("⚠ migration 20261026160000 ainda não aplicada — mostrando só a prévia.");
    if (GRAVAR) process.exit(1);
  }

  const linhas: Linha[] = [];
  for (let de = 0; ; de += 1000) {
    const { data, error } = await db
      .from("dp_tabela_salarial")
      .select(instalada ? "id, company_id, setor_chave, cargo, senioridade, step" : "id, company_id, setor_chave, cargo")
      .order("id")
      .range(de, de + 999);
    if (error) throw new Error(error.message);
    const pagina = (data ?? []) as unknown as Array<Partial<Linha>>;
    linhas.push(...pagina.map((r) => ({ senioridade: "", step: "", ...r }) as Linha));
    if (pagina.length < 1000) break;
  }
  const { data: comps } = await db.from("companies").select("id, name").in("id", Array.from(new Set(linhas.map((l) => l.company_id))));
  const nomeEmpresa = new Map((comps ?? []).map((c) => [c.id as string, c.name as string]));

  type Plano = { linha: Linha; novo: { cargo: string; senioridade: string; step: string } };
  const planos: Plano[] = [];
  const recusas: string[] = [];
  let jaSeparadas = 0;
  for (const l of linhas) {
    if (l.senioridade || l.step) {
      jaSeparadas += 1;
      continue;
    }
    const r = normalizarCargo({ cargo: l.cargo }, { senioridade: true, step: true });
    if ("erro" in r) {
      recusas.push(`${l.cargo}: ${r.erro}`);
      continue;
    }
    if (r.ok.cargo === l.cargo && !r.ok.senioridade && !r.ok.step) continue;
    planos.push({ linha: l, novo: r.ok });
  }

  // Nenhuma linha pode virar outra (mesma empresa, setor e cargo + senioridade + step).
  const mudanca = new Map(planos.map((p) => [p.linha.id, p.novo]));
  const vistas = new Map<string, string>();
  const colisoes: string[] = [];
  for (const l of linhas) {
    const n = mudanca.get(l.id) ?? l;
    const k = `${l.company_id}|${l.setor_chave}|${chaveNome(n.cargo)}|${n.senioridade}|${n.step}`;
    const outra = vistas.get(k);
    if (outra) colisoes.push(`${nomeEmpresa.get(l.company_id) ?? l.company_id}: "${outra}" e "${l.cargo}"`);
    else vistas.set(k, l.cargo);
  }

  console.log(`linhas na tabela: ${linhas.length} · já separadas: ${jaSeparadas} · a separar: ${planos.length} · sem o que separar: ${linhas.length - jaSeparadas - planos.length - recusas.length}`);
  for (const [id, nome] of Array.from(nomeEmpresa)) {
    const daqui = planos.filter((p) => p.linha.company_id === id);
    const conta = (f: (p: Plano) => boolean) => daqui.filter(f).length;
    console.log(
      `  ${nome}: ${daqui.length} a separar — senioridade + step ${conta((p) => Boolean(p.novo.senioridade && p.novo.step))}, ` +
        `só step ${conta((p) => !p.novo.senioridade && Boolean(p.novo.step))}, só senioridade ${conta((p) => Boolean(p.novo.senioridade) && !p.novo.step)}`,
    );
  }
  const exemplos = Array.from(new Map(planos.map((p) => [p.linha.cargo, p.novo])).entries());
  // O caso que pede conferência: a senioridade saiu do MEIO do nome.
  const doMeio = exemplos.filter(([orig, n]) => {
    if (!n.senioridade) return false;
    const semStep = separarCargo(orig, { senioridade: false }).cargo.split(" ");
    return chaveNome(semStep[semStep.length - 1]) !== chaveNome(n.senioridade);
  });
  console.log(`\nexemplos (${Math.min(6, exemplos.length)} de ${exemplos.length} nomes distintos):`);
  for (const [orig, n] of exemplos.slice(0, 6)) console.log(`  "${orig}" → cargo "${n.cargo}" · senioridade "${n.senioridade}" · step "${n.step}"`);
  console.log(`\nsenioridade no MEIO do nome (${doMeio.length} nomes distintos) — confira:`);
  for (const [orig, n] of doMeio) console.log(`  "${orig}" → cargo "${n.cargo}" · senioridade "${n.senioridade}" · step "${n.step}"`);
  if (recusas.length) console.log(`\nrecusadas (${recusas.length}):`, recusas.slice(0, 20));

  // O de-para com a Sólides não pode piorar: cargos da Sólides com UMA linha
  // candidata, pela regra antiga (nome inteiro igual) e pela nova (chaveCargo).
  const { data: colabs } = await db.from("dp_colaboradores").select("cargo_nome").eq("ativo", true);
  const nomesSolides = Array.from(new Set((colabs ?? []).map((c) => c.cargo_nome as string | null).filter((v): v is string => Boolean(v))));
  for (const [id, nome] of Array.from(nomeEmpresa)) {
    const antes = linhas.filter((l) => l.company_id === id);
    const depois = antes.map((l) => ({ ...l, ...(mudanca.get(l.id) ?? {}) }));
    const unico = (f: (s: string) => number) => nomesSolides.filter((s) => f(s) === 1).length;
    const velha = unico((s) => antes.filter((l) => chaveNome(nomeCargo(l)) === chaveNome(s)).length);
    const nova = unico((s) => depois.filter((l) => chaveCargo(l) === chaveCargo({ cargo: s })).length);
    console.log(`de-para ${nome}: cargos da Sólides com UMA linha candidata — antes ${velha}, depois ${nova} (de ${nomesSolides.length} cargos ativos no grupo)`);
  }

  if (colisoes.length) {
    console.log(`\n✗ ${colisoes.length} linha(s) virariam outra já existente — nada foi gravado:`, colisoes.slice(0, 20));
    process.exit(1);
  }
  if (!GRAVAR) {
    console.log("\nPrévia — nada gravado. Para gravar: DRY=0");
    return;
  }

  let gravadas = 0;
  let puladas = 0;
  for (let i = 0; i < planos.length; i += 25) {
    const lote = planos.slice(i, i + 25);
    const res = await Promise.all(
      lote.map((p) =>
        db
          .from("dp_tabela_salarial")
          .update({ cargo: p.novo.cargo, cargo_chave: chaveNome(p.novo.cargo), senioridade: p.novo.senioridade, step: p.novo.step })
          .eq("id", p.linha.id)
          .eq("cargo", p.linha.cargo)
          .eq("senioridade", "")
          .eq("step", "")
          .select("id"),
      ),
    );
    for (const r of res) {
      if (r.error) throw new Error(r.error.message);
      if ((r.data ?? []).length === 1) gravadas += 1;
      else puladas += 1;
    }
  }
  console.log(`\n✓ ${gravadas} linha(s) separadas${puladas ? ` · ${puladas} pulada(s) (editadas enquanto o script rodava)` : ""}.`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
