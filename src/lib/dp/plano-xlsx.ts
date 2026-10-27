// ============================================================================
// "Baixar plano" da tela de Cargos e salários — a planilha .xlsx. Puro e
// testado (sem I/O): a rota /api/dp/tabela-salarial/plano só confere a
// permissão, lê o banco e chama isto.
//
// O plano sai COMO ESTÁ na tela — `Setor | Cargo | Senioridade | Step |
// Salário | Centro de custo | Pessoas`, na ordem da tabela — e volta pela
// importação: ela lê as cinco primeiras colunas e ignora Centro de custo e
// Pessoas (o centro se define na tela; as pessoas vêm do vínculo com a
// Sólides). plano-xlsx.test.ts cobra a ida e volta.
// ============================================================================

import * as XLSX from "xlsx";

import { SENIORIDADES, separarCargo } from "@/lib/dp/cargos";

export const CABECALHO_PLANO = ["Setor", "Cargo", "Senioridade", "Step", "Salário", "Centro de custo", "Pessoas"] as const;
const COLUNA_SALARIO = 4;

export interface LinhaDoPlano {
  setor: string;
  cargo: string;
  senioridade: string;
  step: string;
  salario: number;
  /** Rótulo do centro de custo ("001 · Comercial"), ou vazio. */
  centroCusto: string;
  pessoas: number;
}

/** Cargo da Sólides usado por ativos da empresa — o ponto de partida de quem ainda não tem plano. */
export interface CargoDaSolides {
  cargo: string;
  departamento: string | null;
}

/**
 * A planilha do plano. Com `linhas` vazias e `cargosSolides`, sai o PONTO DE
 * PARTIDA: os cargos da Sólides já separados em cargo, senioridade e step, o
 * departamento (sem o sufixo "- EMPRESA") como setor e o salário em branco —
 * copiar nome de cargo à mão é de onde vem o erro que depois impede o de-para
 * de casar.
 */
export function planilhaDoPlano(linhas: LinhaDoPlano[], cargosSolides: CargoDaSolides[] = []): { buffer: Buffer; vazia: boolean } {
  const vazia = linhas.length === 0;
  const corpo: (string | number)[][] = vazia
    ? cargosSolides.map((c) => {
        const p = separarCargo(c.cargo);
        return [(c.departamento ?? "").replace(/\s+-\s+.*$/, "").trim(), p.cargo, p.senioridade, p.step, "", "", ""];
      })
    : linhas.map((l) => {
        // Linha antiga, ainda com tudo no nome, sai separada — é como ela volta pela importação.
        const p = l.senioridade || l.step ? l : separarCargo(l.cargo);
        return [l.setor, p.cargo, p.senioridade, p.step, l.salario, l.centroCusto, l.pessoas];
      });

  const ws = XLSX.utils.aoa_to_sheet([[...CABECALHO_PLANO], ...corpo]);
  ws["!cols"] = [{ wch: 26 }, { wch: 44 }, { wch: 13 }, { wch: 8 }, { wch: 14 }, { wch: 30 }, { wch: 9 }];
  ws["!autofilter"] = { ref: XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: corpo.length, c: CABECALHO_PLANO.length - 1 } }) };
  // Salário como NÚMERO, com milhar e duas casas: soma e filtra no Excel sem converter.
  for (let r = 1; r <= corpo.length; r += 1) {
    const cel = ws[XLSX.utils.encode_cell({ r, c: COLUNA_SALARIO })];
    if (cel && typeof cel.v === "number") cel.z = "#,##0.00";
  }

  const wb = XLSX.utils.book_new();
  // A importação lê a PRIMEIRA aba: o plano vem antes da ajuda.
  XLSX.utils.book_append_sheet(wb, ws, vazia ? "Cargos da Sólides" : "Plano de cargos e salários");
  const ajuda = XLSX.utils.aoa_to_sheet([
    ["Coluna", "O que é"],
    ["Cargo", "O cargo sem senioridade e step. Ex.: Analista de Relacionamento."],
    ["Senioridade", `${SENIORIDADES.join(", ")} — ou vazio, se o cargo não tem senioridade.`],
    ["Step", "Algarismo romano (I, II, III…) — ou vazio. Número (1, 2, 3) também é aceito e vira romano."],
    ["Salário", "Valor do mês. Ex.: 3500 ou 3.500,00."],
    ["Centro de custo", "Centro de custo padrão de quem está na linha. Só informativo: muda-se na tela, não pela importação."],
    ["Pessoas", "Colaboradores ativos vinculados à linha (pelo cargo da Sólides). Só informativo."],
    [],
    [
      "Reimportar",
      "Esta planilha volta pelo botão Importar planilha: a importação casa por setor + cargo + senioridade + step, " +
        "atualiza o salário do que já existe, inclui o que é novo e não apaga o que ficou fora.",
    ],
  ]);
  ajuda["!cols"] = [{ wch: 16 }, { wch: 110 }];
  XLSX.utils.book_append_sheet(wb, ajuda, "Como preencher");
  return { buffer: XLSX.write(wb, { bookType: "xlsx", type: "buffer" }) as Buffer, vazia };
}
