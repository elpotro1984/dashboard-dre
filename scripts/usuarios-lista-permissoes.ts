/**
 * LISTA legível das permissões de hoje, a partir de um retrato — SOMENTE LEITURA.
 *
 *   npx tsx scripts/usuarios-lista-permissoes.ts <retrato.json> [saida.json]
 *
 * Troca ids por nomes (empresas, orgs do Compras, setores) e organiza por
 * módulo no vocabulário da tela nova (docs/superpowers/specs/
 * 2026-10-26-usuarios-modulo-perfil.md). É a lista que o admin usa para
 * reabilitar, depois da migração, os módulos ALÉM do Compras (a migração só
 * leva o Compras dos usuários existentes — decisão de 26/10/2026).
 */
import { createClient } from "@supabase/supabase-js";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import * as XLSX from "xlsx";


const txt = readFileSync(".env.local", "utf8");
const get = (k: string) => (txt.match(new RegExp(`^${k}=(.*)$`, "m"))?.[1] ?? "").trim();
const db = createClient(get("NEXT_PUBLIC_SUPABASE_URL"), get("SUPABASE_SERVICE_ROLE_KEY"), {
  auth: { persistSession: false },
});

const PERFIL_COMPRAS: Record<string, string> = {
  solicitante: "Solicitante",
  gerente_setor: "Gerente",
  gerente: "Gerente Sócio",
  diretor: "Diretor",
  contas_a_pagar: "Contas a Pagar",
};
const PAPEL_ORCAMENTO: Record<string, string> = {
  construtor: "Preenchedor",
  construtor_amplo: "Preenchedor amplo",
  validador: "Aprovador",
  admin: "Admin",
};
const PAPEL_DP: Record<string, string> = { analista: "Visão Operacional", gestor: "Visão Estratégica" };

async function nomes(tabela: string, col: string): Promise<Map<string, string>> {
  const { data, error } = await db.from(tabela).select(`id, ${col}`).limit(1000);
  if (error) throw new Error(`${tabela}: ${error.message}`);
  return new Map(((data ?? []) as unknown as Record<string, unknown>[]).map((r) => [r.id as string, r[col] as string]));
}

async function main() {
  const entrada = process.argv[2];
  if (!entrada) throw new Error("Uso: npx tsx scripts/usuarios-lista-permissoes.ts <retrato.json> [saida.json]");
  const saida = resolve(process.argv[3] ?? entrada.replace(/\.json$/, "-lista.json"));
  const retrato = JSON.parse(readFileSync(entrada, "utf8"));

  const [empresas, orgs, setores] = await Promise.all([
    nomes("companies", "name"),
    nomes("ctrl_orgs", "nome"),
    nomes("ctrl_sectors", "name"),
  ]);
  const nomeEmp = (id: string) => empresas.get(id) ?? `(empresa ${id.slice(0, 8)})`;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const linhas = retrato.usuarios.map((u: any) => {
    const m = u.modulos;
    const admin = Boolean(u.flags.is_admin);
    const temCompras = m.compras.length > 0;

    const compras = temCompras && !admin
      ? {
          perfil: PERFIL_COMPRAS[u.profile] ?? u.profile,
          empresas: Object.entries(m.compras_por_empresa).map(([org, v]) => {
            const ov = (v as { override: string | null }).override;
            return `${orgs.get(org) ?? org}${ov ? ` (como ${PERFIL_COMPRAS[ov] ?? ov})` : ""}`;
          }),
          setores: u.setores_compras.map((s: string) => setores.get(s) ?? `(setor ${s.slice(0, 8)})`),
        }
      : null;

    const financeiro = m.financeiro && !admin
      ? {
          perfil: u.profile === "csc" ? "CSC" : "Visão Financeira",
          perfil_hoje: u.profile,
          empresas: u.empresas.map(nomeEmp),
        }
      : null;

    const orcamento = m.orcamento && !admin
      ? {
          perfil: PAPEL_ORCAMENTO[m.orcamento] ?? m.orcamento,
          // Hoje as empresas do Orçamento SÃO as do cadastro de unidades (Financeiro).
          empresas: u.empresas.map(nomeEmp),
          setores: Object.entries(u.orcamento_setores).map(
            ([c, lista]) => `${nomeEmp(c)}: ${(lista as string[]).join(", ")}`,
          ),
        }
      : null;

    const dp = m.dp
      ? { perfil: PAPEL_DP[m.dp] ?? m.dp, empresas: m.dp === "gestor" ? ["(todas — gestor)"] : u.dp_empresas.map(nomeEmp) }
      : null;

    // Concessão EXPLÍCITA: admin vê Case/Caixa/Contratos sem linha, e o
    // validador de contrato tem Contratos pelo perfil.
    const caixa = !admin && m.caixa;
    const kase = !admin && m.case;
    const contratos = !admin && m.contratos;

    const alemDoCompras = [
      financeiro && "Financeiro",
      orcamento && "Orçamento",
      caixa && "Caixa",
      kase && "Case",
      contratos && "Validação de Contratos",
      dp && !admin && "Departamento Pessoal",
    ].filter(Boolean) as string[];
    const modulos = [...(compras ? ["Compras"] : []), ...alemDoCompras];

    return {
      nome: u.name,
      email: u.email,
      ativo: u.active,
      admin,
      perfil_hoje: u.profile,
      modulos,
      compras,
      financeiro,
      orcamento,
      caixa,
      case: kase,
      contratos,
      contratos_pelo_perfil: u.profile === "validador_contrato",
      dp,
      vb: m.vb,
      regras_especiais: u.regras_especiais,
      // O que a migração NÃO leva e o admin reabilita à mão: os módulos além do
      // Compras de quem TEM o Compras e mais algum. Quem não tem Compras mantém
      // todos os seus módulos (decisão de 26/10/2026).
      reabilitar: !admin && compras && alemDoCompras.length > 0 ? alemDoCompras : [],
    };
  });

  writeFileSync(saida, JSON.stringify({ gerado_em: retrato.gerado_em, linhas }, null, 2));
  console.log(`Lista gravada em ${saida} (${linhas.length} usuários)`);

  const planilha = saida.replace(/\.json$/, ".xlsx");
  gravarPlanilha(planilha, retrato.gerado_em, linhas);
  console.log(`Planilha gravada em ${planilha}`);
}

const REGRAS: Record<string, string> = {
  "approver-sector-restriction": "Alçada de aprovação restrita",
  "routing-expense-manager": "Gerente fixo de tipo de despesa",
  "bi-validation-extra": "Acesso à Validação Relatório",
  "ctrl-full-view": "Visão completa do Compras",
  "case-contract-approver": "Aprovador dos contratos Case",
  "case-resumo-email": "Recebe resumo dos contratos Case",
  "director-highlight-sectors": "Diretor responsável por setores",
  "routing-requester": "Rota direta ao diretor",
  "routing-director": "Diretor fixo do solicitante especial",
  "report-extra-sectors": "Relatório: setores extras",
  "empresas-reservadas": "Único que libera Dataforte, VE Franqueadora e SPDX",
  "dp-concedente": "Único que concede o Departamento Pessoal",
};
const PERFIL_SISTEMA: Record<string, string> = {
  ...PERFIL_COMPRAS,
  admin: "Admin",
  franqueado: "Visão Financeira",
  csc: "CSC",
  validador_contrato: "Validador de Contrato",
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function gravarPlanilha(caminho: string, geradoEm: string, linhas: any[]) {
  const j = (v?: string[]) => (v && v.length ? v.join("\n") : "");
  const sim = (b: unknown) => (b ? "Sim" : "");
  const ordenadas = [...linhas].sort(
    (a, b) =>
      Number(!a.ativo) - Number(!b.ativo) ||
      Number(!a.admin) - Number(!b.admin) ||
      String(a.nome ?? "").localeCompare(String(b.nome ?? ""), "pt-BR"),
  );

  const usuarios = ordenadas.map((l) => {
    const regras = (l.regras_especiais as string[]).map((k) => REGRAS[k] ?? k);
    if (l.vb) regras.push(`Viva Bank (VB): ${l.vb}`);
    return {
      Nome: l.nome,
      "E-mail": l.email,
      "Situação": l.ativo ? "Ativo" : "Inativo",
      "Perfil atual (sistema)": PERFIL_SISTEMA[l.perfil_hoje] ?? l.perfil_hoje,
      "Módulos hoje": l.admin ? "ADMIN (todos os módulos)" : l.modulos.join(", ") || "nenhum",
      "Compras · Perfil": l.compras?.perfil ?? "",
      "Compras · Empresas": j(l.compras?.empresas),
      "Compras · Setores": j(l.compras?.setores),
      "Financeiro · Perfil (novo)": l.financeiro?.perfil ?? "",
      "Financeiro · Empresas": j(l.financeiro?.empresas),
      "Orçamento · Perfil (novo)": l.orcamento?.perfil ?? "",
      "Orçamento · Empresas": j(l.orcamento?.empresas),
      "Orçamento · Setores": j(l.orcamento?.setores),
      Caixa: sim(l.caixa),
      Case: sim(l.case),
      "Validação de Contratos": l.contratos_pelo_perfil ? "Sim (pelo perfil)" : sim(l.contratos),
      "DP · Perfil (novo)": l.dp?.perfil ?? "",
      "DP · Empresas": j(l.dp?.empresas),
      "Regras especiais": j(regras),
      "A reabilitar depois da migração": j(l.reabilitar),
    };
  });

  const reabilitar = ordenadas
    .filter((l) => l.ativo && l.reabilitar.length)
    .flatMap((l) =>
      (l.reabilitar as string[]).map((mod) => {
        const fonte =
          mod === "Financeiro" ? l.financeiro : mod === "Orçamento" ? l.orcamento : mod === "Departamento Pessoal" ? l.dp : null;
        return {
          Nome: l.nome,
          "E-mail": l.email,
          "Compras (mantido na migração)": l.compras?.perfil ?? "(sem Compras)",
          "Módulo a reabilitar": mod,
          Perfil: fonte?.perfil ?? "(sem perfil)",
          Empresas: j(fonte?.empresas),
          Setores: j(fonte?.setores),
          "Feito?": "",
        };
      }),
    );

  const legenda = [
    [`Retrato das permissões em ${geradoEm.slice(0, 10)} (lido de produção, somente leitura).`],
    [""],
    ['Aba "Usuários hoje": uma linha por usuário, com o acesso efetivo de hoje organizado como a tela nova (módulo → perfil → empresa → setor).'],
    ['Aba "A reabilitar": uma linha por módulo a reabilitar. Preencha "Feito?" com Sim ao habilitar na tela nova.'],
    [""],
    ["Regra da migração (26/10/2026): quem tem o Compras E mais algum módulo fica só com o Compras; os outros módulos são reabilitados à mão por esta lista."],
    ["Quem NÃO tem o Compras mantém todos os seus módulos (um ou vários) e não aparece em \"A reabilitar\"."],
    [""],
    ["Financeiro · Perfil (novo): todo não-admin vira Visão Financeira (quem já é CSC continua CSC)."],
    ["Orçamento · Empresas: hoje são as mesmas do Financeiro (cadastro de unidades); na tela nova o Orçamento ganha lista própria."],
    ['Compras: "(como X)" ao lado da empresa = papel diferente naquela empresa (papel por empresa).'],
    ['Caixa, Case e Validação de Contratos não têm perfil. "Sim (pelo perfil)" = o acesso vem do perfil Validador de Contrato.'],
    ['Admins aparecem como ADMIN (todos os módulos) e não entram em "A reabilitar". Exceção mantida: Carol não acessa o DP.'],
  ];

  const larguras = (linhasObj: Record<string, unknown>[], max = 45) =>
    Object.keys(linhasObj[0] ?? {}).map((k) => ({
      wch: Math.min(
        max,
        Math.max(k.length, ...linhasObj.map((r) => Math.max(...String(r[k] ?? "").split("\n").map((s) => s.length)))) + 2,
      ),
    }));

  const wb = XLSX.utils.book_new();
  const ws1 = XLSX.utils.json_to_sheet(usuarios);
  ws1["!cols"] = larguras(usuarios);
  ws1["!autofilter"] = { ref: ws1["!ref"] as string };
  XLSX.utils.book_append_sheet(wb, ws1, "Usuários hoje");
  const ws2 = XLSX.utils.json_to_sheet(reabilitar);
  ws2["!cols"] = larguras(reabilitar);
  ws2["!autofilter"] = { ref: ws2["!ref"] as string };
  XLSX.utils.book_append_sheet(wb, ws2, "A reabilitar");
  const ws3 = XLSX.utils.aoa_to_sheet(legenda);
  ws3["!cols"] = [{ wch: 140 }];
  XLSX.utils.book_append_sheet(wb, ws3, "Legenda");
  XLSX.writeFile(wb, caminho);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
