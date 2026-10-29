// Gera o MODELO da carga inicial dos benefícios por colaborador (o card
// "Benefícios" da ficha do DP): uma aba só, com Empresa, Colaborador e uma
// coluna por benefício, já preenchida com os colaboradores ativos da Sólides e
// com LISTAS SUSPENSAS das opções que a empresa de cada linha tem em
// Configurações › Benefícios. A planilha diz QUAL opção a pessoa recebe — o
// valor nunca vai nela: vem do cadastro da empresa (pedido de 28/10/2026, que
// tirou as colunas de referência com valor, departamento, cargo e contrato).
//
//   npx tsx scripts/dp-beneficios-modelo.ts <arquivo.xlsx>
//
// O arquivo é SIGILOSO (nome, cargo e benefícios de cada pessoa): o script se
// recusa a salvar dentro da pasta do projeto, para ele não acabar no git. O
// terminal mostra só contagens (regra do DP: terminal e log são lidos por
// outras pessoas).
//
// O contrato com a importação (nomes de coluna e texto de cada opção) mora em
// src/lib/dp/beneficios-planilha.ts. Quem já tem benefícios no card vem com
// eles preenchidos — a carga não pode apagar o que alguém cadastrou à mão.
//
// As listas suspensas são escritas direto no XML da planilha: o SheetJS
// (community) não grava validação de dados, e uma dependência nova só para um
// script de uso único não se paga. O zip é reescrito pelo CFB que vem com ele.
import fs from "node:fs";
import path from "node:path";

import { createClient } from "@supabase/supabase-js";
import * as XLSX from "xlsx-js-style";

import {
  lerBeneficiosColaborador,
  ROTULO_DESTINO,
  rotuloPresenciais,
  type DpBeneficiosColaborador,
} from "@/lib/dp/beneficios-colaborador";
import {
  BENEFICIOS_VAZIOS,
  blocoValido,
  lerBloco,
  rotuloFaixa,
  type DpBeneficiosDados,
  type DpBlocoBeneficio,
} from "@/lib/dp/beneficios-config";
import {
  ABA_BENEFICIOS,
  ABA_COMO,
  ABA_FILHOS,
  ABA_LISTAS,
  ABA_OPCOES,
  ABA_OUTROS,
  CABECALHO_ESCOLHA,
  CABECALHO_FILHOS,
  CABECALHO_OUTROS,
  CABECALHO_PESSOA,
  COLUNAS_ESCOLHA,
  DESTINOS_PLANILHA,
  escolhasNaPlanilha,
  opcoesDaPlanilha,
  rotuloColaboradorPlanilha,
  SIM_NAO,
  type DpColunaEscolha,
} from "@/lib/dp/beneficios-planilha";
import { indexarRegras, resolverEmpresa, type DpRegraOrigem } from "@/lib/dp/empresa";

for (const line of fs.readFileSync(".env.local", "utf8").split(/\r?\n/)) {
  const i = line.indexOf("=");
  if (i > 0 && !process.env[line.slice(0, i).trim()]) process.env[line.slice(0, i).trim()] = line.slice(i + 1).trim().replace(/^"|"$/g, "");
}

const saida = process.argv[2];
if (!saida) {
  console.error("Uso: npx tsx scripts/dp-beneficios-modelo.ts <arquivo.xlsx>  (fora da pasta do projeto)");
  process.exit(1);
}
const destino = path.resolve(saida);
const projeto = path.resolve(process.cwd());
if (destino.toLowerCase().startsWith(projeto.toLowerCase() + path.sep)) {
  console.error("O modelo tem dados sigilosos do DP: salve FORA da pasta do projeto (ex.: na pasta Downloads).");
  process.exit(1);
}

const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
const agora = new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", dateStyle: "short", timeStyle: "short" }).format(new Date());

/** Lê a tabela inteira (o PostgREST corta em 1.000 linhas). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function todas(tabela: string, colunas: string, filtro?: (q: any) => any): Promise<any[]> {
  const out: unknown[] = [];
  for (let de = 0; ; de += 1000) {
    let q = db.from(tabela).select(colunas).range(de, de + 999);
    if (filtro) q = filtro(q);
    const { data, error } = await q;
    if (error) throw new Error(`${tabela}: ${error.message}`);
    out.push(...(data ?? []));
    if (!data || data.length < 1000) break;
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return out as any[];
}

interface Pessoa {
  solidesId: number;
  nome: string;
}

// ── Estilos ────────────────────────────────────────────────────────────────
const cab = (rgb: string) => ({ font: { bold: true, color: { rgb: "FFFFFF" } }, fill: { patternType: "solid", fgColor: { rgb } }, alignment: { wrapText: true, vertical: "center" } });
const CAB_ID = cab("334155");
const CAB_ESCOLHA = cab("AE1800");
const CAB_CODIGO = cab("94A3B8");
const PREENCHER = { fill: { patternType: "solid", fgColor: { rgb: "FFF7E6" } } };
const SEM_LISTA = { fill: { patternType: "solid", fgColor: { rgb: "E5E7EB" } } };
const CODIGO = { font: { color: { rgb: "94A3B8" } } };
const MOEDA = "R$ #,##0.00";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Celula = { v: string | number; t?: string; s?: any; z?: string };
const cel = (v: string | number, s?: object, z?: string): Celula => ({ v, t: typeof v === "number" ? "n" : "s", s, z });

function aba(linhas: Celula[][], larguras: number[]): XLSX.WorkSheet {
  const ws: XLSX.WorkSheet = {};
  linhas.forEach((l, r) =>
    l.forEach((c, col) => {
      if (c.v === "" && !c.s) return;
      ws[XLSX.utils.encode_cell({ r, c: col })] = c;
    }),
  );
  const maxC = Math.max(1, ...linhas.map((l) => l.length)) - 1;
  ws["!ref"] = XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: Math.max(0, linhas.length - 1), c: maxC } });
  ws["!cols"] = larguras.map((wch) => ({ wch }));
  return ws;
}

// ── Validações (escritas no XML depois) ────────────────────────────────────
interface Validacao {
  sqref: string;
  lista: string;
  /** false = a lista é sugestão, aceita outro valor (km digitado na gasolina/carona). */
  estrito: boolean;
  erro: string;
}
const validacoes = new Map<string, Validacao[]>();
const congelar = new Map<string, { colunas: number; linhas: number }>();
const col = (c: number) => XLSX.utils.encode_col(c);

(async () => {
  const [colabs, regras, empresas, configs, cards] = await Promise.all([
    todas("dp_colaboradores", "solides_id, nome, unidade_id, departamento_id", (q) => q.eq("ativo", true)),
    todas("dp_empresa_regras", "origem, solides_id, company_id"),
    todas("companies", "id, name"),
    todas("dp_beneficios_config", "company_id, bloco, dados"),
    todas("dp_colaborador_beneficios", "solides_id, dados"),
  ]);

  const nomeEmpresa = new Map(empresas.map((c) => [c.id as string, c.name as string]));
  const idx = indexarRegras(regras.map((r) => ({ origem: r.origem as DpRegraOrigem, solidesId: Number(r.solides_id), companyId: String(r.company_id) })));

  // Cadastro de benefícios de cada empresa (o não salvo fica vazio, como na tela).
  const cfgPorEmpresa = new Map<string, { dados: DpBeneficiosDados; salvos: number }>();
  for (const r of configs) {
    const b = r.bloco as string;
    if (!blocoValido(b)) continue;
    const atual = cfgPorEmpresa.get(r.company_id) ?? { dados: { ...BENEFICIOS_VAZIOS }, salvos: 0 };
    (atual.dados as Record<DpBlocoBeneficio, unknown>)[b] = lerBloco(b, r.dados);
    atual.salvos += 1;
    cfgPorEmpresa.set(r.company_id, atual);
  }
  const cfgDe = (companyId: string) => cfgPorEmpresa.get(companyId)?.dados ?? BENEFICIOS_VAZIOS;

  const cardDe = new Map<number, DpBeneficiosColaborador>(cards.map((c) => [Number(c.solides_id), lerBeneficiosColaborador(c.dados)]));

  // Colaboradores ativos por empresa, pela MESMA regra de empresa das telas.
  const porEmpresa = new Map<string, Pessoa[]>();
  let semEmpresa = 0;
  for (const r of colabs) {
    const e = resolverEmpresa(
      { unidadeId: r.unidade_id === null ? null : Number(r.unidade_id), departamentoId: r.departamento_id === null ? null : Number(r.departamento_id) },
      idx,
    );
    if (!e.companyId || !nomeEmpresa.has(e.companyId)) {
      semEmpresa += 1;
      continue;
    }
    const lista = porEmpresa.get(e.companyId) ?? [];
    lista.push({ solidesId: Number(r.solides_id), nome: String(r.nome ?? "").trim() });
    porEmpresa.set(e.companyId, lista);
  }
  const ordemEmpresas = Array.from(porEmpresa.keys()).sort((a, b) => nomeEmpresa.get(a)!.localeCompare(nomeEmpresa.get(b)!, "pt-BR"));
  for (const id of ordemEmpresas) porEmpresa.get(id)!.sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"));

  // ── Aba oculta das listas ──────────────────────────────────────────────
  const listas: Array<{ titulo: string; valores: string[] }> = [];
  const refLista = (titulo: string, valores: string[]): string => {
    listas.push({ titulo, valores });
    const c = col(listas.length - 1);
    return `'${ABA_LISTAS}'!$${c}$2:$${c}$${valores.length + 1}`;
  };
  const listaSimNao = refLista("Sim/Não", [...SIM_NAO]);
  const listaDestinos = refLista("Destinos", DESTINOS_PLANILHA);
  const rotuloDe = new Map<number, string>();
  for (const id of ordemEmpresas) {
    for (const p of porEmpresa.get(id)!) rotuloDe.set(p.solidesId, rotuloColaboradorPlanilha({ nome: p.nome, empresa: nomeEmpresa.get(id)!, solidesId: p.solidesId }));
  }
  const listaColabs = refLista("Colaboradores", Array.from(rotuloDe.values()).sort((a, b) => a.localeCompare(b, "pt-BR")));

  // ── A aba Benefícios: uma só, em blocos por empresa ─────────────────────
  // A lista de cada célula é a da empresa da LINHA — por isso as linhas vêm
  // agrupadas por empresa (uma validação por bloco × coluna) e a pessoa nunca
  // escolhe a faixa de outra empresa.
  const resumo: Array<{ empresa: string; pessoas: number; salvos: number; comCard: number }> = [];
  const filhosLinhas: Celula[][] = [];
  const outrosLinhas: Celula[][] = [];
  const beneficiosLinhas: Celula[][] = [
    [
      cel(CABECALHO_PESSOA.empresa, CAB_ID),
      cel(CABECALHO_PESSOA.nome, CAB_ID),
      ...COLUNAS_ESCOLHA.map((c) => cel(CABECALHO_ESCOLHA[c], CAB_ESCOLHA)),
      cel(CABECALHO_PESSOA.id, CAB_CODIGO),
    ],
  ];
  const validacoesBeneficios: Validacao[] = [];
  let comCard = 0;

  for (const companyId of ordemEmpresas) {
    const empresa = nomeEmpresa.get(companyId)!;
    const pessoas = porEmpresa.get(companyId)!;
    const cfg = cfgDe(companyId);
    const opcoes = opcoesDaPlanilha(cfg);
    let comCardEmpresa = 0;

    // A lista de cada coluna (nenhuma quando a empresa não tem opção naquele bloco).
    const listaDe = {} as Record<DpColunaEscolha, string | null>;
    for (const c of COLUNAS_ESCOLHA) {
      if (c === "assiduidade") listaDe[c] = cfg.assiduidade.valor !== null ? listaSimNao : null;
      else listaDe[c] = opcoes[c].length > 0 ? refLista(`${empresa} · ${CABECALHO_ESCOLHA[c]}`, opcoes[c]) : null;
    }

    const primeira = beneficiosLinhas.length + 1; // linha do Excel (1 = cabeçalho)
    for (const p of pessoas) {
      const card = cardDe.get(p.solidesId) ?? null;
      if (card) comCardEmpresa += 1;
      const ja = card ? escolhasNaPlanilha(card, cfg) : null;
      beneficiosLinhas.push([
        cel(empresa),
        cel(p.nome),
        ...COLUNAS_ESCOLHA.map((c) => cel(ja?.[c] ?? "", listaDe[c] ? PREENCHER : SEM_LISTA)),
        cel(p.solidesId, CODIGO),
      ]);
      for (const f of card?.filhos ?? []) {
        const [y, m, d] = f.nascimento.split("-");
        filhosLinhas.push([cel(rotuloDe.get(p.solidesId)!), cel(f.nome), cel(`${d}/${m}/${y}`), cel(f.invalido ? "Sim" : "Não")]);
      }
      for (const o of card?.outros ?? []) {
        outrosLinhas.push([cel(rotuloDe.get(p.solidesId)!), cel(o.rotulo), cel(o.valor, undefined, MOEDA), cel(ROTULO_DESTINO[o.destino])]);
      }
    }
    const ultima = beneficiosLinhas.length;
    if (pessoas.length > 0) {
      COLUNAS_ESCOLHA.forEach((c, i) => {
        const lista = listaDe[c];
        if (!lista) return;
        const letra = col(2 + i);
        const km = c === "gasolina" || c === "carona";
        validacoesBeneficios.push({
          sqref: `${letra}${primeira}:${letra}${ultima}`,
          lista,
          estrito: !km,
          erro: `Escolha uma opção da lista — são as de ${empresa} em Configurações › Benefícios.`,
        });
      });
    }
    resumo.push({ empresa, pessoas: pessoas.length, salvos: cfgPorEmpresa.get(companyId)?.salvos ?? 0, comCard: comCardEmpresa });
    comCard += comCardEmpresa;
  }
  const beneficiosWs = aba(beneficiosLinhas, [30, 36, 20, 22, 24, 24, 22, 20, 12, 12]);
  beneficiosWs["!autofilter"] = {
    ref: XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: beneficiosLinhas.length - 1, c: beneficiosLinhas[0].length - 1 } }),
  };
  beneficiosWs["!rows"] = [{ hpt: 32 }];
  validacoes.set(ABA_BENEFICIOS, validacoesBeneficios);
  congelar.set(ABA_BENEFICIOS, { colunas: 2, linhas: 1 });

  // ── Filhos e Outros benefícios (linhas em branco para preencher) ─────────
  const LINHAS_LIVRES = 300;
  const livres = (base: Celula[][], colunas: number) => {
    const out = [...base];
    for (let i = 0; i < LINHAS_LIVRES; i += 1) out.push(Array.from({ length: colunas }, () => cel("", PREENCHER)));
    return out;
  };
  const filhosWs = aba([CABECALHO_FILHOS.map((t) => cel(t, CAB_ESCOLHA)), ...livres(filhosLinhas, 4)], [52, 34, 14, 10]);
  const outrosWs = aba([CABECALHO_OUTROS.map((t) => cel(t, CAB_ESCOLHA)), ...livres(outrosLinhas, 4)], [52, 34, 14, 24]);
  const fimFilhos = filhosLinhas.length + LINHAS_LIVRES + 1;
  const fimOutros = outrosLinhas.length + LINHAS_LIVRES + 1;
  const erroColab = "Escolha o colaborador na lista (o ID no fim é o que a importação lê).";
  validacoes.set(ABA_FILHOS, [
    { sqref: `A2:A${fimFilhos}`, lista: listaColabs, estrito: true, erro: erroColab },
    { sqref: `D2:D${fimFilhos}`, lista: listaSimNao, estrito: true, erro: "Sim ou Não." },
  ]);
  validacoes.set(ABA_OUTROS, [
    { sqref: `A2:A${fimOutros}`, lista: listaColabs, estrito: true, erro: erroColab },
    { sqref: `D2:D${fimOutros}`, lista: listaDestinos, estrito: true, erro: "Escolha o benefício em que o valor soma, ou Separado." },
  ]);
  congelar.set(ABA_FILHOS, { colunas: 0, linhas: 1 });
  congelar.set(ABA_OUTROS, { colunas: 0, linhas: 1 });

  // ── Opções de cada empresa (legível, com valor e unidade) ───────────────
  const opcoesLinhas: Celula[][] = [["Empresa", "Benefício", "Opção", "Valor", "Unidade"].map((t) => cel(t, CAB_ID))];
  for (const companyId of ordemEmpresas) {
    const empresa = nomeEmpresa.get(companyId)!;
    const cfg = cfgDe(companyId);
    const add = (b: string, o: string, valor: number | null, u: string) =>
      opcoesLinhas.push([cel(empresa), cel(b), cel(o), valor === null ? cel("") : cel(valor, undefined, MOEDA), cel(u)]);
    if (!cfgPorEmpresa.has(companyId)) {
      add("—", "sem benefícios cadastrados em Configurações › Benefícios", null, "");
      continue;
    }
    for (const f of cfg.alimentacao.faixas) add("Vale-alimentação", f.nome, f.valor, cfg.alimentacao.regra === "diario" ? "por dia" : "no mês");
    for (const b of cfg.transporte.bilhetes) add("Vale-transporte", b.nome, b.valor, "por dia");
    if (cfg.transporte.bilhetes.length) add("Vale-transporte", cfg.transporte.descontar6 ? "(desconta 6% do salário)" : "(não desconta os 6%)", null, "");
    for (const f of cfg.gasolina.faixas) add("Auxílio gasolina", rotuloFaixa("gasolina", f), f.valor, "no mês");
    for (const f of cfg.carona.faixas) add("Auxílio carona", rotuloFaixa("carona", f), f.valor, "no mês");
    for (const d of cfg.home_office.porDias) add("Auxílio home office", rotuloPresenciais(d.dias), d.valor, "no mês");
    for (const m of cfg.sesi.modalidades) add("Clube SESI", m.nome, m.valor, "no mês");
    if (cfg.salario_familia.cota !== null) add("Salário-família", "Cota por filho", cfg.salario_familia.cota, "no mês");
    if (cfg.salario_familia.limite !== null) add("Salário-família", "Limite de remuneração", cfg.salario_familia.limite, "");
    if (cfg.assiduidade.valor !== null) add("Assiduidade", "Sim", cfg.assiduidade.valor, "no mês");
  }
  const opcoesWs = aba(opcoesLinhas, [30, 22, 44, 14, 10]);
  opcoesWs["!autofilter"] = { ref: XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: opcoesLinhas.length - 1, c: 4 } }) };
  congelar.set(ABA_OPCOES, { colunas: 0, linhas: 1 });

  // ── Como preencher ─────────────────────────────────────────────────────
  const B = { font: { bold: true } };
  const comoLinhas: Celula[][] = [
    [cel("Carga inicial dos benefícios por colaborador — Departamento Pessoal", { font: { bold: true, sz: 14 } })],
    [cel(`Gerado em ${agora}. Arquivo SIGILOSO: tem dados do DP. Não salve na pasta do projeto nem envie para fora.`)],
    [cel("")],
    [cel("Como preencher", B)],
    [cel("• Aba Benefícios: uma linha por colaborador ativo da Sólides, agrupados por empresa. Em cada coluna, escolha na lista")],
    [cel("  QUAL opção a pessoa recebe (a faixa do vale-alimentação, o bilhete do VT, a modalidade do SESI…). Em branco = não recebe.")],
    [cel("• Não se digita valor: o valor de cada opção vem de Configurações › Benefícios da empresa. A aba Opções só mostra, para consulta.")],
    [cel("• Célula cinza = a empresa não tem aquele benefício cadastrado: cadastre lá e gere o modelo de novo.")],
    [cel("• Gasolina e carona: escolha a faixa na lista ou digite a distância em km (a importação acha a faixa).")],
    [cel("• Salário-família não tem coluna: sai das regras (CLT/aprendiz, limite de remuneração, filhos até 14 anos). Filhos da Sólides já contam.")],
    [cel("  Na aba Filhos, cadastre só os que faltam na Sólides — ou, com o MESMO nome, para corrigir a data ou marcar inválido.")],
    [cel("• Outros benefícios: uma linha por benefício; Destino = o benefício em que o valor soma (na unidade dele) ou Separado.")],
    [cel("• Quem já tem benefícios cadastrados na ficha vem com eles preenchidos.")],
    [cel("• Não altere a coluna Código nem os nomes das abas: é pelo código que a importação acha cada pessoa.")],
    [cel("")],
    [cel("Empresa", CAB_ID), cel("Colaboradores ativos", CAB_ID), cel("Benefícios cadastrados", CAB_ID), cel("Já com benefícios na ficha", CAB_ID)],
    ...resumo.map((r) => [cel(r.empresa), cel(r.pessoas), cel(r.salvos === 0 ? "nenhum — cadastre antes" : `${r.salvos} de 8 blocos`), cel(r.comCard)]),
  ];
  const comoWs = aba(comoLinhas, [62, 20, 24, 24]);

  // ── Listas ─────────────────────────────────────────────────────────────
  const maxLista = Math.max(...listas.map((l) => l.valores.length));
  const listasLinhas: Celula[][] = [listas.map((l) => cel(l.titulo))];
  for (let i = 0; i < maxLista; i += 1) listasLinhas.push(listas.map((l) => cel(l.valores[i] ?? "")));
  const listasWs = aba(listasLinhas, listas.map(() => 30));

  // ── Monta, escreve e injeta validações e painéis congelados ─────────────
  const wb = XLSX.utils.book_new();
  const ordem: Array<[string, XLSX.WorkSheet]> = [
    [ABA_COMO, comoWs],
    [ABA_BENEFICIOS, beneficiosWs],
    [ABA_FILHOS, filhosWs],
    [ABA_OUTROS, outrosWs],
    [ABA_OPCOES, opcoesWs],
    [ABA_LISTAS, listasWs],
  ];
  for (const [nome, ws] of ordem) XLSX.utils.book_append_sheet(wb, ws, nome);
  wb.Workbook = { Sheets: ordem.map(([nome]) => ({ Hidden: nome === ABA_LISTAS ? 1 : 0 })) };

  const bruto = XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
  const zip = XLSX.CFB.read(bruto, { type: "buffer" });
  ordem.forEach(([nome], i) => {
    const v = validacoes.get(nome) ?? [];
    const f = congelar.get(nome);
    if (v.length === 0 && !f) return;
    const pos = zip.FullPaths.indexOf(`Root Entry/xl/worksheets/sheet${i + 1}.xml`);
    if (pos < 0) throw new Error(`Aba ${i + 1} não encontrada no arquivo gerado.`);
    let xml = Buffer.from(zip.FileIndex[pos].content).toString("utf8");
    if (f) xml = comPainelCongelado(xml, f.colunas, f.linhas);
    if (v.length) xml = comValidacoes(xml, v);
    const conteudo = Buffer.from(xml, "utf8");
    zip.FileIndex[pos].content = conteudo;
    zip.FileIndex[pos].size = conteudo.length;
  });
  fs.writeFileSync(destino, XLSX.CFB.write(zip, { type: "buffer", fileType: "zip" }));

  const pessoas = resumo.reduce((s, r) => s + r.pessoas, 0);
  console.log(
    `Empresas: ${resumo.length} (com benefícios cadastrados: ${resumo.filter((r) => r.salvos > 0).length}) · colaboradores ativos no modelo: ${pessoas}` +
      ` · fora do modelo (sem empresa no de-para): ${semEmpresa} · já com benefícios na ficha: ${comCard}`,
  );
  console.log(`Modelo salvo em: ${destino}`);
})().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});

const xmlAttr = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/**
 * `<dataValidations>` no lugar que o esquema do OOXML manda: depois de
 * sheetData/autoFilter/mergeCells/conditionalFormatting e antes de tudo o que
 * vem a seguir (o SheetJS termina a aba em `<ignoredErrors>`, que já é "depois").
 * Fora de ordem, o Excel abre pedindo para "reparar" o arquivo.
 */
function comValidacoes(xml: string, v: Validacao[]): string {
  const depois = ["<hyperlinks", "<printOptions", "<pageMargins", "<pageSetup", "<headerFooter", "<rowBreaks", "<colBreaks", "<customProperties", "<cellWatches", "<ignoredErrors", "<smartTags", "<drawing", "<legacyDrawing", "<picture", "<oleObjects", "<controls", "<webPublishItems", "<tableParts", "<extLst", "</worksheet>"];
  const pos = Math.min(...depois.map((t) => xml.indexOf(t)).filter((p) => p >= 0));
  const itens = v
    .map(
      (x) =>
        `<dataValidation type="list" allowBlank="1" showErrorMessage="${x.estrito ? 1 : 0}" errorTitle="Valor fora da lista" error="${xmlAttr(x.erro)}" sqref="${x.sqref}">` +
        `<formula1>${xmlAttr(x.lista)}</formula1></dataValidation>`,
    )
    .join("");
  return `${xml.slice(0, pos)}<dataValidations count="${v.length}">${itens}</dataValidations>${xml.slice(pos)}`;
}

/** Congela o cabeçalho (e as colunas de identificação): o xlsx-js-style ignora `!freeze`. */
function comPainelCongelado(xml: string, colunas: number, linhas: number): string {
  const topo = `${colunas > 0 ? XLSX.utils.encode_col(colunas) : "A"}${linhas + 1}`;
  const painel = colunas > 0 ? "bottomRight" : "bottomLeft";
  const view =
    `<sheetViews><sheetView workbookViewId="0">` +
    `<pane${colunas > 0 ? ` xSplit="${colunas}"` : ""} ySplit="${linhas}" topLeftCell="${topo}" activePane="${painel}" state="frozen"/>` +
    `<selection pane="${painel}" activeCell="${topo}" sqref="${topo}"/></sheetView></sheetViews>`;
  if (/<sheetViews>[\s\S]*?<\/sheetViews>/.test(xml)) return xml.replace(/<sheetViews>[\s\S]*?<\/sheetViews>/, view);
  const antes = ["<sheetFormatPr", "<cols", "<sheetData"].map((t) => xml.indexOf(t)).filter((p) => p >= 0);
  const pos = Math.min(...antes);
  return `${xml.slice(0, pos)}${view}${xml.slice(pos)}`;
}
