// scripts/case-trello-import.ts
// Importa os eventos do quadro do Trello "CASE SHOWS - EVENTOS" para a agenda
// do Case (tabela case_agenda_importada). Por padrão só mostra a prévia; DRY=0
// grava. Reexecutar é seguro: a chave é o id do cartão, e o cartão já
// importado é atualizado em vez de duplicado.
//
//   npx tsx --env-file=.env.local scripts/case-trello-import.ts <arquivo.json> [desde=AAAA-MM-DD]
//   DRY=0 npx tsx --env-file=.env.local scripts/case-trello-import.ts <arquivo.json>

import { readFileSync } from "node:fs";

import { createClient } from "@supabase/supabase-js";

import { lerQuadro, type TrelloBoard } from "@/lib/case/trello-agenda";

function hojeBRT(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date());
}

async function main() {
  const [arquivo, desdeArg] = process.argv.slice(2);
  if (!arquivo) throw new Error("Informe o caminho do JSON exportado do Trello.");
  const desde = desdeArg ?? hojeBRT();
  const dry = process.env.DRY !== "0";

  const board = JSON.parse(readFileSync(arquivo, "utf8")) as TrelloBoard;
  const { linhas, ignorados } = lerQuadro(board, desde);

  console.log(`Eventos a partir de ${desde}: ${linhas.length}\n`);
  for (const l of linhas) {
    const [y, m, d] = l.event_date.split("-");
    const fim = l.event_date_fim ? ` a ${l.event_date_fim.split("-").reverse().join("/")}` : "";
    console.log(`${d}/${m}/${y}${fim} | ${l.categoria ?? "?"} | ${l.turma ?? "?"} | ${[l.local_name, l.local_city].filter(Boolean).join(" - ") || "?"} | ${l.unidade ?? "—"}${l.intermediacao ? " | intermédio" : ""}`);
    console.log(`      atrações: ${l.atracoes.join(", ") || "—"} | NP: ${l.nps.join(", ") || "—"} | anexos: ${l.anexos.length} | comentários: ${l.comentarios.length}`);
  }
  if (ignorados.length) {
    console.log(`\nFora da importação (${ignorados.length}):`);
    for (const i of ignorados) console.log(`  - ${i.titulo} → ${i.motivo}`);
  }
  console.log(`\nSem atração identificada: ${linhas.filter((l) => l.atracoes.length === 0).length} | sem NP: ${linhas.filter((l) => l.nps.length === 0).length} | sem unidade: ${linhas.filter((l) => !l.unidade).length}`);

  if (dry) {
    console.log("\nPrévia apenas (DRY). Nada foi gravado.");
    return;
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Defina NEXT_PUBLIC_SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY.");
  const db = createClient(url, key, { auth: { persistSession: false } });

  const { error, count } = await db
    .from("case_agenda_importada")
    .upsert(
      linhas.map((l) => ({ origem: "trello", ...l })),
      { onConflict: "origem,origem_id", count: "exact" },
    );
  if (error) throw error;
  console.log(`\nGravados: ${count ?? linhas.length}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
