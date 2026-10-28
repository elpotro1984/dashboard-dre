import * as XLSX from "xlsx";

import { fetchSheetValues, type SheetRow } from "@/lib/sheets/client";
import { DRIVE_READONLY_SCOPE, getGoogleAccessToken } from "@/lib/sheets/google-auth";

// Lê um range de uma planilha que pode ser NATIVA do Google ou um arquivo
// Office (.xlsx) guardado no Drive e aberto no editor do Sheets. Os dois têm o
// mesmo link docs.google.com/spreadsheets/d/<id>, mas a API do Sheets recusa o
// segundo ("The document must not be an Office file", 400 FAILED_PRECONDITION).
// Nesse caso o arquivo é baixado pela API do Drive e lido com o SheetJS.
//
// Para o caminho do Drive funcionar, duas coisas fora do código: a API do
// Google Drive LIGADA no projeto do service account e o arquivo compartilhado
// (leitura) com o e-mail dele. `describeGoogleReadError` traduz as duas falhas.

const DRIVE_FILES = "https://www.googleapis.com/drive/v3/files";

export function isOfficeFileError(err: unknown): boolean {
  return err instanceof Error && /must not be an Office file/i.test(err.message);
}

/** Baixa o conteúdo cru de um arquivo do Drive (só leitura). */
export async function fetchDriveFileBytes(fileId: string): Promise<Buffer> {
  const token = await getGoogleAccessToken(DRIVE_READONLY_SCOPE);
  const url = `${DRIVE_FILES}/${encodeURIComponent(fileId)}?alt=media&supportsAllDrives=true`;
  const response = await fetch(url, {
    headers: { authorization: `Bearer ${token}` },
    cache: "no-store",
  });
  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`Drive API ${response.status} ao baixar ${fileId}: ${body}`);
  }
  return Buffer.from(await response.arrayBuffer());
}

/**
 * Range A1 ("A1:B3") de uma aba, como matriz de valores crus — o mesmo formato
 * de `fetchSheetValues` (números como number, datas como serial).
 */
export async function fetchSheetOrOfficeValues(
  fileId: string,
  tabTitle: string,
  a1Range: string,
): Promise<SheetRow[]> {
  try {
    return await fetchSheetValues(fileId, `'${tabTitle.replace(/'/g, "''")}'!${a1Range}`);
  } catch (err) {
    if (!isOfficeFileError(err)) throw err;
  }

  const bytes = await fetchDriveFileBytes(fileId);
  // Só a aba pedida é montada; o resto da pasta de trabalho é ignorado.
  const workbook = XLSX.read(bytes, { type: "buffer", sheets: [tabTitle] });
  const sheet = workbook.Sheets[tabTitle];
  if (!sheet) {
    throw new Error(
      `Aba "${tabTitle}" não encontrada no arquivo ${fileId} (abas: ${workbook.SheetNames.join(", ")})`,
    );
  }
  return XLSX.utils.sheet_to_json<SheetRow>(sheet, {
    header: 1,
    range: a1Range,
    raw: true,
    defval: null,
    blankrows: true,
  });
}

/**
 * Frase curta, em português, para a falha de leitura — o que aparece na tela.
 * O erro técnico completo vai para o log.
 */
export function describeGoogleReadError(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err);
  if (/drive\.googleapis\.com|Google Drive API has not been used|it is disabled/i.test(msg)) {
    return "a API do Google Drive está desligada no projeto da conta de serviço";
  }
  if (/\b(403|404)\b/.test(msg)) {
    return "a planilha não está compartilhada com a conta de serviço do Control Hub";
  }
  if (/Aba ".*" não encontrada|Unable to parse range/i.test(msg)) {
    return "a aba da planilha não foi encontrada";
  }
  if (/GOOGLE_SHEETS_SERVICE_ACCOUNT_JSON/.test(msg)) {
    return "a conta de serviço do Google não está configurada";
  }
  return "o Google não respondeu";
}
