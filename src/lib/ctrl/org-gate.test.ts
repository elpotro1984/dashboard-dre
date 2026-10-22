import assert from "node:assert/strict";
import { test } from "node:test";

import {
  activeOrgActionError,
  confirmationKey,
  ctrlOrgColor,
  needsOrgConfirmation,
  ORG_MISMATCH_ERROR,
  ORG_NOT_CONFIRMED_ERROR,
  sessionIdFromAccessToken,
} from "./org-gate";

function jwt(payload: object): string {
  const b64 = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `eyJhbGciOiJIUzI1NiJ9.${b64}.assinatura`;
}

test("sessionIdFromAccessToken: lê o claim session_id (base64url sem padding)", () => {
  assert.equal(sessionIdFromAccessToken(jwt({ sub: "u1", session_id: "abc-123" })), "abc-123");
});

test("sessionIdFromAccessToken: token ausente, malformado ou sem claim → null", () => {
  assert.equal(sessionIdFromAccessToken(null), null);
  assert.equal(sessionIdFromAccessToken("nao-e-jwt"), null);
  assert.equal(sessionIdFromAccessToken("a.%%%.c"), null);
  assert.equal(sessionIdFromAccessToken(jwt({ sub: "u1" })), null);
});

test("confirmationKey: sem session_id cai no usuário (nunca prende em repetição)", () => {
  assert.equal(confirmationKey("s1", "u1"), "s1");
  assert.equal(confirmationKey(null, "u1"), "user:u1");
});

test("needsOrgConfirmation: uma empresa só nunca pergunta", () => {
  assert.equal(
    needsOrgConfirmation({ orgCount: 1, confirmedKey: null, currentKey: "s1", cookieSlugValid: false }),
    false,
  );
});

test("needsOrgConfirmation: várias empresas — pergunta até confirmar NESTE login", () => {
  const base = { orgCount: 2, currentKey: "s2", cookieSlugValid: true };
  assert.equal(needsOrgConfirmation({ ...base, confirmedKey: null }), true);
  // confirmou no login anterior (cookie da última empresa ainda existe): pergunta de novo
  assert.equal(needsOrgConfirmation({ ...base, confirmedKey: "s1" }), true);
  assert.equal(needsOrgConfirmation({ ...base, confirmedKey: "s2" }), false);
});

test("needsOrgConfirmation: cookie apontando para empresa sem acesso pergunta", () => {
  assert.equal(
    needsOrgConfirmation({ orgCount: 3, confirmedKey: "s1", currentKey: "s1", cookieSlugValid: false }),
    true,
  );
});

test("activeOrgActionError: empresa da tela ≠ empresa ativa (outra aba) recusa", () => {
  const base = { orgCount: 2, confirmed: true, activeOrgId: "org-b" };
  assert.equal(activeOrgActionError({ ...base, expectedOrgId: "org-b" }), null);
  assert.equal(activeOrgActionError({ ...base, expectedOrgId: "org-a" }), ORG_MISMATCH_ERROR);
});

test("activeOrgActionError: sem empresa esperada falha fechada", () => {
  const base = { orgCount: 1, confirmed: true, activeOrgId: "org-a" };
  assert.equal(activeOrgActionError({ ...base, expectedOrgId: undefined }), ORG_MISMATCH_ERROR);
  assert.equal(activeOrgActionError({ ...base, expectedOrgId: null }), ORG_MISMATCH_ERROR);
});

test("activeOrgActionError: várias empresas sem confirmação recusa antes de comparar", () => {
  assert.equal(
    activeOrgActionError({ orgCount: 2, confirmed: false, activeOrgId: "org-a", expectedOrgId: "org-a" }),
    ORG_NOT_CONFIRMED_ERROR,
  );
});

test("ctrlOrgColor: Viva e Feat têm cores fixas e diferentes; slug desconhecido é estável", () => {
  assert.notEqual(ctrlOrgColor("viva-company").solid, ctrlOrgColor("feat-producoes").solid);
  assert.deepEqual(ctrlOrgColor("empresa-x"), ctrlOrgColor("empresa-x"));
  assert.ok(ctrlOrgColor(null).solid.startsWith("#"));
});
