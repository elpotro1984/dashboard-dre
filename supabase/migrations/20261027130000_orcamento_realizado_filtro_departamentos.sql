-- =============================================================================
-- Orçamento — o realizado respeita a configuração de DEPARTAMENTOS do Financeiro.
--
-- Financeiro > Configurações > Departamentos diz, por empresa, quais
-- departamentos da Omie entram nela (company_departments.included, com a
-- sentinela '__none__' = "Sem departamento vinculado") e quais são ROTEADOS
-- para outra empresa (routed_to_company_id — somem da origem). A DRE e o Fluxo
-- aplicam isso em todas as RPCs (ver 20260605120000_dre_monthly_aggregates).
--
-- As duas RPCs do orçamento liam financial_entries cru: na Hero Holding, que
-- divide a Omie com a Viva Go e só recebe o departamento HERO, o Planejamento
-- dos sócios mostrava o realizado de TODOS os departamentos da Omie.
--
-- Mesmo filtro da DRE, do lado da empresa de origem:
--   1. has_department_apportionment ligado → só departamento `included`;
--   2. departamento roteado para OUTRA empresa → fora.
-- Empresa sem rateio por departamento não muda nada.
--
-- Assinaturas iguais → CREATE OR REPLACE (mantém os GRANTs do service_role).
-- =============================================================================

CREATE OR REPLACE FUNCTION public.orcamento_media_realizado(
  p_company_id uuid,
  p_base_year integer,
  p_category_codes text[]
)
RETURNS TABLE (category_code text, month integer, total numeric)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    fe.category_code,
    EXTRACT(MONTH FROM fe.payment_date)::int AS month,
    sum(fe.value)::numeric AS total
  FROM public.financial_entries fe
  JOIN public.companies co ON co.id = fe.company_id
  WHERE fe.company_id = p_company_id
    AND fe.type = 'despesa'
    AND fe.category_code = ANY (p_category_codes)
    AND EXTRACT(YEAR FROM fe.payment_date) = p_base_year
    AND (
      co.has_department_apportionment IS NOT TRUE
      OR EXISTS (
        SELECT 1
        FROM public.company_departments cd
        WHERE cd.company_id = fe.company_id
          AND cd.included = true
          AND cd.omie_code = COALESCE(fe.department_code, '__none__')
      )
    )
    AND NOT EXISTS (
      SELECT 1
      FROM public.company_departments route
      WHERE route.company_id = fe.company_id
        AND route.omie_code = COALESCE(fe.department_code, '__none__')
        AND route.routed_to_company_id IS NOT NULL
        AND route.routed_to_company_id <> fe.company_id
    )
  GROUP BY fe.category_code, EXTRACT(MONTH FROM fe.payment_date);
$$;

CREATE OR REPLACE FUNCTION public.orcamento_planejamento_realizado_itens(
  p_company_id uuid,
  p_base_year integer,
  p_category_code text,
  p_meses_fechados integer
)
RETURNS TABLE (
  fornecedor text,
  total numeric,
  total_fechado numeric,
  lancamentos bigint,
  departamento text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    COALESCE(NULLIF(btrim(fe.supplier_customer), ''), 'Sem fornecedor') AS fornecedor,
    round(abs(sum(fe.value))::numeric, 2) AS total,
    round(coalesce(abs(sum(fe.value) FILTER (
      WHERE extract(month FROM fe.payment_date) <= p_meses_fechados
    )), 0)::numeric, 2) AS total_fechado,
    count(*)::bigint AS lancamentos,
    -- Um único departamento distinto entre os lançamentos: o fornecedor é dele.
    -- Zero (sem departamento) ou vários: NULL = ambíguo, vai para "Não atribuído".
    CASE
      WHEN count(DISTINCT COALESCE(NULLIF(btrim(fe.department_code), ''), '__sem__')) = 1
        THEN NULLIF(max(COALESCE(NULLIF(btrim(fe.department_code), ''), '__sem__')), '__sem__')
      ELSE NULL
    END AS departamento
  FROM public.financial_entries fe
  JOIN public.companies co ON co.id = fe.company_id
  WHERE fe.company_id = p_company_id
    AND fe.category_code = p_category_code
    AND fe.type = 'despesa'
    AND fe.payment_date >= make_date(p_base_year, 1, 1)
    AND fe.payment_date <  make_date(p_base_year + 1, 1, 1)
    AND (
      co.has_department_apportionment IS NOT TRUE
      OR EXISTS (
        SELECT 1
        FROM public.company_departments cd
        WHERE cd.company_id = fe.company_id
          AND cd.included = true
          AND cd.omie_code = COALESCE(fe.department_code, '__none__')
      )
    )
    AND NOT EXISTS (
      SELECT 1
      FROM public.company_departments route
      WHERE route.company_id = fe.company_id
        AND route.omie_code = COALESCE(fe.department_code, '__none__')
        AND route.routed_to_company_id IS NOT NULL
        AND route.routed_to_company_id <> fe.company_id
    )
  GROUP BY 1
  HAVING abs(sum(fe.value)) > 0
  ORDER BY 2 DESC;
$$;

NOTIFY pgrst, 'reload schema';
