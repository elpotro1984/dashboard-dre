// ============================================================================
// Grupo do TIPO DE CONTRATO da Sólides — puro e testado. Usado pelas
// Simulações (que custo leva encargo) e pelo vínculo (alerta de experiência,
// só CLT). Morava em `indicadores.ts`, que saiu com a tela de Indicadores em
// 27/10/2026.
// ============================================================================

export type DpGrupoContrato = "clt" | "socio" | "prestador" | "estagio" | "outro";

function semAcento(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
}

/** Os rótulos da Sólides vistos em 29/09/2026: CLT, Sócio, Prestador de Serviço, Estagiário, Jovem Aprendiz. */
export function grupoContrato(tipo: string | null): DpGrupoContrato {
  const t = semAcento(tipo ?? "");
  if (!t) return "outro";
  if (t.includes("clt")) return "clt";
  if (t.includes("socio")) return "socio";
  if (t.includes("prestador")) return "prestador";
  if (t.includes("estag") || t.includes("aprendiz")) return "estagio";
  return "outro";
}
