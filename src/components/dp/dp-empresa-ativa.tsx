"use client";

import { EmpresaAtivaBanner, type EmpresaAtivaOpcao } from "@/components/app/empresa-ativa-banner";
import { EmpresaAtivaGate } from "@/components/app/empresa-ativa-gate";

interface DpEmpresaOption {
  id: string;
  name: string;
  ativos: number;
}

// Mesmo nome de ACTIVE_DP_EMPRESA_COOKIE (active-context.ts, que é server-only
// por importar next/headers) — manter os dois em sincronia.
const ACTIVE_DP_EMPRESA_COOKIE = "active_dp_empresa";

/**
 * Grava a empresa ativa do DP E a confirmação deste login (/api/context) e
 * recarrega a página inteira — mesma regra do Compras: lançamento meio
 * digitado na empresa anterior não pode sobreviver à troca.
 */
export async function switchDpEmpresa(id: string): Promise<boolean> {
  const res = await fetch("/api/context", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ dpEmpresaId: id }),
  });
  if (!res.ok) return false;
  window.location.reload();
  return true;
}

function opcoes(empresas: DpEmpresaOption[]): EmpresaAtivaOpcao[] {
  return empresas.map((e) => ({
    chave: e.id,
    nome: e.name,
    detalhe: e.ativos === 0 ? "sem colaboradores na Sólides" : e.ativos === 1 ? "1 colaborador" : `${e.ativos} colaboradores`,
  }));
}

const O_QUE_MUDA = "Lançamentos da folha, cadastros e simulações";

/**
 * Faixa da EMPRESA ATIVA do Departamento Pessoal — o esquema do Compras
 * (`EmpresaAtivaBanner`). A lista já vem recortada pelo que a pessoa pode ver.
 * Diferente do Compras, o servidor não precisa recusar o envio de uma aba
 * desencontrada: toda action do DP recebe a empresa da PRÓPRIA tela
 * (`requireDpEmpresa(companyId)`), então grava na empresa que a aba mostra.
 */
export function DpEmpresaBanner({ empresas, activeId }: { empresas: DpEmpresaOption[]; activeId: string | null }) {
  return (
    <EmpresaAtivaBanner
      opcoes={opcoes(empresas)}
      ativaChave={activeId}
      cookie={ACTIVE_DP_EMPRESA_COOKIE}
      modulo="Departamento Pessoal"
      oQueMuda={O_QUE_MUDA}
      trocar={switchDpEmpresa}
    />
  );
}

/** Seleção OBRIGATÓRIA da empresa do DP a cada login, para quem vê mais de uma. */
export function DpEmpresaGate({ empresas, lastId }: { empresas: DpEmpresaOption[]; lastId: string | null }) {
  return (
    <EmpresaAtivaGate
      opcoes={opcoes(empresas)}
      ultimaChave={lastId}
      descricao={`${O_QUE_MUDA} desta sessão serão feitos na empresa escolhida. Você pode trocar depois pela faixa no topo da tela.`}
      trocar={switchDpEmpresa}
    />
  );
}
