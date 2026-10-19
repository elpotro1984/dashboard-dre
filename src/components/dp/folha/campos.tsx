"use client";

import { useEffect, useState } from "react";

// Campos de número da folha: aceitam "1.234,56", "1234,56" e "1234.56" — o DP
// digita do jeito que vem da planilha.

export const inputCls =
  "w-full rounded-md border border-input bg-background px-2 py-1 text-sm tabular-nums disabled:cursor-not-allowed disabled:opacity-60";

export function lerNumeroBR(s: string): number | null {
  const t = s.replace(/R\$|\s/g, "");
  if (!t) return 0;
  const n = Number(t.includes(",") ? t.replace(/\./g, "").replace(",", ".") : t);
  return Number.isFinite(n) ? n : null;
}

const fmt = (v: number, casas: number) =>
  v.toLocaleString("pt-BR", { minimumFractionDigits: 0, maximumFractionDigits: casas, useGrouping: false });

/** Número com texto livre enquanto digita; devolve o valor ao sair do campo. */
export function NumCampo({
  valor,
  onChange,
  disabled,
  casas = 2,
  sufixo,
  className,
  ariaLabel,
  extra,
}: {
  valor: number;
  onChange: (v: number) => void;
  disabled?: boolean;
  casas?: number;
  sufixo?: string;
  className?: string;
  ariaLabel?: string;
  /** Atributos extras do input (data-*, onKeyDown) — a grade usa para andar com Enter. */
  extra?: React.InputHTMLAttributes<HTMLInputElement> & Record<`data-${string}`, string | number>;
}) {
  const [txt, setTxt] = useState(fmt(valor, casas));
  useEffect(() => setTxt(fmt(valor, casas)), [valor, casas]);
  const [erro, setErro] = useState(false);
  return (
    <span className={`relative block ${className ?? ""}`}>
      <input
        value={txt}
        disabled={disabled}
        inputMode="decimal"
        aria-label={ariaLabel}
        {...extra}
        onChange={(e) => {
          setTxt(e.target.value);
          const n = lerNumeroBR(e.target.value);
          setErro(n === null);
          if (n !== null) onChange(n);
        }}
        onBlur={() => !erro && setTxt(fmt(valor, casas))}
        className={`${inputCls} ${sufixo ? "pr-7" : ""} ${erro ? "border-red-500" : ""}`}
      />
      {sufixo && <span className="pointer-events-none absolute right-2 top-1.5 text-xs text-ink-muted">{sufixo}</span>}
    </span>
  );
}
