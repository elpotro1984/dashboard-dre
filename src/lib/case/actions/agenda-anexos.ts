"use server";

import { revalidatePath } from "next/cache";
import type { SupabaseClient } from "@supabase/supabase-js";

import { createClient } from "@/lib/supabase/server";
import { createAdminClientIfAvailable } from "@/lib/supabase/admin";
import { requireCaseUser } from "@/lib/case/auth";
import type { ContratoImportado } from "@/lib/case/queries";

const ATTACHMENT_BUCKET = "case-attachments";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type DB = SupabaseClient<any>;

async function getDb(): Promise<DB> {
  return (createAdminClientIfAvailable() as DB | null) ?? ((await createClient()) as DB);
}

// A gravação e a leitura usam service role (ignoram a policy do bucket), então
// a pasta `<uid>/` de quem subiu — regra do upload — é conferida antes.
function ownsAttachment(userId: string, path: string): boolean {
  return path.startsWith(`${userId}/`) && !path.includes("..");
}

function mensagemTabelaAusente(code: string | undefined): string | null {
  return code === "42P01" ? "Anexar contratos ainda não está disponível (migration pendente)." : null;
}

/** Vincula um arquivo já enviado ao bucket a um evento importado do Trello. */
export async function anexarContratoImportado(
  importadoId: string,
  path: string,
  nome: string,
  tamanho: number | null,
): Promise<{ contrato: ContratoImportado } | { error: string }> {
  const ctx = await requireCaseUser();
  if (!ownsAttachment(ctx.id, path)) return { error: "Arquivo não pertence a este usuário." };
  const db = await getDb();

  const { data: evento } = await db.from("case_agenda_importada").select("id").eq("id", importadoId).maybeSingle();
  if (!evento) {
    await db.storage.from(ATTACHMENT_BUCKET).remove([path]);
    return { error: "Evento não encontrado." };
  }

  const { data, error } = await db
    .from("case_agenda_importada_anexos")
    .insert({ importado_id: importadoId, nome: nome.trim() || "contrato", path, tamanho, enviado_por: ctx.id })
    .select("id, nome, tamanho, enviado_por, enviado_em")
    .single();
  if (error || !data) {
    // Sem a linha, o arquivo no bucket ficaria órfão e invisível.
    await db.storage.from(ATTACHMENT_BUCKET).remove([path]);
    return { error: mensagemTabelaAusente(error?.code) ?? "Não foi possível anexar o contrato." };
  }

  revalidatePath("/case/agenda");
  return { contrato: { ...data, enviado_por_nome: ctx.name ?? ctx.email } as ContratoImportado };
}

/** URL assinada (5 min) de um contrato anexado a evento importado. */
export async function abrirContratoImportado(anexoId: string): Promise<{ url: string } | { error: string }> {
  await requireCaseUser();
  const db = await getDb();
  const { data } = await db.from("case_agenda_importada_anexos").select("path").eq("id", anexoId).maybeSingle();
  if (!data?.path) return { error: "Arquivo não encontrado." };
  const { data: signed, error } = await db.storage.from(ATTACHMENT_BUCKET).createSignedUrl(data.path as string, 60 * 5);
  if (error || !signed?.signedUrl) return { error: "Falha ao gerar link do arquivo." };
  return { url: signed.signedUrl };
}

/** Remove um contrato anexado. Só quem subiu ou um admin. */
export async function removerContratoImportado(anexoId: string): Promise<{ ok: true } | { error: string }> {
  const ctx = await requireCaseUser();
  const db = await getDb();
  const { data } = await db
    .from("case_agenda_importada_anexos")
    .select("path, enviado_por")
    .eq("id", anexoId)
    .maybeSingle();
  if (!data) return { error: "Arquivo não encontrado." };
  if (!ctx.isAdmin && data.enviado_por !== ctx.id) return { error: "Só quem anexou ou um administrador pode remover." };

  const { error } = await db.from("case_agenda_importada_anexos").delete().eq("id", anexoId);
  if (error) return { error: "Não foi possível remover o contrato." };
  // Melhor esforço: a linha já saiu, então o arquivo não aparece mais em lugar nenhum.
  const { error: stErr } = await db.storage.from(ATTACHMENT_BUCKET).remove([data.path as string]);
  if (stErr) console.error("[case] remover arquivo de evento importado:", stErr.message);

  revalidatePath("/case/agenda");
  return { ok: true };
}
