"use client";

import { EmpresaAtivaBanner } from "@/components/app/empresa-ativa-banner";

interface CtrlOrgOption {
  id: string;
  nome: string;
  slug: string;
}

// Mesmo nome de ACTIVE_CTRL_ORG_COOKIE (active-context.ts, que é server-only
// por importar next/headers) — manter os dois em sincronia.
const ACTIVE_CTRL_ORG_COOKIE = "active_ctrl_org";

/**
 * Grava a empresa ativa do Compras E a confirmação deste login (/api/context) e
 * recarrega a página inteira. Recarga inteira, não router.refresh(): formulário
 * meio preenchido com setor/fornecedor da empresa anterior não pode sobreviver
 * à troca.
 */
export async function switchCtrlOrg(slug: string): Promise<boolean> {
  const res = await fetch("/api/context", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ctrlOrgSlug: slug }),
  });
  if (!res.ok) return false;
  window.location.reload();
  return true;
}

/**
 * Faixa da EMPRESA ATIVA do Compras (o desenho é o `EmpresaAtivaBanner`,
 * compartilhado com o Departamento Pessoal). O servidor também recusa o envio
 * feito de uma aba desencontrada — ver ctrlActiveOrgError; a faixa é o aviso
 * antes do clique.
 */
export function CtrlOrgBanner({ orgs, activeSlug }: { orgs: CtrlOrgOption[]; activeSlug: string | null }) {
  return (
    <EmpresaAtivaBanner
      opcoes={orgs.map((o) => ({ chave: o.slug, nome: o.nome }))}
      ativaChave={activeSlug}
      cookie={ACTIVE_CTRL_ORG_COOKIE}
      modulo="Compras"
      oQueMuda="Requisições e envios à Omie"
      trocar={switchCtrlOrg}
    />
  );
}
