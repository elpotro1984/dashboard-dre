import { redirect } from "next/navigation";

import { DP_FOLHA_PATH } from "@/lib/auth/dp";

/**
 * Raiz do módulo. A "Visão geral" (e todo o grupo DP · VISÃO DO GRUPO: Visão
 * geral, Indicadores e Folha do grupo) saiu em 27/10/2026, a pedido do dono do
 * projeto, para ser refeita depois. A rota fica porque o seletor de módulos, o
 * middleware e as telas que recusam acesso mandam para `/dp` — agora ela abre a
 * Folha do mês, o primeiro item do menu do DP. A sincronização com a Sólides
 * segue em Configurações.
 */
export default function DpRaizPage() {
  redirect(DP_FOLHA_PATH);
}
