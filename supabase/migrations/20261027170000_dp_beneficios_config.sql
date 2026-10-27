-- DP › Configurações › Benefícios (27/10/2026)
--
-- O cadastro de benefícios de CADA EMPRESA, em oito blocos com a mesma estrutura
-- em todas: vale-alimentação, vale-transporte, auxílio gasolina, auxílio carona,
-- auxílio home office, Clube SESI, salário-família e assiduidade. Os valores de
-- cada bloco ficam em jsonb, validados pelo app (src/lib/dp/beneficios-config.ts,
-- puro e testado) — uma linha por empresa × bloco, para salvar e reajustar um
-- bloco sem tocar nos outros.
--
-- Por enquanto é SÓ cadastro: a folha segue calculando pelos Parâmetros da folha.
--
-- O CHECK de `bloco` repete o vocabulário de BLOCOS_BENEFICIO — o teste
-- beneficios-config.test.ts compara os dois; bloco novo exige migration.
--
-- Aditiva: tabelas novas, nada existente muda.

CREATE TABLE IF NOT EXISTS public.dp_beneficios_config (
  company_id  UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  bloco       TEXT NOT NULL CONSTRAINT dp_beneficios_config_bloco_chk CHECK (bloco IN ('alimentacao', 'transporte', 'gasolina', 'carona', 'home_office', 'sesi', 'salario_familia', 'assiduidade')),
  dados       JSONB NOT NULL,
  updated_by  UUID REFERENCES public.users(id) ON DELETE SET NULL,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (company_id, bloco)
);

-- Histórico dos reajustes: é o que diz de onde veio o número de hoje (não há
-- desfazer automático, como na tabela salarial).
CREATE TABLE IF NOT EXISTS public.dp_beneficios_reajustes (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id  UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  bloco       TEXT NOT NULL CONSTRAINT dp_beneficios_reajustes_bloco_chk CHECK (bloco IN ('alimentacao', 'transporte', 'gasolina', 'carona', 'home_office', 'sesi', 'salario_familia', 'assiduidade')),
  percentual  NUMERIC(6,2) NOT NULL CHECK (percentual > 0 AND percentual <= 100),
  antes       JSONB NOT NULL,
  depois      JSONB NOT NULL,
  aplicado_por UUID REFERENCES public.users(id) ON DELETE SET NULL,
  aplicado_em TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS dp_beneficios_reajustes_bloco_idx
  ON public.dp_beneficios_reajustes (company_id, bloco, aplicado_em DESC);

-- O reajuste CONFIRMADO numa transação: só grava se o bloco ainda for o da
-- prévia (`p_antes`); senão alguém mudou o bloco entre a prévia e o clique, e o
-- número aplicado não seria o que foi confirmado. O valor novo é calculado pelo
-- app (mesmo arredondamento da prévia); aqui só se grava, com o histórico.
CREATE OR REPLACE FUNCTION public.dp_beneficio_reajustar(
  p_company_id UUID,
  p_bloco TEXT,
  p_percentual NUMERIC,
  p_antes JSONB,
  p_depois JSONB,
  p_user_id UUID
)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_percentual IS NULL OR p_percentual <= 0 OR p_percentual > 100 THEN
    RAISE EXCEPTION 'O reajuste precisa ser maior que zero e de até 100%%.' USING ERRCODE = '22023';
  END IF;
  UPDATE public.dp_beneficios_config
     SET dados = p_depois, updated_by = p_user_id, updated_at = now()
   WHERE company_id = p_company_id AND bloco = p_bloco AND dados = p_antes;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'dp_beneficio_mudou' USING ERRCODE = 'P0001';
  END IF;
  INSERT INTO public.dp_beneficios_reajustes (company_id, bloco, percentual, antes, depois, aplicado_por)
  VALUES (p_company_id, p_bloco, p_percentual, p_antes, p_depois, p_user_id);
END;
$$;

-- SECURITY DEFINER que grava dados: só service_role (regra da auditoria de 03/09/2026).
REVOKE EXECUTE ON FUNCTION public.dp_beneficio_reajustar(UUID, TEXT, NUMERIC, JSONB, JSONB, UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.dp_beneficio_reajustar(UUID, TEXT, NUMERIC, JSONB, JSONB, UUID) TO service_role;

-- Leitura pelo predicado do DP (nunca is_admin()); escrita só pelo admin client
-- depois do guard — sem policy de escrita.
ALTER TABLE public.dp_beneficios_config    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.dp_beneficios_reajustes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS dp_beneficios_config_select ON public.dp_beneficios_config;
CREATE POLICY dp_beneficios_config_select ON public.dp_beneficios_config
  FOR SELECT TO authenticated USING (public.dp_has_access());

DROP POLICY IF EXISTS dp_beneficios_reajustes_select ON public.dp_beneficios_reajustes;
CREATE POLICY dp_beneficios_reajustes_select ON public.dp_beneficios_reajustes
  FOR SELECT TO authenticated USING (public.dp_has_access());

COMMENT ON TABLE public.dp_beneficios_config IS 'DP: benefícios da empresa (8 blocos), um jsonb por empresa × bloco — ver src/lib/dp/beneficios-config.ts.';
COMMENT ON TABLE public.dp_beneficios_reajustes IS 'DP: histórico dos reajustes % aplicados a cada bloco de benefícios.';
