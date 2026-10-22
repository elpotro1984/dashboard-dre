// Regras PURAS da empresa ativa do Compras (multiempresa): a seleção
// obrigatória a cada login, a guarda contra aba desencontrada e a cor que
// identifica cada empresa na tela. Sem import de servidor — usado pelo layout,
// pela rota /api/context, pelas server actions e pelos componentes client.

/**
 * `session_id` do access token do Supabase Auth (claim padrão dos JWTs do
 * Supabase). Só DECODIFICA — não verifica a assinatura: o usuário já foi
 * validado por `auth.getUser()` na sessão, e aqui o id serve apenas para saber
 * se a confirmação da empresa é deste login. Devolve null se não der para ler.
 */
export function sessionIdFromAccessToken(token: string | null | undefined): string | null {
  if (!token) return null;
  const part = token.split(".")[1];
  if (!part) return null;
  try {
    const b64 = part.replace(/-/g, "+").replace(/_/g, "/");
    const padded = b64 + "=".repeat((4 - (b64.length % 4)) % 4);
    // atob (não Buffer): este módulo também é importado por componentes client.
    const json = JSON.parse(atob(padded)) as { session_id?: unknown };
    return typeof json.session_id === "string" && json.session_id.length > 0 ? json.session_id : null;
  } catch {
    return null;
  }
}

/**
 * Chave da sessão de login usada para a confirmação. Sem session_id legível
 * cai no id do usuário: a seleção ainda é pedida uma vez, só deixa de ser
 * renovada a cada login (degradação aceitável — nunca prende numa repetição).
 */
export function confirmationKey(sessionId: string | null, userId: string): string {
  return sessionId ?? `user:${userId}`;
}

/**
 * A tela de seleção obrigatória aparece quando o usuário acessa MAIS DE UMA
 * empresa e ainda não confirmou a escolha NESTE login. Com uma empresa só não
 * há o que escolher. O cookie da última empresa (`active_ctrl_org`) sozinho não
 * libera: ele sobrevive entre logins, e é exatamente isso que levava a
 * trabalhar na empresa de ontem sem perceber.
 */
export function needsOrgConfirmation(input: {
  orgCount: number;
  confirmedKey: string | null;
  currentKey: string;
  /** O slug do cookie é de uma empresa que o usuário acessa. */
  cookieSlugValid: boolean;
}): boolean {
  if (input.orgCount <= 1) return false;
  if (!input.cookieSlugValid) return true;
  return input.confirmedKey !== input.currentKey;
}

export const ORG_NOT_CONFIRMED_ERROR =
  "Selecione a empresa em que você vai trabalhar antes de continuar. Recarregue a página.";

export const ORG_MISMATCH_ERROR =
  "A empresa ativa foi trocada (provavelmente em outra aba). Nada foi enviado. " +
  "Recarregue a página e confira a empresa antes de enviar de novo.";

/**
 * Guarda das ações que não têm volta (criar requisição, enviar à Omie): a tela
 * manda a empresa em que FOI ABERTA; se não for mais a ativa (troca em outra
 * aba), a ação é recusada. `expectedOrgId` ausente também recusa — falha
 * fechada, para um chamador novo não passar sem a guarda.
 */
export function activeOrgActionError(input: {
  orgCount: number;
  confirmed: boolean;
  activeOrgId: string | null;
  expectedOrgId: string | null | undefined;
}): string | null {
  if (input.orgCount > 1 && !input.confirmed) return ORG_NOT_CONFIRMED_ERROR;
  if (!input.expectedOrgId || input.expectedOrgId !== input.activeOrgId) return ORG_MISMATCH_ERROR;
  return null;
}

/** Paleta das empresas: cores bem distintas entre si, legíveis com texto branco. */
export interface CtrlOrgColor {
  /** Fundo sólido (faixa, chip). */
  solid: string;
  /** Texto sobre `solid`. */
  onSolid: string;
}

const PALETTE: CtrlOrgColor[] = [
  { solid: "#1d4ed8", onSolid: "#ffffff" }, // azul
  { solid: "#7e22ce", onSolid: "#ffffff" }, // roxo
  { solid: "#047857", onSolid: "#ffffff" }, // verde
  { solid: "#c2410c", onSolid: "#ffffff" }, // laranja
  { solid: "#be123c", onSolid: "#ffffff" }, // vermelho
  { solid: "#0e7490", onSolid: "#ffffff" }, // ciano
  { solid: "#a16207", onSolid: "#ffffff" }, // âmbar
  { solid: "#4338ca", onSolid: "#ffffff" }, // índigo
];

// Empresas conhecidas com cor fixa — a mesma para todo usuário, qualquer que
// seja a lista de empresas que ele enxerga. As demais caem no hash do slug.
const FIXED: Record<string, number> = {
  "viva-company": 0,
  "feat-producoes": 1,
};

export function ctrlOrgColor(slug: string | null | undefined): CtrlOrgColor {
  if (!slug) return PALETTE[0];
  const fixed = FIXED[slug];
  if (fixed !== undefined) return PALETTE[fixed];
  let h = 0;
  for (let i = 0; i < slug.length; i++) h = (h * 31 + slug.charCodeAt(i)) >>> 0;
  return PALETTE[h % PALETTE.length];
}
