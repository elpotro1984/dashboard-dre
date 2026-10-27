import { setCaixaGrant } from "@/lib/auth/caixa";
import {
  acrescimosReservados,
  AVISO_EMPRESA_RESERVADA,
  podeConcederReservado,
  type EscopoDeEmpresas,
} from "@/lib/auth/concessao-reservada";
import { setContratosGrant } from "@/lib/auth/contratos";
import { DP_MODULE, type DpRole } from "@/lib/auth/dp";
import { COMPRAS_MODULE, FINANCEIRO_MODULE } from "@/lib/auth/module-access";
import { ORCAMENTO_MODULE, setOrcamentoSetores } from "@/lib/auth/orcamento";
import type { createAdminClient } from "@/lib/supabase/admin";
import {
  PERFIS_COMPRAS,
  PERFIS_DP,
  PERFIS_FINANCEIRO,
  PERFIS_ORCAMENTO,
  planoDeGravacao,
  validarAcessos,
  type AcessosForm,
  type PlanoDeGravacao,
} from "@/lib/usuarios/acessos";

// Executor do plano da tela de Usuários módulo → perfil (@/lib/usuarios/acessos).
// Sem "server-only" de propósito: o script da migração dos perfis
// (scripts/usuarios-migrar-perfis.ts) grava pelo MESMO executor. Ele recebe o
// client de fora e nunca é importado por componente de cliente.
// Service role: as policies de escrita destas tabelas são de admin (e a linha
// module='dp' só aceita o service role — gatilho dp_guard_module_grant). Quem
// chama já conferiu que é admin; as concessões RESERVADAS (DP e as empresas
// Dataforte, VE Franqueadora e SPDX) são conferidas aqui, em planoValidado.
//
// ORDEM das gravações: escopo (empresas, setores) → linhas de perfil →
// cadastro em `users`. É a ordem que nunca deixa a pessoa com MAIS acesso do
// que o pedido no meio do caminho: ao ganhar um módulo, o escopo já está pronto
// quando a marca liga; ao perder, o escopo some antes da marca desligar.

type Admin = ReturnType<typeof createAdminClient>;

/**
 * Valida o formulário vindo da tela CONTRA O CADASTRO (perfis do vocabulário,
 * empresas ativas, empresas e setores do Compras existentes) e devolve o plano.
 * O cliente nunca é a fonte da verdade: id desconhecido é recusado, não
 * ignorado — gravar escopo que a tela não mostra seria acesso invisível.
 *
 * `atorId` é quem salva (da SESSÃO, nunca do corpo) e decide as concessões
 * reservadas (@/lib/auth/concessao-reservada): o DP só é gravado quando é o
 * Lucas — para os demais, o que vier na seção do DP é ignorado e ela fica como
 * está —, e só ele acrescenta Dataforte, VE Franqueadora ou SPDX. `alvoId` é a
 * pessoa editada (null no convite: ainda não tem nada).
 */
export async function planoValidado(
  admin: Admin,
  form: AcessosForm,
  { atorId, alvoId }: { atorId: string; alvoId: string | null },
): Promise<{ plano: PlanoDeGravacao } | { error: string }> {
  if (!formBemFormado(form)) return { error: "Formulário de acessos inválido." };
  const reservado = podeConcederReservado(atorId);
  const erro = validarAcessos(form, { verDp: reservado, novo: alvoId === null });
  if (erro) return { error: erro };

  const [companies, orgs, sectors] = await Promise.all([
    admin.from("companies").select("id").eq("active", true),
    admin.from("ctrl_orgs").select("id").eq("ativo", true),
    admin.from("ctrl_sectors").select("id, org_id"),
  ]);
  if (companies.error || orgs.error || sectors.error) {
    return { error: (companies.error ?? orgs.error ?? sectors.error)!.message };
  }
  const empresas = new Set((companies.data ?? []).map((c) => c.id as string));
  const orgIds = new Set((orgs.data ?? []).map((o) => o.id as string));
  const orgDoSetor: Record<string, string | null> = Object.fromEntries(
    (sectors.data ?? []).map((s) => [s.id as string, (s.org_id as string | null) ?? null]),
  );

  const empresasPedidas = [
    ...(!form.admin && form.financeiro.ativo ? form.financeiro.empresas : []),
    ...(!form.admin && form.orcamento.ativo ? form.orcamento.empresas : []),
    // O DP vale também para admin: as empresas marcadas recortam o que ele vê.
    ...(reservado && form.dp.ativo ? form.dp.empresas : []),
  ];
  if (empresasPedidas.some((id) => !empresas.has(id))) return { error: "Empresa inválida ou inativa." };
  if (!form.admin) {
    if (form.compras.ativo) {
      if (form.compras.empresas.some((id) => !orgIds.has(id))) return { error: "Empresa do Compras inválida." };
      if (form.compras.setores.some((id) => !(id in orgDoSetor))) return { error: "Setor do Compras inválido." };
    }
  }

  let atual: Awaited<ReturnType<typeof escopoAtual>> = { empresas: ESCOPO_VAZIO, dpAtivo: false };
  if (alvoId) {
    try {
      atual = await escopoAtual(admin, alvoId);
    } catch (err) {
      return { error: (err as Error).message };
    }
  }
  const plano = planoDeGravacao(form, orgDoSetor, { gravarDp: reservado, dpAtualAtivo: atual.dpAtivo });
  if (!reservado && plano.escopo) {
    const acrescidas = acrescimosReservados(
      {
        financeiro: plano.escopo.empresasFinanceiro,
        orcamento: plano.escopo.empresasOrcamento,
        setoresOrcamento: plano.escopo.setoresOrcamento,
      },
      atual.empresas,
    );
    if (acrescidas.length > 0) return { error: AVISO_EMPRESA_RESERVADA };
  }
  return { plano };
}

const ESCOPO_VAZIO: EscopoDeEmpresas = { financeiro: [], orcamento: [], setoresOrcamento: {} };

/** O que a pessoa tem HOJE — a base para saber o que um pedido acrescenta e se o DP dela segue ativo. */
async function escopoAtual(admin: Admin, userId: string): Promise<{ empresas: EscopoDeEmpresas; dpAtivo: boolean }> {
  const [fin, orc, setores, dp] = await Promise.all([
    admin.from("user_company_access").select("company_id").eq("user_id", userId),
    admin.from("orcamento_user_empresas").select("company_id").eq("user_id", userId),
    admin.from("orcamento_user_setores").select("company_id, setor_nome").eq("user_id", userId),
    admin.from("user_module_roles").select("role").eq("user_id", userId).eq("module", DP_MODULE),
  ]);
  const erro = fin.error ?? orc.error ?? setores.error ?? dp.error;
  if (erro) throw new Error(erro.message);
  const setoresOrcamento: Record<string, string[]> = {};
  for (const s of setores.data ?? []) (setoresOrcamento[s.company_id as string] ??= []).push(s.setor_nome as string);
  return {
    empresas: {
      financeiro: (fin.data ?? []).map((r) => r.company_id as string),
      orcamento: (orc.data ?? []).map((r) => r.company_id as string),
      setoresOrcamento,
    },
    dpAtivo: (dp.data ?? []).some((r) => r.role === "gestor" || r.role === "analista"),
  };
}

const PERFIS_VALIDOS = {
  financeiro: new Set<string>(PERFIS_FINANCEIRO.map((p) => p.value)),
  orcamento: new Set<string>(PERFIS_ORCAMENTO.map((p) => p.value)),
  compras: new Set<string>(PERFIS_COMPRAS.map((p) => p.value)),
  dp: new Set<string>(PERFIS_DP.map((p) => p.value)),
};

/** Forma e vocabulário (o tipo do TypeScript não chega ao servidor). */
function formBemFormado(f: AcessosForm): boolean {
  const lista = (v: unknown) => Array.isArray(v) && v.every((x) => typeof x === "string");
  const perfil = (v: unknown, ok: Set<string>) => v === null || (typeof v === "string" && ok.has(v));
  try {
    return (
      typeof f.admin === "boolean" &&
      typeof f.caixa === "boolean" &&
      typeof f.case === "boolean" &&
      typeof f.contratos === "boolean" &&
      typeof f.financeiro.ativo === "boolean" &&
      perfil(f.financeiro.perfil, PERFIS_VALIDOS.financeiro) &&
      lista(f.financeiro.empresas) &&
      typeof f.orcamento.ativo === "boolean" &&
      perfil(f.orcamento.perfil, PERFIS_VALIDOS.orcamento) &&
      lista(f.orcamento.empresas) &&
      Object.values(f.orcamento.setores ?? {}).every(lista) &&
      typeof f.compras.ativo === "boolean" &&
      perfil(f.compras.perfil, PERFIS_VALIDOS.compras) &&
      lista(f.compras.empresas) &&
      lista(f.compras.setores) &&
      Object.values(f.compras.papelPorEmpresa ?? {}).every((p) => PERFIS_VALIDOS.compras.has(p)) &&
      typeof f.dp.ativo === "boolean" &&
      perfil(f.dp.perfil, PERFIS_VALIDOS.dp) &&
      lista(f.dp.empresas) &&
      // Opcional: uma aba aberta antes do campo existir manda sem ele (= desmarcado).
      (f.dp.todasEmpresas === undefined || typeof f.dp.todasEmpresas === "boolean")
    );
  } catch {
    return false;
  }
}

export async function gravarAcessos(
  admin: Admin,
  userId: string,
  plano: PlanoDeGravacao,
  autorId: string,
): Promise<{ error: string | null }> {
  try {
    const e = plano.escopo;
    if (e) {
      // user_company_access ANTES de orcamento_user_empresas: enquanto o
      // gatilho-espelho do passo 3 existir, gravar as unidades do Financeiro
      // também escreve no Orçamento — a gravação seguinte põe o Orçamento no
      // valor pedido, com ou sem o gatilho.
      await substituir(admin, "user_company_access", userId, e.empresasFinanceiro.map((company_id) => ({ company_id })));
      await substituir(admin, "ctrl_user_orgs", userId, e.comprasEmpresas);
      await substituir(admin, "user_sectors", userId, e.setoresCompras.map((sector_id) => ({ sector_id })));
      await substituir(admin, "orcamento_user_empresas", userId, e.empresasOrcamento.map((company_id) => ({ company_id })));
      const setores = await setOrcamentoSetores(admin, userId, e.setoresOrcamento, autorId);
      if (setores.error) throw new Error(setores.error);

      await definirLinha(admin, userId, FINANCEIRO_MODULE, e.linhas.financeiro, autorId);
      await definirLinha(admin, userId, COMPRAS_MODULE, e.linhas.compras, autorId);
      await definirLinha(admin, userId, ORCAMENTO_MODULE, e.linhas.orcamento, autorId);
      const caixa = await setCaixaGrant(admin, userId, e.linhas.caixa);
      if (caixa.error) throw new Error(caixa.error);
      const contratos = await setContratosGrant(admin, userId, e.linhas.contratos);
      if (contratos.error) throw new Error(contratos.error);
    }

    // DP à parte (vale também para admin) e só quando quem salva o concede —
    // plano.dp nulo = não mexer. Empresas antes da linha, como o resto.
    if (plano.dp) {
      const dpAntes = await estadoDp(admin, userId);
      await substituir(admin, "dp_user_empresas", userId, plano.dp.empresas.map((company_id) => ({ company_id, created_by: autorId })));
      await definirLinha(admin, userId, DP_MODULE, plano.dp.papel, autorId);
      await registrarDp(admin, userId, dpAntes, plano.dp.papel, plano.dp.empresas, autorId);
    }

    const { error } = await admin.from("users").update(plano.users).eq("id", userId);
    if (error) throw error;
    return { error: null };
  } catch (err) {
    const e = err as { message?: string } | null;
    return { error: e?.message ?? "Falha ao gravar os acessos." };
  }
}

/**
 * Apaga tudo do usuário na tabela e insere as linhas pedidas.
 *
 * Se a inserção falhar DEPOIS do delete (rede caiu — aconteceu na migração de
 * 26/10/2026 e deixou uma pessoa sem empresa no Compras), tenta de novo uma vez
 * e, falhando, DEVOLVE as linhas de antes: a pessoa nunca fica sem o escopo que
 * tinha por causa de uma gravação pela metade.
 */
async function substituir(
  admin: Admin,
  tabela: string,
  userId: string,
  linhas: Array<Record<string, unknown>>,
): Promise<void> {
  const { data: antes, error: readErr } = await admin.from(tabela).select("*").eq("user_id", userId);
  if (readErr) throw new Error(`${tabela}: ${readErr.message}`);

  const { error: delErr } = await admin.from(tabela).delete().eq("user_id", userId);
  if (delErr) throw new Error(`${tabela}: ${delErr.message}`);
  if (linhas.length === 0) return;

  const novas = linhas.map((l) => ({ user_id: userId, ...l }));
  let { error } = await admin.from(tabela).insert(novas);
  if (error) ({ error } = await admin.from(tabela).insert(novas));
  if (error) {
    if (antes && antes.length > 0) {
      const { error: volta } = await admin.from(tabela).insert(antes);
      if (volta) throw new Error(`${tabela}: ${error.message} — e NÃO foi possível devolver as linhas anteriores (${volta.message})`);
    }
    throw new Error(`${tabela}: ${error.message} (linhas anteriores devolvidas)`);
  }
}

/**
 * Deixa UMA linha do módulo em user_module_roles, com o papel pedido (ou
 * nenhuma, com null). O papel novo entra antes de os outros saírem: a pessoa
 * nunca fica sem linha no meio — mesmo cuidado da antiga tela de Acessos do DP.
 */
async function definirLinha(
  admin: Admin,
  userId: string,
  module: string,
  role: string | null,
  autorId: string,
): Promise<void> {
  if (role) {
    const { error } = await admin
      .from("user_module_roles")
      .upsert({ user_id: userId, module, role, granted_by: autorId }, { onConflict: "user_id,module,role" });
    if (error) throw new Error(`${module}: ${error.message}`);
  }
  let q = admin.from("user_module_roles").delete().eq("user_id", userId).eq("module", module);
  if (role) q = q.neq("role", role);
  const { error } = await q;
  if (error) throw new Error(`${module}: ${error.message}`);
}

async function estadoDp(admin: Admin, userId: string): Promise<{ papel: DpRole | null; empresas: string[] }> {
  const [roles, empresas] = await Promise.all([
    admin.from("user_module_roles").select("role").eq("user_id", userId).eq("module", DP_MODULE),
    admin.from("dp_user_empresas").select("company_id").eq("user_id", userId),
  ]);
  const papeis = (roles.data ?? []).map((r) => r.role as string);
  const papel: DpRole | null = papeis.includes("gestor") ? "gestor" : papeis.includes("analista") ? "analista" : null;
  return { papel, empresas: (empresas.data ?? []).map((r) => r.company_id as string).sort() };
}

/**
 * Trilha das concessões do DP (dp_concessoes), que a tela de Acessos gravava.
 * Melhor esforço, como lá: a concessão já valeu; o erro vai ao log.
 */
async function registrarDp(
  admin: Admin,
  userId: string,
  antes: { papel: DpRole | null; empresas: string[] },
  papel: DpRole | null,
  empresas: string[],
  autorId: string,
): Promise<void> {
  const depois = [...empresas].sort();
  if (antes.papel === papel && JSON.stringify(antes.empresas) === JSON.stringify(depois)) return;
  const acao = papel === null ? "removeu" : antes.papel === null ? "concedeu" : "alterou";
  const { error } = await admin.from("dp_concessoes").insert({
    alvo_user_id: userId,
    acao,
    papel,
    empresas: papel === null ? [] : depois,
    por_user_id: autorId,
  });
  if (error) console.error("[usuarios] registrar concessão do DP falhou:", error.message);
}
