/**
 * MIGRAÇÃO DOS PERFIS para o modelo módulo → perfil (passo 4 do desenho
 * docs/superpowers/specs/2026-10-26-usuarios-modulo-perfil.md).
 *
 *   npx tsx scripts/usuarios-migrar-perfis.ts            ← SIMULA (padrão, não grava nada)
 *   DRY=0 npx tsx scripts/usuarios-migrar-perfis.ts      ← grava
 *
 * RODAR NA VIRADA, junto com a tela nova virando padrão e a migration
 * 20261026130000 — não antes (ver o desenho, "Ordem dos passos 4 e 5").
 *
 * Para cada usuário: o acesso EFETIVO de hoje vira o formulário da tela nova
 * (acessosIniciais) e é gravado pelo MESMO executor da tela (gravarAcessos).
 * Decisões do dono do projeto aplicadas aqui:
 *   - quem tem o Compras E mais algum módulo fica SÓ com o Compras; os demais
 *     são reabilitados à mão pela planilha (scripts/usuarios-lista-permissoes.ts);
 *   - quem NÃO tem o Compras mantém todos os módulos;
 *   - todo Financeiro não-admin vira Visão Financeira (ou CSC, quem já é).
 *
 * A simulação calcula o acesso DEPOIS com a mesma conta da sessão e lista,
 * por usuário, tudo o que muda. Regra: só pode haver PERDA de acesso, e só as
 * decididas. Qualquer GANHO aparece marcado e faz o script recusar gravar.
 */
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";

import { canAccessPathByProfile } from "@/lib/auth/access";
import { computeModuleAccess } from "@/lib/auth/module-access";
import type { UserProfileType } from "@/lib/supabase/types";
import {
  acessosIniciais,
  planoDeGravacao,
  validarAcessos,
  type AcessoAtual,
  type AcessosForm,
  type PlanoDeGravacao,
} from "@/lib/usuarios/acessos";
import { carregarAcessos } from "@/lib/usuarios/carregar-acessos";
import { gravarAcessos } from "@/lib/usuarios/gravar-acessos";

const DRY = process.env.DRY !== "0";

const txt = readFileSync(".env.local", "utf8");
const get = (k: string) => (txt.match(new RegExp(`^${k}=(.*)$`, "m"))?.[1] ?? "").trim();
const db = createClient(get("NEXT_PUBLIC_SUPABASE_URL"), get("SUPABASE_SERVICE_ROLE_KEY"), {
  auth: { persistSession: false },
});

const ROTAS = [
  "/dashboard", "/fluxo-de-caixa", "/budget-forecast", "/comparativos-anuais", "/kpis", "/conexoes",
  "/financeiro/business-intelligence", "/financeiro/documentos", "/financeiro/validacao-relatorio",
  "/financeiro/relatorios", "/s/x/dashboard", "/s/x/mapeamento", "/ctrl/requisicoes", "/ctrl/aprovacoes",
  "/ctrl/contas-a-pagar", "/ctrl/orcamento", "/ctrl/orcamento/editar", "/ctrl/relatorios",
  "/ctrl/admin/fornecedores", "/ctrl/configuracoes", "/orcamento", "/case", "/contratos", "/caixa",
  "/dp", "/vb", "/usuarios", "/admin",
];

/** Decisão 7: com o Compras e mais algum módulo, fica só o Compras. */
function aplicarRegraDaMigracao(form: AcessosForm): { form: AcessosForm; retirados: string[] } {
  if (form.admin || !form.compras.ativo) return { form, retirados: [] };
  const retirados = [
    form.financeiro.ativo && "Financeiro",
    form.orcamento.ativo && "Orçamento",
    form.caixa && "Caixa",
    form.case && "Case",
    form.contratos && "Validação de Contratos",
    form.dp.ativo && "Departamento Pessoal",
  ].filter(Boolean) as string[];
  return {
    form: {
      ...form,
      financeiro: { ...form.financeiro, ativo: false },
      orcamento: { ...form.orcamento, ativo: false },
      caixa: false,
      case: false,
      contratos: false,
      dp: { ...form.dp, ativo: false },
    },
    retirados,
  };
}

type Retrato = { modulos: Record<string, unknown>; rotas: Set<string> };

function retratoDe(
  email: string,
  u: { profile: UserProfileType | null; role: string | null; contracts_only: boolean; can_financeiro: boolean; can_compras: boolean; can_case: boolean },
  moduleRoles: Array<{ module?: string | null; role?: string | null }>,
): Retrato {
  const a = computeModuleAccess({
    email,
    profile: u.profile,
    legacyRole: u.role,
    contractsOnly: u.contracts_only,
    canFinanceiro: u.can_financeiro,
    canCompras: u.can_compras,
    canCase: u.can_case,
    canViagens: false,
    canViagensAprovar: false,
    moduleRoles,
  });
  const rotas = new Set(
    ROTAS.filter((r) =>
      canAccessPathByProfile(r, u.profile ?? "solicitante", a.canFinanceiro, a.canCompras, a.canCase, false,
        a.canContratos, email, a.vbRole !== null, a.canCaixa, a.orcamentoPapel !== null, a.dpRole !== null,
        { financeiro: a.financeiroPerfil, compras: a.comprasPerfil }),
    ),
  );
  return {
    modulos: {
      compras: a.ctrlRoles.join("+") || null,
      financeiro: a.canFinanceiro ? a.financeiroPerfil : null,
      orcamento: a.orcamentoPapel,
      caixa: a.canCaixa,
      case: a.canCase,
      contratos: a.canContratos,
      dp: a.dpRole,
      vb: a.vbRole,
    },
    rotas,
  };
}

/** Linhas de user_module_roles depois do plano (as de fora da tela ficam). */
function linhasDepois(atual: AcessoAtual, plano: PlanoDeGravacao) {
  if (!plano.escopo) return atual.moduleRoles;
  const l = plano.escopo.linhas;
  const geridos = new Set(["financeiro", "compras", "orcamento", "caixa", "contratos", "dp"]);
  return [
    ...atual.moduleRoles.filter((r) => !geridos.has(String(r.module))),
    ...(l.financeiro ? [{ module: "financeiro", role: l.financeiro }] : []),
    ...(l.compras ? [{ module: "compras", role: l.compras }] : []),
    ...(l.orcamento ? [{ module: "orcamento", role: l.orcamento }] : []),
    ...(l.caixa ? [{ module: "caixa", role: "user" }] : []),
    ...(l.contratos ? [{ module: "contratos", role: "validador" }] : []),
    ...(l.dp ? [{ module: "dp", role: l.dp }] : []),
  ];
}

function igualLista(a: string[], b: string[]) {
  return JSON.stringify([...a].sort()) === JSON.stringify([...b].sort());
}

async function main() {
  console.log(DRY ? "SIMULAÇÃO — nada será gravado.\n" : "GRAVANDO.\n");

  const { usuarios, atual } = await carregarAcessos(db);
  const { data: sectors, error } = await db.from("ctrl_sectors").select("id, org_id");
  if (error) throw error;
  const orgDoSetor = Object.fromEntries((sectors ?? []).map((s) => [s.id as string, (s.org_id as string | null) ?? null]));

  let ganhos = 0;
  let invalidos = 0;
  let mudam = 0;
  let semAcessoHoje = 0;
  const planos: Array<{ id: string; nome: string; plano: PlanoDeGravacao }> = [];

  for (const u of usuarios) {
    const a = atual.get(u.id)!;
    const inicial = acessosIniciais(a);
    const { form, retirados } = aplicarRegraDaMigracao(inicial.form);
    const nome = `${u.name || "(sem nome)"} <${u.email}>${u.active ? "" : " [inativo]"}`;

    // Sem acesso nenhum hoje (cadastro pendente, perfil vazio): não há o que
    // migrar, e gravar não daria nada a ninguém. Dito, não calado.
    const semAcesso =
      !form.admin &&
      !form.financeiro.ativo && !form.orcamento.ativo && !form.compras.ativo &&
      !form.caixa && !form.case && !form.contratos && !form.dp.ativo &&
      retirados.length === 0;
    if (semAcesso) {
      semAcessoHoje++;
      console.log(`- ${nome}: sem acesso hoje — nada a migrar`);
      continue;
    }

    const erro = validarAcessos(form, u.email);
    if (erro) {
      invalidos++;
      console.log(`! ${nome}: NÃO MIGRA — ${erro}`);
      continue;
    }
    const plano = planoDeGravacao(form, orgDoSetor);
    planos.push({ id: u.id, nome, plano });

    const antes = retratoDe(u.email, {
      profile: a.profile, role: a.legacyRole, contracts_only: a.contractsOnly,
      can_financeiro: a.canFinanceiro, can_compras: a.canCompras, can_case: a.canCase,
    }, a.moduleRoles);
    const depois = retratoDe(u.email, plano.users, linhasDepois(a, plano));

    const linhas: string[] = [];
    for (const k of Object.keys(antes.modulos)) {
      if (JSON.stringify(antes.modulos[k]) !== JSON.stringify(depois.modulos[k])) {
        linhas.push(`${k}: ${JSON.stringify(antes.modulos[k])} → ${JSON.stringify(depois.modulos[k])}`);
      }
    }
    const perdeu = ROTAS.filter((r) => antes.rotas.has(r) && !depois.rotas.has(r));
    const ganhou = ROTAS.filter((r) => !antes.rotas.has(r) && depois.rotas.has(r));
    if (perdeu.length) linhas.push(`perde rotas: ${perdeu.join(", ")}`);
    if (ganhou.length) {
      ganhos++;
      linhas.push(`!!! GANHA rotas: ${ganhou.join(", ")}`);
    }
    // Escopo: só pode encolher ou ficar igual.
    if (plano.escopo) {
      if (!plano.escopo.empresasFinanceiro.every((c) => a.empresasFinanceiro.includes(c))) {
        ganhos++;
        linhas.push("!!! GANHA empresa no Financeiro");
      }
      if (!plano.escopo.empresasOrcamento.every((c) => a.empresasOrcamento.includes(c))) {
        ganhos++;
        linhas.push("!!! GANHA empresa no Orçamento");
      }
      if (plano.escopo.empresasFinanceiro.length && !igualLista(plano.escopo.empresasFinanceiro, a.empresasFinanceiro)) {
        linhas.push("empresas do Financeiro mudam");
      }
    }
    if (retirados.length) linhas.push(`retirados pela regra (reabilitar pela planilha): ${retirados.join(", ")}`);
    if (linhas.length) {
      mudam++;
      console.log(`~ ${nome}\n    ${linhas.join("\n    ")}`);
    }
  }

  console.log(
    `\n${usuarios.length} usuários · ${mudam} mudam · ${semAcessoHoje} sem acesso hoje (pulados) · ${invalidos} não migram (formulário inválido) · ${ganhos} GANHO(S) de acesso`,
  );

  if (ganhos > 0 || invalidos > 0) {
    console.log("\nRECUSADO: há ganho de acesso ou usuário que não migra. Nada foi gravado.");
    process.exit(2);
  }
  if (DRY) {
    console.log("\nSimulação OK. Para gravar: DRY=0 npx tsx scripts/usuarios-migrar-perfis.ts");
    return;
  }

  // Autor da gravação: o primeiro admin ativo (o service role não tem usuário).
  const { data: autor } = await db.from("users").select("id").eq("profile", "admin").eq("active", true).limit(1).maybeSingle();
  let falhas = 0;
  for (const p of planos) {
    const { error: e } = await gravarAcessos(db as never, p.id, p.plano, (autor?.id as string) ?? p.id);
    if (e) {
      falhas++;
      console.log(`✗ ${p.nome}: ${e}`);
    }
  }
  console.log(falhas === 0 ? `\nGravado: ${planos.length} usuários.` : `\n${falhas} falha(s) — rode o retrato e confira.`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
