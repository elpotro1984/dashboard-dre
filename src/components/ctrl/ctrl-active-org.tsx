"use client";

import { createContext, useContext } from "react";

import { ctrlOrgColor, type CtrlOrgColor } from "@/lib/ctrl/org-gate";

export interface CtrlActiveOrg {
  id: string;
  nome: string;
  slug: string;
  color: CtrlOrgColor;
  /** O usuário acessa mais de uma empresa — só aí o destaque faz diferença. */
  multi: boolean;
}

const Ctx = createContext<CtrlActiveOrg | null>(null);

/**
 * Empresa ativa do Compras para os componentes client (formulário de
 * requisição, envio ao Omie). É a empresa em que a tela FOI RENDERIZADA — é ela
 * que as ações críticas mandam ao servidor como `expected_org_id`, para que uma
 * troca feita em outra aba seja recusada em vez de gravar na empresa errada.
 */
export function CtrlActiveOrgProvider({
  orgs,
  activeSlug,
  children,
}: {
  orgs: { id: string; nome: string; slug: string }[];
  activeSlug: string | null;
  children: React.ReactNode;
}) {
  const org = orgs.find((o) => o.slug === activeSlug) ?? null;
  const value: CtrlActiveOrg | null = org
    ? { ...org, color: ctrlOrgColor(org.slug), multi: orgs.length > 1 }
    : null;
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

/** null fora do módulo Compras (ou sem empresa). */
export function useCtrlActiveOrg(): CtrlActiveOrg | null {
  return useContext(Ctx);
}

/** Chip com o nome da empresa na cor dela — o mesmo sinal da faixa do topo. */
export function CtrlOrgChip({ org, className = "" }: { org: CtrlActiveOrg; className?: string }) {
  return (
    <span
      className={`inline-flex items-center rounded-md px-2.5 py-1 text-sm font-bold uppercase tracking-wide ${className}`}
      style={{ background: org.color.solid, color: org.color.onSolid }}
    >
      {org.nome}
    </span>
  );
}
