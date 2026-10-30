-- Orçamento › Valor fixo: MULTIPLICADOR do salário mínimo (30/10/2026).
--
-- Um contrato pode valer um múltiplo do salário mínimo ("1,5× o mínimo"). Com o
-- índice Salário mínimo (unit 'brl'), o valor reajustado passa a ser o mínimo do
-- ano × multiplicador; nos índices percentuais a coluna não significa nada.
--
-- NULL = 1× (o comportamento de antes). Aditiva: nenhum contrato muda de número
-- até alguém escolher um multiplicador. Teto de 20× como trava de sanidade — o
-- zero a mais digitado multiplicaria o contrato por dez.

ALTER TABLE public.orcamento_valor_fixo_categorias
  ADD COLUMN IF NOT EXISTS multiplicador numeric(6,2) NULL;

ALTER TABLE public.orcamento_valor_fixo_categorias
  DROP CONSTRAINT IF EXISTS orcamento_valor_fixo_multiplicador_chk;
ALTER TABLE public.orcamento_valor_fixo_categorias
  ADD CONSTRAINT orcamento_valor_fixo_multiplicador_chk
  CHECK (multiplicador IS NULL OR (multiplicador > 0 AND multiplicador <= 20));

COMMENT ON COLUMN public.orcamento_valor_fixo_categorias.multiplicador IS
  'Múltiplo do salário mínimo quando o índice é o Salário mínimo (unit brl). NULL = 1×.';

NOTIFY pgrst, 'reload schema';
