-- Orçamento › Média com correção: MESES DE INCIDÊNCIA por linha (29/10/2026).
--
-- Algumas despesas orçadas por média só acontecem em alguns meses do ano. A
-- média e a correção pelo índice continuam calculadas do mesmo jeito; o que
-- muda é ONDE o valor mensal projetado cai: só nos meses marcados, e os demais
-- ficam zerados no orçamento.
--
-- NULL = os 12 meses (comportamento de sempre). Os valores são 1..12.
-- Aditiva: nenhuma linha muda de número até alguém desmarcar um mês.

ALTER TABLE public.orcamento_media_categorias
  ADD COLUMN IF NOT EXISTS meses_incidencia smallint[] NULL;

ALTER TABLE public.orcamento_media_categorias
  DROP CONSTRAINT IF EXISTS orcamento_media_meses_incidencia_chk;
ALTER TABLE public.orcamento_media_categorias
  ADD CONSTRAINT orcamento_media_meses_incidencia_chk
  CHECK (
    meses_incidencia IS NULL
    OR (
      cardinality(meses_incidencia) BETWEEN 1 AND 12
      AND meses_incidencia <@ ARRAY[1,2,3,4,5,6,7,8,9,10,11,12]::smallint[]
    )
  );

COMMENT ON COLUMN public.orcamento_media_categorias.meses_incidencia IS
  'Meses (1..12) em que a média projetada entra no orçamento; os outros ficam zerados. NULL = todos.';

NOTIFY pgrst, 'reload schema';
