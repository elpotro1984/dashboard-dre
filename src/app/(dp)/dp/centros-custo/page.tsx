import { redirect } from "next/navigation";

import { DP_CENTROS_PATH } from "@/lib/auth/dp";

// Centros de custo foi para Configurações em 22/10/2026; o endereço antigo segue valendo.
export default function DpCentrosCustoAntigo() {
  redirect(DP_CENTROS_PATH);
}
