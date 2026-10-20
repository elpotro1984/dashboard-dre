// Testemunhas que assinam pela ClickSign: só quem tem e-mail. Sem e-mail a
// testemunha sai apenas impressa no PDF. Usado pela validação do formulário e
// pelo envio, para os dois concordarem sobre quem assina.

export interface TestemunhasDoContrato {
  testemunha_1_nome: string | null;
  testemunha_1_cpf: string | null;
  testemunha_1_email: string | null;
  testemunha_2_nome: string | null;
  testemunha_2_cpf: string | null;
  testemunha_2_email: string | null;
}

export interface TestemunhaAssinante {
  /** 1 ou 2 — o número que a tela usa, mesmo quando só a 2 assina. */
  ordem: 1 | 2;
  nome: string | null;
  cpf: string | null;
  email: string;
}

export function testemunhasQueAssinam(c: TestemunhasDoContrato): TestemunhaAssinante[] {
  return [
    { ordem: 1 as const, nome: c.testemunha_1_nome, cpf: c.testemunha_1_cpf, email: c.testemunha_1_email },
    { ordem: 2 as const, nome: c.testemunha_2_nome, cpf: c.testemunha_2_cpf, email: c.testemunha_2_email },
  ]
    .map((t) => ({ ordem: t.ordem, nome: t.nome?.trim() || null, cpf: t.cpf?.trim() || null, email: t.email?.trim() ?? "" }))
    .filter((t) => t.email !== "");
}
