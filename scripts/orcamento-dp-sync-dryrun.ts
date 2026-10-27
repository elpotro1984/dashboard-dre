/**
 * Ensaio do sync DP → quadro de pessoal do Orçamento, contra o banco real.
 *
 * Responde, empresa a empresa: quantas pessoas entrariam, quantos
 * departamentos precisam de de-para, quantas vêm sem salário, quantas já estão
 * no quadro. É o que diz se vale clicar antes de clicar.
 *
 *   npx tsx --env-file=.env.local scripts/orcamento-dp-sync-dryrun.ts [ano]
 *
 * **Só CONTAGENS saem daqui** — nunca nome, CPF ou salário. É a mesma regra do
 * cron do DP: o terminal e o log são lidos por outras pessoas, e o módulo é
 * sigiloso. Não "melhore" o relatório listando quem é quem.
 *
 * NÃO escreve nada. Também não depende da migration `20261027120000`: o de-para
 * ainda não existe, então o ensaio mostra o que a SUGESTÃO por nome resolveria.
 */

import { createClient } from "@supabase/supabase-js";

import {
  chaveDepartamento,
  montarPrevia,
  sugerirDePara,
  vinculoDoContrato,
  type DpPessoa,
  type QuadroLinha,
} from "../src/lib/orcamento/dp-sync";
import { indexarRegras, resolverEmpresa, type DpEmpresaRegra } from "../src/lib/dp/empresa";
import { resolverLinha } from "../src/lib/dp/vinculo";
import { nomeCargo } from "../src/lib/dp/cargos";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("Faltam NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY.");
  process.exit(1);
}
const db = createClient(url, key, { auth: { persistSession: false } });

const ANO = Number(process.argv[2] ?? new Date().getFullYear() + 1);

function semSufixoDaEmpresa(nome: string | null): string | null {
  const bruto = (nome ?? "").trim();
  if (!bruto) return null;
  const corte = bruto.lastIndexOf(" - ");
  const area = corte > 0 ? bruto.slice(0, corte) : bruto;
  return area.trim() || null;
}

async function main() {
  console.log(`\n=== Ensaio do sync DP → Orçamento ${ANO} (somente leitura) ===\n`);

  const [colabs, regras, empresas, setores, config, quadro, tabelas, vinculos, ajustes] =
    await Promise.all([
      db
        .from("dp_colaboradores")
        .select(
          "solides_id, nome, unidade_id, departamento_id, departamento_nome, cargo_id, cargo_nome, tipo_contrato, salario, data_desligamento",
        )
        .eq("ativo", true),
      db.from("dp_empresa_regras").select("origem, solides_id, company_id"),
      db.from("companies").select("id, name").eq("active", true),
      db.from("orcamento_setores").select("id, name, company_id").eq("year", ANO),
      db.from("orcamento_company_config").select("company_id, orcar_por_setor").eq("year", ANO),
      db
        .from("orcamento_pessoal_colaboradores")
        .select("id, company_id, setor_id, nome, cargo_atual, salario_atual, vinculo, cancelado_em")
        .eq("year", ANO),
      db.from("dp_tabela_salarial").select("id, company_id, setor, cargo, senioridade, step, salario"),
      db.from("dp_cargo_vinculos").select("company_id, solides_cargo_id, linha_id"),
      db.from("dp_colaborador_ajustes").select("solides_id, linha_id"),
    ]);

  for (const [nome, r] of Object.entries({ colabs, regras, empresas, setores, quadro, tabelas })) {
    if (r.error) {
      console.error(`Falha lendo ${nome}: ${r.error.message}`);
      process.exit(1);
    }
  }

  const nomeDaEmpresa = new Map(
    (empresas.data ?? []).map((c) => [c.id as string, c.name as string]),
  );
  const regrasIdx = indexarRegras(
    (regras.data ?? []).map((r) => ({
      origem: r.origem as DpEmpresaRegra["origem"],
      solidesId: Number(r.solides_id),
      companyId: r.company_id as string,
    })),
  );

  const linhaPorId = new Map(
    (tabelas.data ?? []).map((l) => [
      l.id as string,
      {
        companyId: l.company_id as string,
        nome: nomeCargo({
          cargo: (l.cargo as string) ?? "",
          senioridade: (l.senioridade as string) ?? null,
          step: (l.step as string) ?? null,
        }),
      },
    ]),
  );
  const linhaPorCargo = new Map<string, string>();
  for (const v of vinculos.data ?? []) {
    linhaPorCargo.set(`${v.company_id as string}|${Number(v.solides_cargo_id)}`, v.linha_id as string);
  }
  const excecao = new Map<number, string>();
  for (const a of ajustes.data ?? []) {
    if (a.linha_id) excecao.set(Number(a.solides_id), a.linha_id as string);
  }

  // Agrupa os ativos do DP por empresa resolvida.
  const porEmpresa = new Map<string, DpPessoa[]>();
  let semEmpresa = 0;
  for (const c of colabs.data ?? []) {
    const res = resolverEmpresa(
      {
        unidadeId: c.unidade_id == null ? null : Number(c.unidade_id),
        departamentoId: c.departamento_id == null ? null : Number(c.departamento_id),
      },
      regrasIdx,
    );
    if (!res.companyId) {
      semEmpresa += 1;
      continue;
    }
    const solidesId = Number(c.solides_id);
    const { linhaId } = resolverLinha({
      excecaoLinhaId: excecao.get(solidesId) ?? null,
      linhaDoCargoId:
        c.cargo_id == null
          ? null
          : linhaPorCargo.get(`${res.companyId}|${Number(c.cargo_id)}`) ?? null,
    });
    const linha = linhaId ? linhaPorId.get(linhaId) ?? null : null;

    const lista = porEmpresa.get(res.companyId) ?? [];
    lista.push({
      solidesId: String(solidesId),
      nome: ((c.nome as string) ?? "").trim(),
      departamento: semSufixoDaEmpresa(c.departamento_nome as string | null),
      cargoSolides: ((c.cargo_nome as string) ?? "").trim() || null,
      cargoDaLinha: linha?.nome || null,
      salario: c.salario == null ? null : Number(c.salario),
      tipoContrato: ((c.tipo_contrato as string) ?? "").trim() || null,
      dataDesligamento: (c.data_desligamento as string) ?? null,
    });
    porEmpresa.set(res.companyId, lista);
  }

  console.log(
    `Ativos no DP: ${(colabs.data ?? []).length} · sem empresa no de-para do DP: ${semEmpresa}\n`,
  );

  const orcaPorSetor = new Map(
    (config.data ?? []).map((c) => [c.company_id as string, Boolean(c.orcar_por_setor)]),
  );

  // Só as empresas que TÊM orçamento neste ano (setor cadastrado ou quadro).
  const comOrcamento = new Set<string>([
    ...(setores.data ?? []).map((s) => s.company_id as string),
    ...(quadro.data ?? []).map((q) => q.company_id as string),
  ]);

  let totalNovas = 0;
  let totalFora = 0;
  let totalSemSalario = 0;
  const vinculosVistos = new Map<string, number>();

  for (const companyId of Array.from(comOrcamento).sort((a, b) =>
    (nomeDaEmpresa.get(a) ?? "").localeCompare(nomeDaEmpresa.get(b) ?? "", "pt-BR"),
  )) {
    const pessoas = porEmpresa.get(companyId) ?? [];
    if (pessoas.length === 0) continue;

    const setoresDoAno = (setores.data ?? [])
      .filter((s) => s.company_id === companyId)
      .map((s) => ({ id: s.id as string, name: (s.name as string) ?? "" }));

    const linhasQuadro: QuadroLinha[] = (quadro.data ?? [])
      .filter((q) => q.company_id === companyId && !q.cancelado_em)
      .map((q) => ({
        id: q.id as string,
        nome: (q.nome as string) ?? null,
        setorId: (q.setor_id as string) ?? null,
        cargoAtual: (q.cargo_atual as string) ?? null,
        salarioAtual: q.salario_atual == null ? null : Number(q.salario_atual),
        vinculo: (q.vinculo as string) ?? "clt",
        travado: false,
      }));

    const porSetor = orcaPorSetor.get(companyId) ?? false;
    // Sem a migration aplicada não há de-para gravado: o ensaio mede o que a
    // SUGESTÃO por nome resolveria, que é o melhor caso.
    const deParaSugerido = sugerirDePara(
      pessoas.map((p) => p.departamento ?? "").filter(Boolean),
      setoresDoAno,
    );

    const previa = montarPrevia({
      pessoas,
      quadro: linhasQuadro,
      dePara: deParaSugerido,
      setoresDoAno,
      orcaPorSetor: porSetor,
    });

    for (const p of pessoas) {
      const v = vinculoDoContrato(p.tipoContrato);
      const chave = v.aviso ? `${v.vinculo} (com aviso)` : v.vinculo;
      vinculosVistos.set(chave, (vinculosVistos.get(chave) ?? 0) + 1);
    }

    totalNovas += previa.resumo.novas;
    totalFora += previa.resumo.fora;
    totalSemSalario += previa.resumo.semSalario;

    const deps = new Set(pessoas.map((p) => chaveDepartamento(p.departamento)).filter(Boolean));
    console.log(`${nomeDaEmpresa.get(companyId) ?? companyId}`);
    console.log(
      `  DP: ${pessoas.length} ativo(s) · ${deps.size} departamento(s) · quadro ${ANO}: ${linhasQuadro.length} linha(s) · orça por setor: ${porSetor ? "sim" : "não"}`,
    );
    console.log(
      `  prévia: ${previa.resumo.novas} nova(s) · ${previa.resumo.conflitos} com diferença · ${previa.resumo.iguais} igual(is) · ${previa.resumo.fora} fora`,
    );
    if (porSetor) {
      const casados = deps.size - previa.departamentosNaoMapeados.length;
      console.log(
        `  de-para de setor: ${casados}/${deps.size} departamento(s) a sugestão por nome resolve` +
          (previa.departamentosNaoMapeados.length > 0
            ? ` · ${previa.departamentosNaoMapeados.length} precisam de escolha à mão`
            : ""),
      );
    }
    if (previa.resumo.semSalario > 0) {
      console.log(`  ${previa.resumo.semSalario} sem salário na Sólides (entram em branco)`);
    }
    if (previa.apenasNoQuadro.length > 0) {
      console.log(
        `  ${previa.apenasNoQuadro.length} no quadro e não no DP (nada é removido — pode ser contratação planejada)`,
      );
    }
    console.log("");
  }

  console.log("=== Totais ===");
  console.log(
    `${totalNovas} pessoa(s) entrariam no quadro · ${totalFora} ficariam de fora · ${totalSemSalario} sem salário`,
  );
  console.log(
    "Vínculo derivado do tipo de contrato: " +
      Array.from(vinculosVistos.entries())
        .sort((a, b) => b[1] - a[1])
        .map(([k, n]) => `${k}: ${n}`)
        .join(" · "),
  );
  console.log("\nNada foi gravado.\n");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
