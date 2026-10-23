"use server";

import { revalidatePath } from "next/cache";
import type { SupabaseClient } from "@supabase/supabase-js";

import { createClient } from "@/lib/supabase/server";
import { createAdminClientIfAvailable } from "@/lib/supabase/admin";
import { requireCaseUser } from "@/lib/case/auth";
import { CASE_RESUMO_EMAIL_TO, CONTRATADO_SIGNER } from "@/lib/case/contract-config";
import { getContractDetail } from "@/lib/case/queries";
import { lerSignatarios, type Signatario } from "@/lib/case/signatarios";
import {
  limitarAnexos,
  montarResumoContrato,
  nomeDeArquivo,
  planoDeAnexos,
  type AnexoResumo,
  type HistoricoItem,
} from "@/lib/case/resumo-email";
import { resolveAppUrl } from "@/lib/app-url";
import { sendEmailViaResend, type ResendAttachment } from "@/lib/email/resend";

const ATTACHMENT_BUCKET = "case-attachments";
/** 40 MB do Resend já em base64 (+33%) → ~30 MB crus; folga para o HTML. */
const TETO_ANEXOS_BYTES = 28 * 1024 * 1024;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type DB = SupabaseClient<any>;

async function getDb(): Promise<DB> {
  return (createAdminClientIfAvailable() as DB | null) ?? ((await createClient()) as DB);
}

const CONTENT_TYPE: Record<string, string> = {
  pdf: "application/pdf",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
};
const contentTypeDe = (nome: string) => CONTENT_TYPE[nome.split(".").pop()?.toLowerCase() ?? ""] ?? "application/octet-stream";

interface Arquivo {
  nome: string;
  content: Buffer;
  tamanho: number;
}

async function baixarDoBucket(db: DB, path: string): Promise<Buffer | null> {
  const { data, error } = await db.storage.from(ATTACHMENT_BUCKET).download(path);
  if (error || !data) {
    console.error("[case/resumo-email] falha ao baixar", path, error?.message);
    return null;
  }
  return Buffer.from(await data.arrayBuffer());
}

/**
 * Signatários e PDF ASSINADO, lidos da ClickSign. O PDF do bucket é o gerado
 * antes da assinatura — a versão com as assinaturas só existe lá. Best-effort:
 * sem ClickSign o e-mail sai com o PDF do bucket e sem a seção de assinaturas.
 */
async function lerClickSign(
  documentKey: string | null,
  assinado: boolean,
): Promise<{ signatarios: Signatario[] | null; pdfAssinado: Buffer | null }> {
  if (!documentKey) return { signatarios: null, pdfAssinado: null };
  const { getDocument, clicksignEnabled } = await import("@/lib/case/clicksign");
  if (!clicksignEnabled()) return { signatarios: null, pdfAssinado: null };
  try {
    const doc = await getDocument(documentKey);
    const signatarios = lerSignatarios(doc, CONTRATADO_SIGNER.email);
    const downloads = (doc.downloads ?? {}) as Record<string, unknown>;
    const url = typeof downloads.signed_file_url === "string" ? downloads.signed_file_url : null;
    let pdfAssinado: Buffer | null = null;
    if (assinado && url) {
      const res = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(30_000) });
      if (res.ok) pdfAssinado = Buffer.from(await res.arrayBuffer());
      else console.error("[case/resumo-email] PDF assinado: HTTP", res.status);
    }
    return { signatarios: signatarios.length > 0 ? signatarios : null, pdfAssinado };
  } catch (e) {
    console.error("[case/resumo-email] ClickSign:", e);
    return { signatarios: null, pdfAssinado: null };
  }
}

const hojeEmBrasilia = () => new Date().toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" });

/**
 * Manda o resumo completo do contrato (dados, valores, atrações, pagamentos,
 * histórico e o que falta) com os contratos em anexo para CASE_RESUMO_EMAIL_TO.
 * O destinatário nunca vem do client. Responder ao e-mail cai em quem enviou.
 */
export async function enviarResumoPorEmail(
  contractId: string,
): Promise<{ ok: true; para: string; anexados: number; foraDoAnexo: string[] } | { error: string }> {
  const ctx = await requireCaseUser();
  const detail = await getContractDetail(contractId);
  if (!detail) return { error: "Contrato não encontrado." };

  const db = await getDb();
  const [{ data: historicoRows }, { data: extra }] = await Promise.all([
    db
      .from("case_history")
      .select("action, comment, created_at, users(name, email)")
      .eq("contract_id", contractId)
      .order("created_at"),
    db.from("case_contracts").select("clicksign_document_key").eq("id", contractId).maybeSingle(),
  ]);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const historico: HistoricoItem[] = ((historicoRows ?? []) as any[]).map((h) => ({
    action: String(h.action),
    comment: h.comment ?? null,
    created_at: h.created_at,
    user_name: h.users?.name || h.users?.email || null,
  }));

  const documentKey = (extra as { clicksign_document_key: string | null } | null)?.clicksign_document_key ?? null;
  const { signatarios, pdfAssinado } = await lerClickSign(documentKey, Boolean(detail.signed_at));

  // Ordem = prioridade no corte por tamanho: o contrato com o cliente primeiro.
  const arquivos: Arquivo[] = [];
  const naoEncontrados: AnexoResumo[] = [];
  const contratoCliente = `Contrato ${detail.contract_number} - cliente${pdfAssinado ? " (assinado)" : ""}`;
  if (pdfAssinado) {
    arquivos.push({ nome: nomeDeArquivo(contratoCliente, "x.pdf"), content: pdfAssinado, tamanho: pdfAssinado.length });
  } else if (detail.sale_contract_path) {
    const buf = await baixarDoBucket(db, detail.sale_contract_path);
    const nome = nomeDeArquivo(contratoCliente, detail.sale_contract_path);
    if (buf) arquivos.push({ nome, content: buf, tamanho: buf.length });
    else naoEncontrados.push({ nome, anexado: false, motivo: "arquivo não encontrado" });
  }
  for (const a of planoDeAnexos(detail)) {
    const buf = await baixarDoBucket(db, a.path);
    if (buf) arquivos.push({ nome: a.nome, content: buf, tamanho: buf.length });
    else naoEncontrados.push({ nome: a.nome, anexado: false, motivo: "arquivo não encontrado" });
  }
  const { dentro, fora } = limitarAnexos(arquivos, TETO_ANEXOS_BYTES);

  const anexos: AnexoResumo[] = [
    ...dentro.map((a) => ({ nome: a.nome, anexado: true })),
    ...fora.map((a) => ({ nome: a.nome, anexado: false, motivo: "e-mail ficaria grande demais" })),
    ...naoEncontrados,
  ];

  const { subject, html } = montarResumoContrato({
    detail,
    historico,
    signatarios,
    hoje: hojeEmBrasilia(),
    appUrl: resolveAppUrl(),
    enviadoPor: ctx.name || ctx.email,
    enviadoEm: new Date().toISOString(),
    anexos,
  });

  const attachments: ResendAttachment[] = dentro.map((a) => ({
    filename: a.nome,
    content: a.content,
    contentType: contentTypeDe(a.nome),
  }));

  const res = await sendEmailViaResend({ to: CASE_RESUMO_EMAIL_TO, subject, html, replyTo: ctx.email, attachments });
  if (!res.ok) return { error: res.error ?? "Falha ao enviar o e-mail." };

  // O e-mail já saiu: falha ao gravar a marca só vai ao log, nunca vira "não enviado".
  const agora = new Date().toISOString();
  const [{ error: erroMarca }, { error: erroHistorico }] = await Promise.all([
    db.from("case_contracts").update({ resumo_enviado_em: agora, resumo_enviado_por: ctx.id }).eq("id", contractId),
    db.from("case_history").insert({
      contract_id: contractId,
      user_id: ctx.id,
      action: "resumo_enviado",
      comment: `Resumo enviado por e-mail para ${CASE_RESUMO_EMAIL_TO} (${dentro.length} contrato(s) anexado(s)).`,
    }),
  ]);
  if (erroMarca) console.error("[case/resumo-email] falha ao marcar o envio:", erroMarca.message);
  if (erroHistorico) console.error("[case/resumo-email] falha ao registrar no histórico:", erroHistorico.message);
  revalidatePath(`/case/contratos/${contractId}`);

  return {
    ok: true,
    para: CASE_RESUMO_EMAIL_TO,
    anexados: dentro.length,
    foraDoAnexo: anexos.filter((a) => !a.anexado).map((a) => a.nome),
  };
}
