import assert from "node:assert/strict";
import { test } from "node:test";

import { grupoContrato } from "@/lib/dp/contrato";

test("grupoContrato: rótulos da Sólides, com e sem acento", () => {
  assert.equal(grupoContrato("CLT"), "clt");
  assert.equal(grupoContrato("Sócio"), "socio");
  assert.equal(grupoContrato("Prestador de Serviço"), "prestador");
  assert.equal(grupoContrato("Estagiário"), "estagio");
  assert.equal(grupoContrato("Jovem Aprendiz"), "estagio");
  assert.equal(grupoContrato(null), "outro");
});
