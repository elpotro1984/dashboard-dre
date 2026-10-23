import { redirect } from "next/navigation";

import { getCaseUser } from "@/lib/case/auth";
import { getAgendaContracts, getAgendaImportados } from "@/lib/case/queries";
import { AgendaView } from "@/components/case/agenda-view";

export const dynamic = "force-dynamic";

export default async function CaseAgendaPage() {
  const ctx = await getCaseUser();
  if (!ctx) redirect("/login");

  const [contracts, importados] = await Promise.all([getAgendaContracts(), getAgendaImportados()]);

  // "Hoje" no fuso de São Paulo, calculado no servidor para o client não divergir na hidratação.
  const hoje = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date());

  return <AgendaView contracts={contracts} importados={importados} hoje={hoje} usuario={{ id: ctx.id, isAdmin: ctx.isAdmin }} />;
}
