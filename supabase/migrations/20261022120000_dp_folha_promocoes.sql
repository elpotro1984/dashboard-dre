-- ============================================================================
-- Departamento Pessoal — PROMOÇÃO registrada na própria folha (22/10/2026).
--
--   dp_folha_promocoes  o DP escolhe na folha o cargo novo (uma linha da tabela
--                       salarial da empresa, com o salário sugerido) e o mês de
--                       início. A folha usa o cargo e o salário novos a partir
--                       daquele mês e mostra "pendente na Sólides" até a
--                       sincronização trazer a mudança — a Sólides continua
--                       sendo a fonte do cadastro; isto é a ponte até ela.
--
-- Quem decide se a promoção ainda vale é o SALÁRIO da Sólides gravado no
-- registro (`salario_solides_no_registro`): igual ao de hoje = pendente (vale a
-- promoção); igual ao da promoção = já refletida (vale a Sólides); outro valor =
-- divergente (vale a Sólides, com aviso). A regra é do app
-- (src/lib/dp/folha/promocao.ts).
--
-- Mesma convenção da folha: a pessoa é um número (positivo = solides_id,
-- negativo = avulso), sem FK; o app confere a empresa em toda escrita. O cargo e
-- o salário são COPIADOS da linha (retrato): editar a tabela depois não muda a
-- promoção registrada; apagar a linha não apaga a promoção.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.dp_folha_promocoes (
  id                           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id                   UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  solides_id                   BIGINT NOT NULL CHECK (solides_id <> 0),
  vigencia                     TEXT NOT NULL CHECK (vigencia ~ '^\d{4}-(0[1-9]|1[0-2])$'),
  linha_id                     UUID REFERENCES public.dp_tabela_salarial(id) ON DELETE SET NULL,
  setor                        TEXT NOT NULL DEFAULT '',
  cargo                        TEXT NOT NULL CHECK (btrim(cargo) <> ''),
  salario                      NUMERIC(12, 2) NOT NULL CHECK (salario > 0),
  cargo_anterior               TEXT,
  salario_anterior             NUMERIC(12, 2),
  -- NULL = pessoa fora da Sólides (avulso): a promoção vale sempre.
  salario_solides_no_registro  NUMERIC(12, 2),
  motivo                       TEXT,
  created_by                   UUID REFERENCES public.users(id) ON DELETE SET NULL,
  created_at                   TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (solides_id, vigencia)
);

CREATE INDEX IF NOT EXISTS dp_folha_promocoes_company_idx ON public.dp_folha_promocoes (company_id, solides_id);

ALTER TABLE public.dp_folha_promocoes ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS dp_folha_promocoes_select ON public.dp_folha_promocoes;
CREATE POLICY dp_folha_promocoes_select ON public.dp_folha_promocoes FOR SELECT TO authenticated USING (public.dp_has_access());

COMMENT ON TABLE public.dp_folha_promocoes IS 'DP (sigiloso): promoção registrada na folha (cargo + salário a partir de um mês), ponte até a Sólides ser atualizada.';

NOTIFY pgrst, 'reload schema';
