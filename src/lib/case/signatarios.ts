// Quem já assinou e quem falta num contrato enviado à ClickSign. Puro e testado:
// recebe o JSON do documento (GET /api/v1/documents/:key) e devolve a lista na
// ORDEM em que as pessoas assinam.

export type SituacaoAssinatura = "assinou" | "aguardando" | "na_fila";

export interface Signatario {
  nome: string;
  email: string;
  papel: "Contratante" | "Testemunha" | "Contratado";
  grupo: number;
  assinadoEm: string | null;
  situacao: SituacaoAssinatura;
}

function texto(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

function dataAssinatura(s: Record<string, unknown>): string | null {
  const sig = s.signature as Record<string, unknown> | null | undefined;
  return texto(sig?.signed_at) || texto(s.signed_at) || null;
}

/**
 * `contratadoEmail` separa o contratado (CS Agência) das demais partes: na
 * ClickSign ele e o cliente são os dois `contractor`.
 */
export function lerSignatarios(document: unknown, contratadoEmail: string): Signatario[] {
  const doc = (document ?? {}) as Record<string, unknown>;
  const lista = Array.isArray(doc.signers) ? (doc.signers as Array<Record<string, unknown>>) : [];
  const alvo = contratadoEmail.trim().toLowerCase();

  const base = lista.map((s) => {
    const email = texto(s.email);
    const papel: Signatario["papel"] =
      email.toLowerCase() === alvo ? "Contratado" : texto(s.sign_as) === "witness" ? "Testemunha" : "Contratante";
    const grupo = Number(s.group);
    return {
      nome: texto(s.name) || email,
      email,
      papel,
      grupo: Number.isFinite(grupo) && grupo > 0 ? grupo : 1,
      assinadoEm: dataAssinatura(s),
    };
  });

  // A vez é do MENOR grupo que ainda tem alguém sem assinar; os grupos acima
  // dele só são chamados pela ClickSign depois.
  const pendentes = base.filter((s) => !s.assinadoEm).map((s) => s.grupo);
  const vez = pendentes.length > 0 ? Math.min(...pendentes) : Infinity;

  return base
    .map((s) => ({
      ...s,
      situacao: (s.assinadoEm ? "assinou" : s.grupo <= vez ? "aguardando" : "na_fila") as SituacaoAssinatura,
    }))
    .sort((a, b) => a.grupo - b.grupo);
}
