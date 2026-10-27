"use server";

import { revalidatePath } from "next/cache";

import { createAdminClient } from "@/lib/supabase/admin";
import { autorizarSyncDp, lerFonteDp, type LinhaDoDp } from "@/lib/orcamento/dp-fonte";
import {
  chaveDepartamento,
  indexarDePara,
  itensParaGravar,
  montarPrevia,
  sugerirDePara,
  type PreviaDpItem,
  type PreviaDpSync,
  type QuadroLinha,
} from "@/lib/orcamento/dp-sync";
import {
  createColaborador,
  getColaboradores,
  updateColaborador,
  type Colaborador,
  type ColaboradorInput,
} from "@/lib/orcamento/actions/pessoal";
import { getFinalizacoes } from "@/lib/orcamento/actions/finalizacao";
import {
  CATEGORIA_METODO_INTEIRO,
  finalizacaoDe,
  indexarFinalizacoes,
} from "@/lib/orcamento/finalizacao";

// =============================================================================
// Puxar o quadro do DP para o Orçamento, empresa a empresa.
//
// Duas regras de desenho que valem para o arquivo inteiro:
//
//  1. **A prévia é SEMPRE remontada no servidor antes de gravar.** O cliente
//     manda só os ids que o admin marcou; o que cada id significa é recalculado
//     aqui. Confiar na prévia que voltou do navegador deixaria gravar cargo e
//     salário arbitrários por uma requisição montada à mão.
//
//  2. **Gravar é pelas MESMAS actions da tela** (`createColaborador` /
//     `updateColaborador`). Não há INSERT próprio aqui. É a regra que a
//     importação da planilha do Compras e a da cotação de viagens já seguem:
//     um segundo caminho de escrita aceitaria o que a tela recusa — e seria
//     justamente o caminho em LOTE a passar o erro adiante. De graça vêm o
//     recorte por setor, a trava da finalização, a trava da diretoria e a
//     trilha, inclusive as que ainda não existem.
// =============================================================================

const PATH = "/orcamento";

export interface DpSyncPrevia extends PreviaDpSync {
  /** Departamentos do DP sem setor no de-para, com a sugestão por nome quando há. */
  deParaPendente: Array<{ departamento: string; sugestao: string | null }>;
  /** O de-para já gravado, para a tela mostrar e editar. */
  dePara: Array<{ departamento: string; setorNome: string }>;
  /** Setores do ano, para o seletor do de-para. */
  setores: Array<{ id: string; name: string }>;
  orcaPorSetor: boolean;
  /** Ativos do DP cujo de-para de EMPRESA (do próprio DP) não resolve. */
  semEmpresaNoDp: number;
  /** As linhas da tabela salarial do DP, para o cargo da movimentação. */
  linhas: LinhaDoDp[];
}

/** Lê os dois lados e monta a prévia. Não grava nada. */
export async function getDpSyncPrevia(
  companyId: string,
  year: number,
): Promise<{ previa?: DpSyncPrevia; error?: string }> {
  const auth = await autorizarSyncDp();
  if (!auth.ok) return { error: auth.error };

  const contexto = await lerContexto(companyId, year);
  if ("error" in contexto) return { error: contexto.error };

  const { fonte, dePara, setores, orcaPorSetor } = contexto;
  const previa = montar(contexto);

  // A sugestão por nome é o que faz a tela abrir preenchida — padrão do módulo
  // (o modelo da planilha de grupos também vem com a grade pronta). Quem
  // confirma é o admin: casar por nome na hora é justamente o que esta tela
  // existe para evitar.
  const sugestoes = sugerirDePara(previa.departamentosNaoMapeados, setores);

  return {
    previa: {
      ...previa,
      deParaPendente: previa.departamentosNaoMapeados.map((d) => ({
        departamento: d,
        sugestao: sugestoes.get(chaveDepartamento(d)) ?? null,
      })),
      dePara,
      setores,
      orcaPorSetor,
      semEmpresaNoDp: fonte.semEmpresaNoDp,
      linhas: fonte.linhas,
    },
  };
}

export interface DpSyncResultado {
  criados: number;
  atualizados: number;
  /** Falha POR ITEM, com o nome — uma pessoa travada não custa as outras 199. */
  falhas: Array<{ nome: string; motivo: string }>;
}

/**
 * Grava os itens marcados.
 *
 * Nada é gravado sem a marca do admin (decisão de 27/10/2026: o sync SÓ SUGERE).
 * `itensParaGravar` filtra o que veio marcado contra o que a prévia DO SERVIDOR
 * diz ser gravável, então um id "fora" ou "igual" que chegue marcado é
 * descartado em silêncio — a tela não o oferece, mas o cliente não decide o que
 * o servidor aceita.
 */
export async function aplicarDpSync(
  companyId: string,
  year: number,
  marcados: string[],
): Promise<{ resultado?: DpSyncResultado; error?: string }> {
  const auth = await autorizarSyncDp();
  if (!auth.ok) return { error: auth.error };
  if (marcados.length === 0) return { error: "Nenhuma pessoa foi marcada." };

  const contexto = await lerContexto(companyId, year);
  if ("error" in contexto) return { error: contexto.error };
  const { colaboradores } = contexto;

  // A MESMA montagem da prévia: o cliente manda só os ids marcados, e o que
  // cada id significa é recalculado aqui.
  const itens = itensParaGravar(montar(contexto), marcados);
  if (itens.length === 0) {
    return { error: "Nada a gravar: as pessoas marcadas já estão iguais ou não podem entrar." };
  }

  const porId = new Map(colaboradores.map((c) => [c.id, c]));
  const resultado: DpSyncResultado = { criados: 0, atualizados: 0, falhas: [] };

  for (const item of itens) {
    const r =
      item.estado === "nova"
        ? await createColaborador(companyId, year, inputNovo(item))
        : await updateColaborador(item.quadroId!, inputMesclado(item, porId.get(item.quadroId!)));

    if (r && "error" in r && r.error) {
      resultado.falhas.push({ nome: item.nome, motivo: r.error });
    } else if (r && "needsMigration" in r && r.needsMigration) {
      resultado.falhas.push({
        nome: item.nome,
        motivo: "As tabelas do módulo Orçamento ainda não foram aplicadas no banco.",
      });
    } else if (item.estado === "nova") {
      resultado.criados += 1;
    } else {
      resultado.atualizados += 1;
    }
  }

  revalidatePath(PATH);
  return { resultado };
}

/** Pessoa nova: só o que o DP sabe. Movimentação e benefício ficam em branco. */
function inputNovo(item: PreviaDpItem): ColaboradorInput {
  return {
    setorId: item.setorId,
    empresaEncargosId: null,
    nome: item.nome,
    vinculo: item.vinculo,
    cargoAtual: item.cargo,
    salarioAtual: item.salario,
    // Movimentação é decisão do GESTOR (decidido em 27/10/2026) — o sync nunca
    // escreve uma, nem o desligamento que o cadastro já conhece. A data dele vai
    // como aviso na prévia e o gestor registra se quiser.
    mov1: null,
    mov2: null,
    justificativa: null,
  };
}

/**
 * Conflito: parte da linha que EXISTE e troca só o que o DP é fonte.
 *
 * `updateColaborador` faz um UPDATE da linha inteira, então montar o input só
 * com cargo e salário APAGARIA movimentação, justificativa e a empresa dos
 * encargos — o trabalho do gestor, sem nada avisar. A pessoa some do quadro
 * dele? Não: ela fica com o cargo certo e sem a movimentação que ele montou,
 * que é pior, porque não dá erro.
 */
function inputMesclado(item: PreviaDpItem, atual: Colaborador | undefined): ColaboradorInput {
  return {
    // O setor acompanha o de-para: é o que o admin acabou de confirmar.
    setorId: item.setorId ?? atual?.setorId ?? null,
    empresaEncargosId: atual?.empresaEncargosId ?? null,
    nome: item.nome,
    vinculo: item.vinculo,
    cargoAtual: item.cargo,
    salarioAtual: item.salario,
    mov1: atual?.mov1 ?? null,
    mov2: atual?.mov2 ?? null,
    justificativa: atual?.justificativa ?? null,
  };
}

/** Grava o de-para departamento → setor. Substitui a lista inteira. */
export async function salvarDpSetorDePara(
  companyId: string,
  linhas: Array<{ departamento: string; setorNome: string }>,
): Promise<{ ok?: true; gravadas?: number; error?: string }> {
  const auth = await autorizarSyncDp();
  if (!auth.ok) return { error: auth.error };
  if (!companyId) return { error: "Selecione uma empresa." };

  const limpas = linhas
    .map((l) => ({
      departamento: (l.departamento ?? "").trim(),
      setorNome: (l.setorNome ?? "").trim(),
    }))
    .filter((l) => l.departamento && l.setorNome);

  // Dedupe por chave, última grafia vence: a tela pode mandar o mesmo
  // departamento duas vezes se alguém editar a lista rápido, e o UNIQUE
  // derrubaria o lote inteiro.
  const porChave = new Map<string, { departamento: string; setorNome: string }>();
  for (const l of limpas) porChave.set(chaveDepartamento(l.departamento), l);

  const db = createAdminClient();
  // SUBSTITUI a lista: upsert puro não faria "tirar do de-para" funcionar —
  // o vínculo removido da tela continuaria no banco e as pessoas seguiriam
  // entrando no setor antigo. Mesma escolha de `setOrcamentoSetores`.
  const { error: errDel } = await db
    .from("orcamento_dp_setores")
    .delete()
    .eq("company_id", companyId);
  if (errDel) {
    if (isSchemaMissing(errDel.message)) return { error: MIGRATION_PENDENTE };
    return { error: errDel.message };
  }

  if (porChave.size === 0) return { ok: true, gravadas: 0 };

  const { error } = await db.from("orcamento_dp_setores").insert(
    Array.from(porChave.entries()).map(([chave, l]) => ({
      company_id: companyId,
      departamento: l.departamento,
      departamento_chave: chave,
      setor_nome: l.setorNome,
      updated_by: auth.user.userId,
    })),
  );
  if (error) {
    if (isSchemaMissing(error.message)) return { error: MIGRATION_PENDENTE };
    return { error: error.message };
  }

  revalidatePath(PATH);
  return { ok: true, gravadas: porChave.size };
}

// ─── Leitura compartilhada pela prévia e pela gravação ──────────────────────

const MIGRATION_PENDENTE =
  "A migration do de-para de setores do DP (20261027120000) ainda não foi aplicada.";

type Contexto = Exclude<Awaited<ReturnType<typeof lerContexto>>, { error: string }>;

/** A prévia, montada de UM jeito só — a tela e a gravação leem a mesma conta. */
function montar(c: Contexto): PreviaDpSync {
  return montarPrevia({
    pessoas: c.fonte.pessoas,
    quadro: c.quadro,
    dePara: indexarDePara(c.dePara),
    setoresDoAno: c.setores.map((s) => ({ id: s.id, name: s.name })),
    orcaPorSetor: c.orcaPorSetor,
    setoresFechados: c.setoresFechados,
  });
}

async function lerContexto(companyId: string, year: number) {
  if (!companyId) return { error: "Selecione uma empresa." as string };

  const db = createAdminClient();
  const [fonte, cfg, setoresRes, deParaRes, colabsRes, finaisRes] = await Promise.all([
    lerFonteDp(companyId),
    db
      .from("orcamento_company_config")
      .select("orcar_por_setor")
      .eq("company_id", companyId)
      .eq("year", year)
      .maybeSingle(),
    db
      .from("orcamento_setores")
      .select("id, name")
      .eq("company_id", companyId)
      .eq("year", year)
      .order("name"),
    db
      .from("orcamento_dp_setores")
      .select("departamento, setor_nome")
      .eq("company_id", companyId),
    // Pelas actions da TELA, não por consulta própria: é de lá que vem o
    // ESTADO da decisão da diretoria já resolvido, e o recorte de leitura.
    getColaboradores(companyId, year, null),
    getFinalizacoes(companyId, year),
  ]);

  if (colabsRes.error) return { error: colabsRes.error };
  if (deParaRes.error && isSchemaMissing(deParaRes.error.message)) {
    return { error: MIGRATION_PENDENTE };
  }

  const colaboradores = colabsRes.items ?? [];
  const quadro: QuadroLinha[] = colaboradores
    // Cancelado pela diretoria continua na tela riscado, mas não é alvo de
    // sincronização: sobrescrever o cargo de uma contratação cancelada não
    // tem sentido, e ele volta como "só no quadro" no aviso.
    .filter((c) => !c.canceladoEm)
    .map((c) => {
      // **Não use `c.travado`**: ele é `!podeDecidir(papel) && …`, e quem roda
      // este sync é sempre ADMIN — para ele a trava da validação nunca acende
      // (admin e diretoria passam sempre). O que importa aqui é outra coisa:
      // existe uma DECISÃO gravada? Se existe, o UPDATE do sync a venceria
      // (`decisaoVencida`) e o ✓ do diretor cairia para `pendente`, tirando o
      // valor da Prévia aprovada sem ninguém pedir.
      const estado = (c as unknown as { estado?: string }).estado ?? "pendente";
      const decidida = estado === "aprovado" || estado === "reprovado";
      return {
        id: c.id,
        nome: c.nome,
        setorId: c.setorId,
        cargoAtual: c.cargoAtual,
        salarioAtual: c.salarioAtual,
        vinculo: c.vinculo,
        travado: decidida,
        travadoMotivo: decidida ? `a diretoria marcou esta linha como ${estado}` : null,
      };
    });

  // A fatia do pessoal é o SETOR INTEIRO (`category_code = ''`): salários,
  // encargos e benefícios vão juntos ao Budget, porque o motor é linear por
  // colaborador. Então basta saber quais setores estão fechados.
  const indice = indexarFinalizacoes(finaisRes.items ?? []);
  const setoresFechados = new Set<string | null>();
  for (const alvo of [null, ...((setoresRes.data ?? []) as Array<Record<string, unknown>>).map((r) => r.id as string)]) {
    const fechada = finalizacaoDe(indice, {
      metodo: "pessoal",
      categoryCode: CATEGORIA_METODO_INTEIRO,
      setorId: alvo,
    });
    if (fechada) setoresFechados.add(alvo);
  }

  return {
    fonte,
    quadro,
    colaboradores,
    setoresFechados,
    dePara: ((deParaRes.data ?? []) as Array<Record<string, unknown>>).map((r) => ({
      departamento: r.departamento as string,
      setorNome: r.setor_nome as string,
    })),
    setores: ((setoresRes.data ?? []) as Array<Record<string, unknown>>).map((r) => ({
      id: r.id as string,
      name: (r.name as string) ?? "",
    })),
    orcaPorSetor: Boolean(cfg.data?.orcar_por_setor),
  };
}

function isSchemaMissing(msg: string): boolean {
  return /does not exist|42P01|42703|PGRST205/i.test(msg);
}
