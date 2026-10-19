"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

interface DpEmpresaOption {
  id: string;
  name: string;
  ativos: number;
}

/**
 * Seletor de EMPRESA do Departamento Pessoal — mesmo padrão do Compras
 * (`ctrl-org-switcher`). A lista já vem recortada pelo que a pessoa pode ver;
 * com uma empresa só ele some (não há o que trocar). Troca pelo cookie
 * (/api/context) e recarrega: as telas da empresa passam a mostrar a nova. Os
 * painéis do grupo ignoram o seletor.
 */
export function DpEmpresaSwitcher({ empresas, activeId }: { empresas: DpEmpresaOption[]; activeId: string | null }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);

  if (empresas.length <= 1) return null;
  const active = activeId ?? empresas[0]?.id ?? "";

  const onChange = async (next: string) => {
    if (next === active || pending || !empresas.some((e) => e.id === next)) return;
    setPending(true);
    try {
      await fetch("/api/context", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dpEmpresaId: next }),
      });
      router.refresh();
    } finally {
      setPending(false);
    }
  };

  return (
    <Select value={active} onValueChange={onChange} disabled={pending}>
      <SelectTrigger className="h-9 w-[220px]" aria-label="Empresa ativa do Departamento Pessoal">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {empresas.map((e) => (
          <SelectItem key={e.id} value={e.id}>
            {e.name}
            {e.ativos > 0 ? ` (${e.ativos})` : ""}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
