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

/**
 * Número que pode ficar VAZIO = automático. O valor que o sistema usaria
 * aparece como sugestão (cinza) no campo; digitar vence o automático, apagar
 * volta a ele. Usado em dias trabalhados, INSS do recibo de férias e dias de VT.
 */
export function NumCampoOpcional({
  valor,
  auto,
  onChange,
  disabled,
  casas = 2,
  ariaLabel,
  extra,
}: {
  valor: number | null;
  auto: number;
  onChange: (v: number | null) => void;
  disabled?: boolean;
  casas?: number;
  ariaLabel?: string;
  extra?: React.InputHTMLAttributes<HTMLInputElement> & Record<`data-${string}`, string | number>;
}) {
  const [txt, setTxt] = useState(valor === null ? "" : fmt(valor, casas));
  useEffect(() => setTxt(valor === null ? "" : fmt(valor, casas)), [valor, casas]);
  const [erro, setErro] = useState(false);
  return (
    <input
      value={txt}
      disabled={disabled}
      inputMode="decimal"
      aria-label={ariaLabel}
      placeholder={fmt(auto, casas)}
      title={valor === null ? "Automático — digite para informar outro valor" : "Informado — apague para voltar ao automático"}
      {...extra}
      onChange={(e) => {
        setTxt(e.target.value);
        if (!e.target.value.trim()) {
          setErro(false);
          onChange(null);
          return;
        }
        const n = lerNumeroBR(e.target.value);
        setErro(n === null);
        if (n !== null) onChange(n);
      }}
      onBlur={() => !erro && setTxt(valor === null ? "" : fmt(valor, casas))}
      className={`${inputCls} ${valor === null ? "placeholder:text-ink-muted" : "font-medium"} ${erro ? "border-red-500" : ""}`}
    />
  );
}
