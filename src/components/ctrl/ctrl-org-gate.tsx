"use client";

import { switchCtrlOrg } from "@/components/app/ctrl-org-switcher";
import { EmpresaAtivaGate } from "@/components/app/empresa-ativa-gate";

interface CtrlOrgOption {
  id: string;
  nome: string;
  slug: string;
}

/**
 * Seleção OBRIGATÓRIA da empresa do Compras, a cada login, para quem acessa
 * mais de uma empresa (o desenho é o `EmpresaAtivaGate`, compartilhado com o
 * Departamento Pessoal). O layout do Compras renderiza isto NO LUGAR da página.
 */
export function CtrlOrgGate({ orgs, lastSlug }: { orgs: CtrlOrgOption[]; lastSlug: string | null }) {
  return (
    <EmpresaAtivaGate
      opcoes={orgs.map((o) => ({ chave: o.slug, nome: o.nome }))}
      ultimaChave={lastSlug}
      descricao="Requisições, aprovações e envios à Omie desta sessão serão feitos na empresa escolhida. Você pode trocar depois pela faixa no topo da tela."
      trocar={switchCtrlOrg}
    />
  );
}
