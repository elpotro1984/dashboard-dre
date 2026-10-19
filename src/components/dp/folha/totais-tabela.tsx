import { ROTULO_CATEGORIA, type DpTotaisTabela } from "@/lib/dp/folha/totais";

import { brl0 } from "./formato";

/**
 * A aba TOTAIS da planilha: categorias nas linhas, grupos (setor, empresa ou
 * centro de custo) nas colunas, total à direita. Sem total no rodapé, como na
 * planilha: "Cartão benefício" já contém alimentação e gasolina, e somar a
 * coluna contaria os dois duas vezes.
 */
export function DpTotaisTabela({ t, rotuloGrupo }: { t: DpTotaisTabela; rotuloGrupo: string }) {
  if (t.grupos.length === 0) return <p className="text-sm text-ink-muted">Nada para totalizar.</p>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[720px] text-sm">
        <thead className="text-left text-ink-muted">
          <tr className="border-b border-border">
            <th className="sticky left-0 bg-card py-2 pr-3 font-medium">{rotuloGrupo}</th>
            {t.grupos.map((g) => (
              <th key={g} className="py-2 pr-3 text-right font-medium">
                {g}
                <div className="text-[11px] font-normal">{t.pessoas[g] ?? 0} pessoa(s)</div>
              </th>
            ))}
            <th className="py-2 text-right font-medium">Total</th>
          </tr>
        </thead>
        <tbody>
          {t.linhas.map((l) => (
            <tr key={l.categoria} className="border-b border-border last:border-0">
              <td className="sticky left-0 bg-card py-1.5 pr-3 text-ink-primary">{ROTULO_CATEGORIA[l.categoria]}</td>
              {t.grupos.map((g) => (
                <td key={g} className="py-1.5 pr-3 text-right tabular-nums">
                  {brl0(l.valores[g] ?? 0)}
                </td>
              ))}
              <td className="py-1.5 text-right font-medium tabular-nums">{brl0(l.total)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
