// ============================================================================
// PROMOÇÃO feita na própria folha — puro e testado. Decisão do dono do projeto
// (22/10/2026): o DP escolhe o cargo novo na folha (da tabela salarial, com o
// salário já sugerido) e o mês de início; a folha passa a usar o cargo e o
// salário novos dali em diante, e a pessoa aparece "pendente na Sólides" até a
// sincronização trazer a mudança. A Sólides continua sendo a fonte do cadastro:
// a promoção registrada aqui é uma PONTE até ela, não um segundo cadastro.
//
// A regra que decide quem vale, a Sólides ou a promoção, compara o SALÁRIO da
// Sólides de hoje com o da promoção e com o que a Sólides tinha no registro:
//   - igual ao da promoção     → REFLETIDA: a folha volta a seguir a Sólides;
//   - ainda o do registro      → PENDENTE: a folha usa a promoção;
//   - outro valor              → DIVERGENTE: a folha segue a Sólides e avisa
//     (o DP lançou outro número lá — a fonte oficial ganha, e a tela diz).
// Pessoa FORA da Sólides (avulso) não tem para onde refletir: a promoção vale
// sempre. É o salário, não o cargo, que decide: nome de cargo muda de grafia
// entre os dois cadastros, e é o salário que a folha calcula.
//
// O caso que a Sólides sozinha erraria: o DP atualiza a Sólides ANTES do mês de
// início (promoção decidida em outubro, valendo em novembro). Como a Sólides
// não tem histórico, a folha de outubro, ainda aberta, passaria a usar o
// salário novo. Com a promoção registrada antes da atualização, a folha sabe o
// salário de antes e o usa nos meses anteriores ao início.
// ============================================================================

export interface DpPromocao {
  id: string;
  solidesId: number;
  /** Competência (AAAA-MM) em que a promoção começa a valer. */
  vigencia: string;
  linhaId: string | null;
  setor: string;
  cargo: string;
  salario: number;
  cargoAnterior: string | null;
  salarioAnterior: number | null;
  /** Salário da Sólides quando a promoção foi registrada (null = pessoa fora da Sólides). */
  salarioSolidesNoRegistro: number | null;
  motivo: string | null;
  criadaEm: string;
}

export type DpEstadoPromocao = "pendente" | "refletida" | "divergente" | "fora_da_solides";

export const ROTULO_ESTADO_PROMOCAO: Record<DpEstadoPromocao, string> = {
  pendente: "pendente na Sólides",
  refletida: "já na Sólides",
  divergente: "Sólides com outro valor",
  fora_da_solides: "pessoa fora da Sólides",
};

const MESES = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
const rotuloMes = (c: string) => `${MESES[Number(c.slice(5, 7)) - 1]}/${c.slice(0, 4)}`;
const brl = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const igual = (a: number | null, b: number | null) => (a === null || b === null ? a === b : Math.abs(a - b) < 0.005);

/** A promoção que vale no mês: a de início mais recente que não passa dele. */
export function promocaoVigente(lista: DpPromocao[], competencia: string): DpPromocao | null {
  let melhor: DpPromocao | null = null;
  for (const p of lista) if (p.vigencia <= competencia && (!melhor || p.vigencia > melhor.vigencia)) melhor = p;
  return melhor;
}

/** A primeira promoção com início DEPOIS do mês. */
export function proximaPromocao(lista: DpPromocao[], competencia: string): DpPromocao | null {
  let melhor: DpPromocao | null = null;
  for (const p of lista) if (p.vigencia > competencia && (!melhor || p.vigencia < melhor.vigencia)) melhor = p;
  return melhor;
}

export function estadoPromocao(p: DpPromocao, atual: { salarioSolides: number | null; avulso: boolean }): DpEstadoPromocao {
  if (atual.avulso) return "fora_da_solides";
  if (igual(atual.salarioSolides, p.salario)) return "refletida";
  return igual(atual.salarioSolides, p.salarioSolidesNoRegistro) ? "pendente" : "divergente";
}

export interface DpPromocaoAplicada {
  salario: number | null;
  cargo: string | null;
  estado: DpEstadoPromocao | null;
  /** Vai na memória do salário quando a folha usa a promoção. */
  origem: string | null;
  /** O que o DP precisa fazer ou conferir. */
  aviso: string | null;
}

/** Cargo e salário que a folha usa no mês, dados o cadastro de hoje e as promoções registradas. */
export function aplicarPromocao(
  pessoa: { salario: number | null; cargo: string | null; avulso: boolean },
  promocoes: DpPromocao[],
  competencia: string,
): DpPromocaoAplicada {
  // A Sólides já traz a PRÓXIMA promoção: neste mês, anterior ao início, vale o salário de antes.
  // "Antes" é o que a folha usava no registro (pode ser uma promoção anterior ainda
  // pendente); só se sabe que a Sólides mudou se ela não está mais no valor do registro.
  const prox = pessoa.avulso ? null : proximaPromocao(promocoes, competencia);
  const antes = prox ? prox.salarioAnterior ?? prox.salarioSolidesNoRegistro : null;
  if (prox && antes !== null && igual(pessoa.salario, prox.salario) && !igual(pessoa.salario, prox.salarioSolidesNoRegistro)) {
    return {
      salario: antes,
      cargo: prox.cargoAnterior ?? pessoa.cargo,
      estado: null,
      origem: `salário anterior à promoção de ${rotuloMes(prox.vigencia)} — a Sólides já traz o novo`,
      aviso: null,
    };
  }
  const p = promocaoVigente(promocoes, competencia);
  if (!p) return { salario: pessoa.salario, cargo: pessoa.cargo, estado: null, origem: null, aviso: null };
  const estado = estadoPromocao(p, { salarioSolides: pessoa.salario, avulso: pessoa.avulso });
  const desde = rotuloMes(p.vigencia);
  if (estado === "pendente" || estado === "fora_da_solides") {
    return {
      salario: p.salario,
      cargo: p.cargo,
      estado,
      origem: `promoção para ${p.cargo} a partir de ${desde}`,
      aviso:
        estado === "pendente"
          ? `Promovido para ${p.cargo} (${brl(p.salario)}) a partir de ${desde}: atualize cargo e salário na Sólides.`
          : null,
    };
  }
  return {
    salario: pessoa.salario,
    cargo: pessoa.cargo,
    estado,
    origem: null,
    aviso:
      estado === "divergente"
        ? `A Sólides foi atualizada para ${brl(pessoa.salario ?? 0)}, diferente da promoção de ${desde} (${brl(p.salario)}): a folha usa a Sólides.`
        : null,
  };
}

/** Confere o que vem da tela antes de gravar. */
export function validarPromocao(x: { vigencia: string; cargo: string; salario: number; motivo: string | null }): {
  vigencia: string;
  cargo: string;
  salario: number;
  motivo: string | null;
} {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(x.vigencia ?? "")) throw new Error("Mês de início inválido.");
  const cargo = (x.cargo ?? "").replace(/\s+/g, " ").trim();
  if (!cargo) throw new Error("Escolha o cargo novo.");
  if (typeof x.salario !== "number" || !Number.isFinite(x.salario) || x.salario <= 0) throw new Error("Informe o salário novo.");
  if (x.salario > 10_000_000) throw new Error("Salário fora do esperado — confira o valor.");
  return { vigencia: x.vigencia, cargo: cargo.slice(0, 200), salario: Math.round(x.salario * 100) / 100, motivo: (x.motivo ?? "").trim().slice(0, 300) || null };
}
