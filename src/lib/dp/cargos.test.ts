import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";

import {
  chaveCargo,
  chaveNome,
  enquadrar,
  lerSenioridade,
  lerStep,
  nomeCargo,
  normalizarCargo,
  rotuloLinha,
  salarioForaDaTabela,
  SENIORIDADES,
  separarCargo,
  STEPS,
  sugerirLinha,
  textoAlertaTabela,
  type DpLinhaSalarial,
} from "@/lib/dp/cargos";

test("chaveNome: caixa, acento, (a) e espaços não importam", () => {
  assert.equal(chaveNome("Consultor(a) de  Relacionamento Sênior II"), "consultor de relacionamento senior ii");
  assert.equal(chaveNome(" Analista  Comercial "), chaveNome("analista comercial"));
});

// ── Cargo | Senioridade | Step ──────────────────────────────────────────────

test("separarCargo: os dois exemplos do pedido", () => {
  assert.deepEqual(separarCargo("Analista de Relacionamento JÚNIOR I"), { cargo: "Analista de Relacionamento", senioridade: "Júnior", step: "I" });
  assert.deepEqual(separarCargo("Assistente de Relacionamento I"), { cargo: "Assistente de Relacionamento", senioridade: "", step: "I" });
});

test("separarCargo: as formas que existem na tabela de hoje", () => {
  assert.deepEqual(separarCargo("Coordenador PLENO III"), { cargo: "Coordenador", senioridade: "Pleno", step: "III" });
  assert.deepEqual(separarCargo("Analista Financeiro SENIOR V"), { cargo: "Analista Financeiro", senioridade: "Sênior", step: "V" });
  assert.deepEqual(separarCargo("Consultor Sênior II"), { cargo: "Consultor", senioridade: "Sênior", step: "II" });
  assert.deepEqual(separarCargo("Estagiário(a)"), { cargo: "Estagiário(a)", senioridade: "", step: "" });
  // Senioridade no MEIO do nome: sai dali e o resto do nome fica.
  assert.deepEqual(separarCargo("Consultor de Performace e Vendas Sênior (Sócio) I"), {
    cargo: "Consultor de Performace e Vendas (Sócio)",
    senioridade: "Sênior",
    step: "I",
  });
  assert.deepEqual(separarCargo("Analista Growth JÚNIOR PJ IV"), { cargo: "Analista Growth PJ", senioridade: "Júnior", step: "IV" });
});

test("separarCargo: não inventa senioridade nem step", () => {
  // Duas palavras de senioridade não decidem nada.
  assert.deepEqual(separarCargo("Analista Júnior/Pleno"), { cargo: "Analista Júnior/Pleno", senioridade: "", step: "" });
  assert.deepEqual(separarCargo("Analista Júnior a Sênior II"), { cargo: "Analista Júnior a Sênior", senioridade: "", step: "II" });
  // O cargo nunca fica vazio.
  assert.deepEqual(separarCargo("Sênior"), { cargo: "Sênior", senioridade: "", step: "" });
  assert.deepEqual(separarCargo("V"), { cargo: "V", senioridade: "", step: "" });
  // Número no fim não é step (step é romano), e o separador que sobra sai.
  assert.deepEqual(separarCargo("Auxiliar Administrativo 2"), { cargo: "Auxiliar Administrativo 2", senioridade: "", step: "" });
  assert.deepEqual(separarCargo("Analista - Júnior - II"), { cargo: "Analista", senioridade: "Júnior", step: "II" });
  // Abreviação no meio do nome não conta ("Sr" pode ser outra coisa); na coluna, conta.
  assert.deepEqual(separarCargo("Analista Jr I"), { cargo: "Analista Jr", senioridade: "", step: "I" });
});

test("nomeCargo: junta as três partes de volta", () => {
  assert.equal(nomeCargo({ cargo: "Analista de Relacionamento", senioridade: "Júnior", step: "I" }), "Analista de Relacionamento Júnior I");
  assert.equal(nomeCargo({ cargo: "Assistente", senioridade: "", step: "II" }), "Assistente II");
  assert.equal(nomeCargo({ cargo: "Estagiário(a)", senioridade: "", step: "" }), "Estagiário(a)");
});

test("lerSenioridade e lerStep: as células da planilha", () => {
  assert.equal(lerSenioridade(""), "");
  assert.equal(lerSenioridade("JUNIOR"), "Júnior");
  assert.equal(lerSenioridade("jr."), "Júnior");
  assert.equal(lerSenioridade("Sr"), "Sênior");
  assert.equal(lerSenioridade("pleno"), "Pleno");
  assert.equal(lerSenioridade("Trainee"), null);
  assert.equal(lerStep(""), "");
  assert.equal(lerStep("iii"), "III");
  assert.equal(lerStep(2), "II"); // o step em número de 02/10/2026
  assert.equal(lerStep("5"), "V");
  assert.equal(lerStep("0"), null);
  assert.equal(lerStep("21"), null);
  assert.equal(lerStep("A"), null);
});

test("normalizarCargo: com coluna, o nome é gravado como está", () => {
  const doNome = { senioridade: false, step: false };
  // "Técnico em Raio X" não perde o X: quem preencheu as colunas já separou.
  assert.deepEqual(normalizarCargo({ cargo: "Técnico em Raio X", senioridade: "", step: "" }, doNome), {
    ok: { cargo: "Técnico em Raio X", senioridade: "", step: "" },
  });
  assert.deepEqual(normalizarCargo({ cargo: " Analista  Comercial ", senioridade: "pleno", step: "2" }, doNome), {
    ok: { cargo: "Analista Comercial", senioridade: "Pleno", step: "II" },
  });
  assert.ok("erro" in normalizarCargo({ cargo: "Analista", senioridade: "Trainee", step: "" }, doNome));
  assert.ok("erro" in normalizarCargo({ cargo: "Analista", senioridade: "", step: "A" }, doNome));
  assert.ok("erro" in normalizarCargo({ cargo: "  ", senioridade: "", step: "I" }, doNome));
});

test("normalizarCargo: sem coluna, separa do nome — e nome × coluna diferentes é recusado", () => {
  const tudo = { senioridade: true, step: true };
  assert.deepEqual(normalizarCargo({ cargo: "Analista de Relacionamento JÚNIOR I" }, tudo), {
    ok: { cargo: "Analista de Relacionamento", senioridade: "Júnior", step: "I" },
  });
  // Só o step em coluna: a senioridade sai do nome, o step é o da coluna.
  assert.deepEqual(normalizarCargo({ cargo: "Analista PLENO", step: 3 }, { senioridade: true, step: false }), {
    ok: { cargo: "Analista", senioridade: "Pleno", step: "III" },
  });
  // Mesma informação nos dois lugares é aceita; diferente, não.
  assert.ok("ok" in normalizarCargo({ cargo: "Analista Pleno II", senioridade: "Pleno", step: "II" }, tudo));
  assert.match((normalizarCargo({ cargo: "Analista Pleno II", senioridade: "Sênior" }, tudo) as { erro: string }).erro, /já diz Pleno/);
  assert.match((normalizarCargo({ cargo: "Analista Pleno II", step: "III" }, tudo) as { erro: string }).erro, /step II/);
});

test("chaveCargo: linha separada, linha antiga e nome da Sólides chegam à mesma chave", () => {
  const separada = chaveCargo({ cargo: "Consultor de Performace e Vendas (Sócio)", senioridade: "Sênior", step: "I" });
  assert.equal(chaveCargo({ cargo: "Consultor de Performace e Vendas Sênior (Sócio) I" }), separada);
  assert.equal(chaveCargo({ cargo: "consultor de performace e vendas SENIOR (sócio) i" }), separada);
  assert.notEqual(chaveCargo({ cargo: "Consultor de Performace e Vendas (Sócio)", senioridade: "Sênior", step: "II" }), separada);
});

test("os vocabulários do app são os mesmos dos CHECK da tabela no banco", () => {
  // Comentários fora antes de ler: eles citam valores em prosa.
  const dir = path.join(process.cwd(), "supabase", "migrations");
  let sen: string | null = null;
  let step: string | null = null;
  for (const f of fs.readdirSync(dir).filter((n) => n.endsWith(".sql")).sort()) {
    const sql = fs.readFileSync(path.join(dir, f), "utf8").replace(/--.*/g, "");
    for (const m of Array.from(sql.matchAll(/dp_tabela_salarial_senioridade_chk\s+CHECK\s*\(senioridade IN \(([^)]*)\)/g))) sen = m[1];
    for (const m of Array.from(sql.matchAll(/dp_tabela_salarial_step_chk\s+CHECK\s*\(step IN \(([^)]*)\)/g))) step = m[1];
  }
  const valores = (s: string | null) => Array.from((s ?? "").matchAll(/'([^']*)'/g)).map((m) => m[1]);
  assert.deepEqual(valores(sen), ["", ...SENIORIDADES]);
  assert.deepEqual(valores(step), ["", ...STEPS]);
});

// ── Sugestão do de-para e rótulo ────────────────────────────────────────────

const linhas: DpLinhaSalarial[] = [
  { id: "n1", setor: "Comercial", cargo: "Analista Comercial", senioridade: "Júnior", step: "I", salario: 4000 },
  { id: "n2", setor: "Comercial", cargo: "Analista Comercial", senioridade: "Júnior", step: "III", salario: 5000 },
  { id: "n3", setor: "Operacional", cargo: "Motorista", senioridade: "", step: "", salario: 2500 },
  { id: "n4", setor: "Marketing", cargo: "Designer", senioridade: "", step: "I", salario: 3000 },
  { id: "n5", setor: "Eventos", cargo: "Designer", senioridade: "", step: "I", salario: 3200 },
  // Linha antiga, ainda com tudo no nome (antes do preenchimento das colunas).
  { id: "n6", setor: "Vendas", cargo: "Consultor PLENO II", senioridade: "", step: "", salario: 6000 },
];

test("sugerirLinha: o nome da Sólides é o nome completo do cargo", () => {
  assert.equal(sugerirLinha("Analista Comercial JÚNIOR III", linhas), "n2");
  assert.equal(sugerirLinha("analista  comercial junior i", linhas), "n1");
  assert.equal(sugerirLinha("Motorista", linhas), "n3");
  // A linha antiga casa do mesmo jeito.
  assert.equal(sugerirLinha("Consultor Pleno II", linhas), "n6");
});

test("sugerirLinha: o mesmo cargo em dois setores não sugere nada", () => {
  assert.equal(sugerirLinha("Designer I", linhas), null);
  assert.equal(sugerirLinha("Analista Comercial", linhas), null);
  assert.equal(sugerirLinha("Analista Comercial Júnior", linhas), null);
  assert.equal(sugerirLinha("Gerente Geral", linhas), null);
});

test("rotuloLinha: setor · nome completo, ou só o nome", () => {
  assert.equal(rotuloLinha(linhas[0]), "Comercial · Analista Comercial Júnior I");
  assert.equal(rotuloLinha({ setor: "", cargo: "Motorista", senioridade: "", step: "" }), "Motorista");
});

test("enquadrar: tolerância de arredondamento, abaixo/acima e os casos sem dado", () => {
  assert.equal(enquadrar({ temEmpresa: true, salario: 5000.4, salarioNivel: 5000 }).status, "no_nivel");
  const abaixo = enquadrar({ temEmpresa: true, salario: 4500, salarioNivel: 5000 });
  assert.deepEqual(abaixo, { status: "abaixo", diferenca: -500, percentual: -10 });
  assert.equal(enquadrar({ temEmpresa: true, salario: 6000, salarioNivel: 5000 }).percentual, 20);
  assert.equal(enquadrar({ temEmpresa: true, salario: null, salarioNivel: 5000 }).status, "sem_salario");
  assert.equal(enquadrar({ temEmpresa: true, salario: 5000, salarioNivel: null }).status, "sem_vinculo");
  assert.equal(enquadrar({ temEmpresa: false, salario: 5000, salarioNivel: 5000 }).status, "sem_empresa");
});

test("alerta da tabela: só acima/abaixo; sem tabela, sem linha ou sem salário não alertam", () => {
  const base = { temEmpresa: true, salario: 5000, salarioNivel: 5000 };
  assert.equal(salarioForaDaTabela(enquadrar({ ...base, salario: 5000.5 })), false); // arredondamento
  assert.equal(salarioForaDaTabela(enquadrar({ ...base, salario: 4500 })), true);
  assert.equal(salarioForaDaTabela(enquadrar({ ...base, salario: 5600 })), true);
  assert.equal(salarioForaDaTabela(enquadrar({ ...base, salarioNivel: null })), false); // empresa sem tabela / cargo sem linha
  assert.equal(salarioForaDaTabela(enquadrar({ ...base, salario: null })), false);
  const t = textoAlertaTabela({
    salario: 4500,
    salarioTabela: 5000,
    linhaRotulo: "ADM · Analista 2",
    enquadramento: enquadrar({ ...base, salario: 4500 }),
  });
  assert.match(t ?? "", /abaixo da tabela \(ADM · Analista 2: R\$\s5\.000,00; −R\$\s500,00, −10%\)/);
  assert.match(t ?? "", /A folha segue o valor da Sólides/);
  assert.equal(textoAlertaTabela({ salario: 5000, salarioTabela: 5000, linhaRotulo: null, enquadramento: enquadrar(base) }), null);
});
