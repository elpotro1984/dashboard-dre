// O vocabulário da TRILHA tem de caber no CHECK da coluna.
//
// Este é o guarda para o defeito que já apareceu SEIS vezes neste módulo: um
// valor novo é inventado no TypeScript (um método, um alvo, uma ação, uma
// `source`) e o CHECK da coluna, que enumera o vocabulário, não o conhece. O
// INSERT falha com 23514.
//
// Na trilha a falha é a pior de todas porque é CALADA: `registrarAlteracao` só
// escreve no console, de propósito — a trilha nunca derruba a ação que ela
// registra. Então a escrita acontece, o usuário vê sucesso, e o histórico
// simplesmente não tem aquela linha. Foi assim que `finalizou` ficou de fora
// desde 30/09/2026: Finalizar publicava no Budget e travava a fatia sem deixar
// rastro, enquanto `reabriu` (que já estava na lista) registrava normalmente.
//
// Por que ler o ARQUIVO de migration em vez de bater no banco: o teste roda sem
// credencial, e o que se quer travar é a distância entre o que o código PODE
// escrever e o que o schema versionado ACEITA. Se os dois divergirem, alguém
// esqueceu a migration — e é agora que se descobre, não em produção.
//
// Os mapas de rótulo (`ACAO_LABEL`, `ALVO_LABEL`) são `Record<Tipo, string>`:
// o compilador garante que são exaustivos, então `Object.keys` devolve o
// vocabulário inteiro em runtime. É o mesmo truque de `cargo-beneficios.test.ts`.

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

import { ACAO_LABEL, ALVO_LABEL } from "./trilha";

const MIGRATIONS = path.join(process.cwd(), "supabase", "migrations");

/**
 * Os valores do CHECK mais RECENTE que define esta constraint.
 *
 * Em ordem de nome de arquivo, que é a ordem de aplicação: a última definição é
 * a que vale no banco. Pegar a primeira leria uma lista que já foi substituída.
 */
function valoresDoCheck(constraint: string, coluna: string): string[] {
  const arquivos = fs.readdirSync(MIGRATIONS).filter((f) => f.endsWith(".sql")).sort();
  let ultima: string[] | null = null;

  for (const arquivo of arquivos) {
    // Os comentários SAEM antes de qualquer coisa. Eles estão cheios de
    // parêntese ("(30/09/2026)") e de valor entre aspas citado em prosa
    // ("mesmo motivo de 'viagem'") — ler o CHECK com eles no meio cortava a
    // lista cedo e inventava valores que não estavam na constraint. Foi o
    // primeiro resultado deste teste, e era defeito DELE.
    const sql = fs.readFileSync(path.join(MIGRATIONS, arquivo), "utf8").replace(/--.*/g, "");
    let desde = 0;
    for (;;) {
      // Só onde a constraint é ADICIONADA: um `DROP CONSTRAINT` antes dela não
      // pode ser confundido com a definição.
      const i = sql.indexOf(`ADD CONSTRAINT ${constraint}`, desde);
      if (i === -1) break;
      desde = i + 1;
      const abre = sql.indexOf(`${coluna} IN (`, i);
      if (abre === -1) continue;

      // Fecha contando profundidade, não no primeiro `)`.
      let profundidade = 0;
      let fim = -1;
      for (let k = sql.indexOf("(", abre); k < sql.length; k += 1) {
        if (sql[k] === "(") profundidade += 1;
        else if (sql[k] === ")") {
          profundidade -= 1;
          if (profundidade === 0) {
            fim = k;
            break;
          }
        }
      }
      if (fim === -1) continue;

      const valores: string[] = [];
      const aspas = /'([^']+)'/g;
      let m = aspas.exec(sql.slice(abre, fim));
      while (m) {
        valores.push(m[1]);
        m = aspas.exec(sql.slice(abre, fim));
      }
      if (valores.length > 0) ultima = valores;
    }
  }

  assert.ok(ultima, `não achei a definição de ${constraint} em supabase/migrations`);
  return ultima!;
}

test("toda AÇÃO que a trilha escreve existe no CHECK da coluna", () => {
  const noBanco = new Set(valoresDoCheck("orcamento_alteracoes_acao_chk", "acao"));
  const noCodigo = Object.keys(ACAO_LABEL);

  assert.ok(noCodigo.length > 0, "ACAO_LABEL ficou vazio");
  for (const acao of noCodigo) {
    assert.ok(
      noBanco.has(acao),
      `a trilha pode gravar "${acao}", que não está no CHECK — o INSERT falharia com ` +
        "23514 e, como `registrarAlteracao` só loga, a linha sumiria do histórico em " +
        "silêncio. Falta uma migration para este valor.",
    );
  }
});

test("todo ALVO que a trilha escreve existe no CHECK da coluna", () => {
  const noBanco = new Set(valoresDoCheck("orcamento_alteracoes_alvo_tipo_chk", "alvo_tipo"));
  const noCodigo = Object.keys(ALVO_LABEL);

  assert.ok(noCodigo.length > 0, "ALVO_LABEL ficou vazio");
  for (const alvo of noCodigo) {
    assert.ok(
      noBanco.has(alvo),
      `a trilha pode gravar alvo "${alvo}", que não está no CHECK — mesma falha calada ` +
        "da ação. Falta uma migration para este valor.",
    );
  }
});

test("o CHECK pode ter valores que o código não escreve mais — isso não é erro", () => {
  // O ciclo saiu em 24/09/2026 e as linhas já gravadas com as ações dele precisam
  // seguir legíveis. O teste é de UM lado só: o que o código escreve tem de caber
  // no banco; o contrário seria exigir apagar histórico.
  const noBanco = valoresDoCheck("orcamento_alteracoes_acao_chk", "acao");
  assert.ok(noBanco.includes("publicou"), "valor do ciclo antigo sumiu do CHECK");
  assert.ok(noBanco.includes("enviou_validacao"), "valor do ciclo antigo sumiu do CHECK");
});
