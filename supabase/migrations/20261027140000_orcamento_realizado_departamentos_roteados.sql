-- =============================================================================
-- Orçamento — o realizado também RECEBE os departamentos roteados de outra
-- empresa (corrige 20261027130000).
--
-- 20261027130000 aplicou só o lado da ORIGEM do filtro de departamentos e
-- deixou de fora o que outra empresa roteia para cá. Na Hero Holding é
-- justamente o que conta: ela sincroniza a mesma Omie da Viva Go mas não
-- inclui nenhum departamento próprio — o realizado dela é o departamento HERO
-- da VIVA GO, roteado via "Enviar para". Resultado: base 2026 vazia.
--
-- Agora é a mesma regra da DRE (20260605120000_dre_monthly_aggregates):
--   * a empresa EFETIVA do lançamento é COALESCE(route.routed_to_company_id,
--     fe.company_id) — conta para p_company_id quando ela é a efetiva;
--   * o filtro de `included` é o da empresa de ORIGEM (departamento roteado é
--     forçado a included pela tela de Departamentos).
-- O lançamento roteado é casado pelo category_code da origem, como na DRE sem
-- routed_category_mapping (Omie compartilhada = mesmo plano de categorias).
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
  LEFT JOIN public.company_departments route
    ON route.company_id = fe.company_id
    AND route.omie_code = COALESCE(fe.department_code, '__none__')
    AND route.routed_to_company_id IS NOT NULL
  WHERE (
      fe.company_id = p_company_id
      OR fe.company_id IN (
        SELECT cd.company_id FROM public.company_departments cd
        WHERE cd.routed_to_company_id = p_company_id
      )
    )
    AND COALESCE(route.routed_to_company_id, fe.company_id) = p_company_id
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
  LEFT JOIN public.company_departments route
    ON route.company_id = fe.company_id
    AND route.omie_code = COALESCE(fe.department_code, '__none__')
    AND route.routed_to_company_id IS NOT NULL
  WHERE (
      fe.company_id = p_company_id
      OR fe.company_id IN (
        SELECT cd.company_id FROM public.company_departments cd
        WHERE cd.routed_to_company_id = p_company_id
      )
    )
    AND COALESCE(route.routed_to_company_id, fe.company_id) = p_company_id
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
  GROUP BY 1
  HAVING abs(sum(fe.value)) > 0
  ORDER BY 2 DESC;
$$;

NOTIFY pgrst, 'reload schema';
