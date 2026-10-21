-- ============================================================================
-- Departamento Pessoal — 13º SALÁRIO e CÁLCULO DE RESCISÃO (21/10/2026).
-- Aplicar DEPOIS da 20261021130000 (correção do esquema da folha).
--
--   dp_folha_13              o que o sistema não sabe do 13º de cada pessoa ×
--                            ano: ajustes manuais com motivo (avos, base com
--                            médias, INSS/IRRF da contabilidade) e a 1ª parcela
--                            paga nas férias. O cálculo é do app
--                            (src/lib/dp/folha/decimo-terceiro.ts).
--   dp_folha_13_fechamentos  o RETRATO de cada parcela fechada (empresa × ano ×
--                            parcela). Existe linha = fechada; reabrir apaga.
--                            A 2ª parcela desconta a 1ª DO RETRATO, não um
--                            recálculo: salário que sobe em dezembro não muda o
--                            que foi pago em novembro.
--   dp_folha_rescisoes.calculo  a entrada e o resultado da calculadora de
--                            rescisão (src/lib/dp/folha/rescisao.ts), quando a
--                            linha veio dela. NULL = valor digitado.
--
-- Mesma convenção da folha: a pessoa é um número (positivo = solides_id,
-- negativo = avulso), sem FK; o app confere a empresa em toda escrita.
-- ============================================================================

ALTER TABLE public.dp_folha_rescisoes ADD COLUMN IF NOT EXISTS calculo JSONB;

CREATE TABLE IF NOT EXISTS public.dp_folha_13 (
  ano             INTEGER NOT NULL CHECK (ano BETWEEN 2000 AND 2100),
  solides_id      BIGINT NOT NULL CHECK (solides_id <> 0),
  -- { "avos": { "valor": 11, "motivo": "..." }, "base": {...}, "inss": {...}, "irrf": {...} }
  ajustes         JSONB NOT NULL DEFAULT '{}'::jsonb,
  -- 1ª parcela paga nas férias (a pessoa pediu em janeiro). NULL = não foi.
  primeira_ferias NUMERIC(12, 2) CHECK (primeira_ferias >= 0),
  observacao      TEXT,
  updated_by      UUID REFERENCES public.users(id) ON DELETE SET NULL,
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (ano, solides_id)
);

CREATE TABLE IF NOT EXISTS public.dp_folha_13_fechamentos (
  company_id  UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  ano         INTEGER NOT NULL CHECK (ano BETWEEN 2000 AND 2100),
  parcela     SMALLINT NOT NULL CHECK (parcela IN (1, 2)),
  -- { vigencia, parametros, linhas: [resultado do motor por pessoa] }
  resultado   JSONB NOT NULL,
  fechado_por UUID REFERENCES public.users(id) ON DELETE SET NULL,
  fechado_em  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (company_id, ano, parcela)
);

ALTER TABLE public.dp_folha_13 ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.dp_folha_13_fechamentos ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS dp_folha_13_select ON public.dp_folha_13;
CREATE POLICY dp_folha_13_select ON public.dp_folha_13 FOR SELECT TO authenticated USING (public.dp_has_access());
DROP POLICY IF EXISTS dp_folha_13_fechamentos_select ON public.dp_folha_13_fechamentos;
CREATE POLICY dp_folha_13_fechamentos_select ON public.dp_folha_13_fechamentos FOR SELECT TO authenticated USING (public.dp_has_access());

COMMENT ON TABLE public.dp_folha_13 IS 'DP (sigiloso): ajustes do 13º por pessoa × ano (avos, base, INSS/IRRF) e a 1ª parcela paga nas férias.';
COMMENT ON TABLE public.dp_folha_13_fechamentos IS 'DP (sigiloso): retrato de cada parcela do 13º fechada (empresa × ano × parcela). Existe linha = fechada; reabrir apaga.';
COMMENT ON COLUMN public.dp_folha_rescisoes.calculo IS 'Entrada + resultado da calculadora de rescisão (folha/rescisao.ts); NULL = valor digitado.';

NOTIFY pgrst, 'reload schema';
