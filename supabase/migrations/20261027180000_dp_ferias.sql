-- DP › Pagamento de férias (27/10/2026)
--
-- O CONTROLE DE FÉRIAS: uma linha por período de férias de uma pessoa da folha,
-- com o valor manual quando o DP não usa o calculado. É a FONTE das férias do
-- sistema — a Folha do mês (dias de férias e VT de cada mês), o 13º e o resto
-- leem daqui (listPessoasDaFolha). Até hoje elas moravam em
-- `dp_folha_cadastro.ferias` (jsonb, "férias programadas"), que tinha ZERO
-- períodos em produção no dia desta migration (conferido) — não há o que migrar,
-- e a coluna fica sem leitor (convenção do módulo).
--
-- `solides_id` é a PESSOA DA FOLHA: positivo = Sólides, negativo = avulso — por
-- isso sem FK para dp_colaboradores (recusaria o avulso), como o resto da folha.
-- Sem company_id: as férias acompanham a pessoa; a empresa é a dela.
--
-- Aditiva: tabela nova, nada existente muda.

CREATE TABLE IF NOT EXISTS public.dp_ferias (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  solides_id    BIGINT NOT NULL,
  inicio        DATE NOT NULL,
  fim           DATE NOT NULL,
  -- NULL = o valor calculado (salário ÷ 30 × dias + 1/3); número = informado.
  valor_manual  NUMERIC(12,2) CHECK (valor_manual IS NULL OR valor_manual >= 0),
  observacao    TEXT,
  created_by    UUID REFERENCES public.users(id) ON DELETE SET NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by    UUID REFERENCES public.users(id) ON DELETE SET NULL,
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT dp_ferias_periodo_chk CHECK (fim >= inicio AND fim - inicio <= 29)
);
CREATE INDEX IF NOT EXISTS dp_ferias_pessoa_idx ON public.dp_ferias (solides_id, inicio);
CREATE INDEX IF NOT EXISTS dp_ferias_inicio_idx ON public.dp_ferias (inicio);

-- Leitura pelo predicado do DP (nunca is_admin()); escrita só pelo admin client
-- depois do guard — sem policy de escrita.
ALTER TABLE public.dp_ferias ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS dp_ferias_select ON public.dp_ferias;
CREATE POLICY dp_ferias_select ON public.dp_ferias
  FOR SELECT TO authenticated USING (public.dp_has_access());

COMMENT ON TABLE public.dp_ferias IS 'DP: controle de férias (um período por linha) — a fonte das férias da folha. Ver src/lib/dp/ferias.ts.';
