// A regra do sync DP → quadro de pessoal do Orçamento.

import test from "node:test";
import assert from "node:assert/strict";

import {
  casarComQuadro,
  chaveDepartamento,
  indexarDePara,
  itensParaGravar,
  montarPrevia,
  sugerirDePara,
  vinculoDoContrato,
  type DpPessoa,
  type QuadroLinha,
} from "./dp-sync";

// ─── Normalização ───────────────────────────────────────────────────────────

test("a chave do departamento ignora acento, caixa e espaço repetido", () => {
  assert.equal(chaveDepartamento("Gestão  de   Pessoas "), "gestao de pessoas");
  assert.equal(chaveDepartamento("COMERCIAL"), "comercial");
  assert.equal(chaveDepartamento(null), "");
});

// ─── Vínculo ────────────────────────────────────────────────────────────────

test("jovem aprendiz é CLT, não estágio", () => {
  // O motor do orçamento cobra estágio sem encargo nenhum; aprendiz tem FGTS.
  // Tratá-lo como estágio tiraria o encargo de quem o tem.
  assert.deepEqual(vinculoDoContrato("Jovem Aprendiz"), { vinculo: "clt", aviso: null });
  assert.deepEqual(vinculoDoContrato("CLT - Jovem Aprendiz"), { vinculo: "clt", aviso: null });
});

test("sócio, prestador, autônomo e MEI entram como PJ", () => {
  for (const t of ["Sócio", "Pró-labore", "Prestador de Serviço", "Autônomo", "MEI", "PJ"]) {
    assert.equal(vinculoDoContrato(t).vinculo, "pj", t);
  }
});

test("a PONTUAÇÃO não pode fazer um sócio virar CLT", () => {
  // Defeito real: tirar o acento deixava "pro-labore", que não casava com
  // "pro labore" — e o padrão CLT é o jeito mais discreto de errar o custo de
  // um sócio (CLT carrega encargo, férias e 13º; PJ entra só com o valor).
  for (const t of ["Pró-labore", "Pró labore", "PRO-LABORE", "PJ / Prestador", "Sócio-administrador"]) {
    assert.deepEqual(vinculoDoContrato(t), { vinculo: "pj", aviso: null }, t);
  }
});

test("estágio é estágio", () => {
  assert.equal(vinculoDoContrato("Estagiário").vinculo, "estagio");
  assert.equal(vinculoDoContrato("ESTAGIO").vinculo, "estagio");
});

test("CLT e suas variações", () => {
  for (const t of ["CLT", "Efetivo", "Prazo Indeterminado", "Contrato de Experiência"]) {
    assert.deepEqual(vinculoDoContrato(t), { vinculo: "clt", aviso: null }, t);
  }
});

test("sem tipo de contrato entra como CLT COM AVISO, nunca calado", () => {
  // Em 02/10/2026 eram 39 dos 207 ativos. Numa decisão de custo, errar para
  // mais é melhor que errar para menos — mas quem confere precisa saber.
  for (const v of [null, "", "   "]) {
    const r = vinculoDoContrato(v);
    assert.equal(r.vinculo, "clt");
    assert.ok(r.aviso, `"${v}" deveria avisar`);
  }
});

test("tipo desconhecido avisa NOMEANDO o texto que veio", () => {
  const r = vinculoDoContrato("Diretor Fundador");
  assert.equal(r.vinculo, "clt");
  assert.match(r.aviso ?? "", /Diretor Fundador/);
});

// ─── De-para ────────────────────────────────────────────────────────────────

test("a sugestão casa departamento com setor ignorando acento e caixa", () => {
  const m = sugerirDePara(
    ["COMERCIAL", "Gestao de Pessoas", "Inexistente"],
    [{ id: "s1", name: "Comercial" }, { id: "s2", name: "Gestão de Pessoas" }],
  );
  assert.equal(m.get("comercial"), "Comercial");
  assert.equal(m.get("gestao de pessoas"), "Gestão de Pessoas");
  assert.equal(m.has("inexistente"), false, "o que não casa fica de fora, para a tela pedir");
});

test("o de-para gravado é indexado pela chave", () => {
  const idx = indexarDePara([{ departamento: "  Comercial ", setorNome: "Vendas" }]);
  assert.equal(idx.get("comercial"), "Vendas");
});

// ─── Casamento com o quadro ─────────────────────────────────────────────────

const QUADRO_BASE: QuadroLinha[] = [
  { id: "q1", nome: "Ana Paula Silva", setorId: "s1", cargoAtual: "Analista", salarioAtual: 3000, vinculo: "clt", travado: false },
];

test("nome exato casa, ignorando acento e caixa", () => {
  assert.deepEqual(casarComQuadro("ANA PAULA SILVA", QUADRO_BASE), { tipo: "um", id: "q1" });
});

test("nome ambíguo NUNCA casa", () => {
  const quadro: QuadroLinha[] = [
    { ...QUADRO_BASE[0], id: "a" },
    { ...QUADRO_BASE[0], id: "b" },
  ];
  assert.deepEqual(casarComQuadro("Ana Paula Silva", quadro), { tipo: "ambiguo", quantos: 2 });
});

test("continência casa com UM candidato", () => {
  // O quadro foi digitado com o nome curto; a Sólides tem o completo.
  const quadro: QuadroLinha[] = [{ ...QUADRO_BASE[0], nome: "Ana Silva" }];
  assert.deepEqual(casarComQuadro("Ana Cristina Silva", quadro), { tipo: "um", id: "q1" });
});

test("continência com DUAS candidatas não casa", () => {
  const quadro: QuadroLinha[] = [
    { ...QUADRO_BASE[0], id: "a", nome: "Ana Silva" },
    { ...QUADRO_BASE[0], id: "b", nome: "Ana Cristina" },
  ];
  assert.equal(casarComQuadro("Ana Cristina Silva", quadro).tipo, "ambiguo");
});

test("primeiro nome solto NÃO casa por continência", () => {
  // Um falso positivo aqui sobrescreve a pessoa errada. Exige duas palavras.
  const quadro: QuadroLinha[] = [{ ...QUADRO_BASE[0], nome: "Ana" }];
  assert.deepEqual(casarComQuadro("Ana Paula Silva", quadro), { tipo: "nenhum" });
});

test("quadro vazio não casa com nada", () => {
  assert.deepEqual(casarComQuadro("Ana", []), { tipo: "nenhum" });
});

// ─── A prévia ───────────────────────────────────────────────────────────────

function pessoa(over: Partial<DpPessoa> = {}): DpPessoa {
  return {
    solidesId: "1",
    nome: "Bruno Lima",
    departamento: "Comercial",
    cargoSolides: "Vendedor",
    cargoDaLinha: "Vendedor Pleno II",
    salario: 4000,
    tipoContrato: "CLT",
    dataDesligamento: null,
    ...over,
  };
}

const SETORES = [{ id: "s1", name: "Comercial" }];
const DEPARA = indexarDePara([{ departamento: "Comercial", setorNome: "Comercial" }]);

function previa(pessoas: DpPessoa[], quadro: QuadroLinha[] = [], orcaPorSetor = true) {
  return montarPrevia({ pessoas, quadro, dePara: DEPARA, setoresDoAno: SETORES, orcaPorSetor });
}

test("pessoa nova vem MARCADA e com o setor resolvido", () => {
  const r = previa([pessoa()]);
  assert.equal(r.itens.length, 1);
  const i = r.itens[0];
  assert.equal(i.estado, "nova");
  assert.equal(i.marcada, true, "nova é só ganho — vem marcada");
  assert.equal(i.setorId, "s1");
  assert.equal(i.setorNome, "Comercial");
  assert.equal(r.resumo.novas, 1);
  assert.equal(r.resumo.marcadas, 1);
});

test("o cargo vem da LINHA do DP quando há, e da Sólides quando não há", () => {
  const comLinha = previa([pessoa()]).itens[0];
  assert.equal(comLinha.cargo, "Vendedor Pleno II");
  assert.equal(comLinha.avisos.length, 0);

  const semLinha = previa([pessoa({ cargoDaLinha: null })]).itens[0];
  assert.equal(semLinha.cargo, "Vendedor");
  assert.match(semLinha.avisos.join(" "), /sem linha na tabela salarial/);
});

test("conflito vem DESMARCADO, com o valor atual ao lado", () => {
  const quadro: QuadroLinha[] = [
    { id: "q1", nome: "Bruno Lima", setorId: "s1", cargoAtual: "Vendedor Júnior I", salarioAtual: 3200, vinculo: "clt", travado: false },
  ];
  const i = previa([pessoa()], quadro).itens[0];
  assert.equal(i.estado, "conflito");
  assert.equal(i.marcada, false, "sobrescrever o que o gestor digitou é escolha explícita");
  assert.equal(i.quadroId, "q1");
  assert.deepEqual(i.atual, { cargo: "Vendedor Júnior I", salario: 3200, vinculo: "clt" });
});

test("quem já está igual não vira conflito nem vem marcado", () => {
  const quadro: QuadroLinha[] = [
    { id: "q1", nome: "Bruno Lima", setorId: "s1", cargoAtual: "Vendedor Pleno II", salarioAtual: 4000, vinculo: "clt", travado: false },
  ];
  const r = previa([pessoa()], quadro);
  assert.equal(r.itens[0].estado, "igual");
  assert.equal(r.itens[0].marcada, false);
  assert.equal(r.resumo.marcadas, 0);
});

test("diferença de meio centavo é arredondamento, não conflito", () => {
  const quadro: QuadroLinha[] = [
    { id: "q1", nome: "Bruno Lima", setorId: "s1", cargoAtual: "Vendedor Pleno II", salarioAtual: 4000.001, vinculo: "clt", travado: false },
  ];
  assert.equal(previa([pessoa()], quadro).itens[0].estado, "igual");
});

test("um centavo de verdade é conflito", () => {
  const quadro: QuadroLinha[] = [
    { id: "q1", nome: "Bruno Lima", setorId: "s1", cargoAtual: "Vendedor Pleno II", salarioAtual: 4000.01, vinculo: "clt", travado: false },
  ];
  assert.equal(previa([pessoa()], quadro).itens[0].estado, "conflito");
});

// ─── O setor: onde isto mais tropeça ────────────────────────────────────────

test("departamento sem setor no de-para fica FORA e é nomeado", () => {
  // Entrar sem setor cairia no balde "Não atribuído", que gestor nenhum
  // alcança: o sync criaria gente que o gestor não vê, sem erro nenhum.
  const r = previa([pessoa({ departamento: "Logística" })]);
  assert.equal(r.itens[0].estado, "fora");
  assert.equal(r.itens[0].motivoFora, "departamento_nao_mapeado");
  assert.deepEqual(r.departamentosNaoMapeados, ["Logística"]);
  assert.equal(r.resumo.marcadas, 0);
});

test("o mesmo departamento não mapeado não se repete na lista", () => {
  const r = previa([
    pessoa({ solidesId: "1", departamento: "Logística" }),
    pessoa({ solidesId: "2", nome: "Carla Souza", departamento: "Logística" }),
  ]);
  assert.deepEqual(r.departamentosNaoMapeados, ["Logística"]);
  assert.equal(r.resumo.fora, 2);
});

test("pessoa sem departamento no DP fica fora, com motivo próprio", () => {
  const r = previa([pessoa({ departamento: null })]);
  assert.equal(r.itens[0].motivoFora, "sem_departamento");
  assert.deepEqual(r.departamentosNaoMapeados, [], "não é falta de de-para");
});

test("de-para que aponta para setor inexistente NESTE ano fica fora", () => {
  // O setor sai do cadastro, ou o ano novo ainda não foi clonado.
  const r = montarPrevia({
    pessoas: [pessoa()],
    quadro: [],
    dePara: indexarDePara([{ departamento: "Comercial", setorNome: "Vendas" }]),
    setoresDoAno: SETORES,
    orcaPorSetor: true,
  });
  assert.equal(r.itens[0].motivoFora, "setor_fora_do_ano");
  assert.equal(r.itens[0].setorNome, "Vendas", "a tela mostra para onde o de-para aponta");
});

test("empresa que NÃO orça por setor ignora o de-para e entra sem setor", () => {
  const r = previa([pessoa({ departamento: null })], [], false);
  assert.equal(r.itens[0].estado, "nova");
  assert.equal(r.itens[0].setorId, null);
  assert.equal(r.resumo.fora, 0);
});

// ─── Travas e avisos ────────────────────────────────────────────────────────

test("linha JÁ DECIDIDA pela diretoria fica FORA, mostrando o que mudaria", () => {
  // Sincronizar por cima gravaria um UPDATE, e no Orçamento "a edição vence a
  // decisão": o ✓ do diretor cairia para `pendente` e o valor sairia da Prévia
  // aprovada, sem ninguém pedir. Admin passa pela trava da validação, então
  // quem tem de barrar aqui é a prévia.
  const quadro: QuadroLinha[] = [
    { id: "q1", nome: "Bruno Lima", setorId: "s1", cargoAtual: "Vendedor Júnior I", salarioAtual: 3200, vinculo: "clt", travado: true, travadoMotivo: "aprovada pela diretoria" },
  ];
  const i = previa([pessoa()], quadro).itens[0];
  assert.equal(i.estado, "fora");
  assert.equal(i.motivoFora, "decidida");
  assert.equal(i.marcada, false);
  assert.equal(i.quadroId, "q1");
  assert.ok(i.atual, "esconder o atual faria parecer que a pessoa não está no quadro");
  assert.match(i.avisos.join(" "), /aprovada pela diretoria/);
});

test("setor com a fatia de pessoal FINALIZADA fica fora, mesmo para o admin", () => {
  // Finalizar trava para todo mundo, inclusive para o admin que clicou — é a
  // diferença deliberada para a trava da validação. Oferecer a caixa e ver o
  // item voltar com erro é o que esta tela se proíbe de fazer.
  const r = montarPrevia({
    pessoas: [pessoa()],
    quadro: [],
    dePara: DEPARA,
    setoresDoAno: SETORES,
    orcaPorSetor: true,
    setoresFechados: new Set(["s1"]),
  });
  assert.equal(r.itens[0].motivoFora, "fatia_finalizada");
  assert.equal(r.resumo.marcadas, 0);
});

test("a fatia fechada da empresa SEM setor é a chave null", () => {
  const r = montarPrevia({
    pessoas: [pessoa({ departamento: null })],
    quadro: [],
    dePara: DEPARA,
    setoresDoAno: SETORES,
    orcaPorSetor: false,
    setoresFechados: new Set([null]),
  });
  assert.equal(r.itens[0].motivoFora, "fatia_finalizada");
});

test("fatia fechada de OUTRO setor não barra", () => {
  const r = montarPrevia({
    pessoas: [pessoa()],
    quadro: [],
    dePara: DEPARA,
    setoresDoAno: SETORES,
    orcaPorSetor: true,
    setoresFechados: new Set(["outro"]),
  });
  assert.equal(r.itens[0].estado, "nova");
});

test("desligamento já no cadastro vira AVISO, nunca movimentação", () => {
  // Movimentação é decisão do gestor (decidido em 27/10/2026). Mas a data não
  // pode ficar escondida: ela muda a folha do ano.
  const i = previa([pessoa({ dataDesligamento: "2027-01-15" })]).itens[0];
  assert.match(i.avisos.join(" "), /desligamento em 15\/01\/2027/);
  const campos = Object.keys(i).join(" ");
  assert.doesNotMatch(campos, /mov/i, "o item não carrega movimentação nenhuma");
});

test("sem salário na Sólides entra em branco, avisado e contado", () => {
  const r = previa([pessoa({ salario: null })]);
  assert.equal(r.itens[0].salario, null, "nunca inventar o salário da tabela");
  assert.match(r.itens[0].avisos.join(" "), /sem salário/i);
  assert.equal(r.resumo.semSalario, 1);
});

test("quem está fora não entra na contagem de sem salário", () => {
  const r = previa([pessoa({ salario: null, departamento: "Logística" })]);
  assert.equal(r.resumo.semSalario, 0, "ele não entraria de todo jeito");
});

// ─── Quem está só no quadro ─────────────────────────────────────────────────

test("quem está no quadro e não no DP é AVISO, nunca remoção", () => {
  // Contratação planejada cai aqui por definição: ela não existe na Sólides.
  const quadro: QuadroLinha[] = [
    { id: "q9", nome: "Vaga prevista — Analista", setorId: "s1", cargoAtual: null, salarioAtual: 5000, vinculo: "clt", travado: false },
  ];
  const r = previa([pessoa()], quadro);
  assert.deepEqual(r.apenasNoQuadro, [{ id: "q9", nome: "Vaga prevista — Analista", setorId: "s1" }]);
});

test("quem casou não aparece como só no quadro", () => {
  const quadro: QuadroLinha[] = [
    { id: "q1", nome: "Bruno Lima", setorId: "s1", cargoAtual: "X", salarioAtual: 1, vinculo: "clt", travado: false },
  ];
  assert.deepEqual(previa([pessoa()], quadro).apenasNoQuadro, []);
});

test("linha do quadro sem nome não desaparece do aviso", () => {
  const quadro: QuadroLinha[] = [
    { id: "q9", nome: null, setorId: null, cargoAtual: null, salarioAtual: null, vinculo: "clt", travado: false },
  ];
  assert.equal(previa([], quadro).apenasNoQuadro[0].nome, "(sem nome)");
});

// ─── O que de fato vai ser gravado ──────────────────────────────────────────

test("só grava o que foi MARCADO", () => {
  const r = previa([
    pessoa({ solidesId: "1" }),
    pessoa({ solidesId: "2", nome: "Carla Souza" }),
  ]);
  assert.equal(itensParaGravar(r, ["1"]).length, 1);
  assert.equal(itensParaGravar(r, []).length, 0);
});

test("item FORA não grava nem se vier marcado no corpo da requisição", () => {
  // A tela não o oferece, mas o cliente não decide o que o servidor aceita.
  const r = previa([pessoa({ departamento: "Logística" })]);
  assert.deepEqual(itensParaGravar(r, ["1"]), []);
});

test("item IGUAL marcado também não gera escrita", () => {
  const quadro: QuadroLinha[] = [
    { id: "q1", nome: "Bruno Lima", setorId: "s1", cargoAtual: "Vendedor Pleno II", salarioAtual: 4000, vinculo: "clt", travado: false },
  ];
  const r = previa([pessoa()], quadro);
  assert.deepEqual(itensParaGravar(r, ["1"]), []);
});

test("lista vazia devolve prévia vazia, não erro", () => {
  const r = previa([]);
  assert.deepEqual(r.itens, []);
  assert.deepEqual(r.resumo, {
    novas: 0, conflitos: 0, iguais: 0, fora: 0, semSalario: 0, marcadas: 0,
  });
});
