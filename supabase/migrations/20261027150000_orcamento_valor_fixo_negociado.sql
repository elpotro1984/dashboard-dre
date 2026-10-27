-- Orçamento › Valor fixo com correção: VALOR NEGOCIADO por contrato (27/10/2026).
--
-- O índice é a regra (aluguel 1.500 × IGP-M 4,08% = 1.561,20), mas o contrato
-- pode fechar num valor diferente em negociação (1.550). Este valor substitui o
-- corrigido do mês do reajuste em diante (sem mês, o ano todo).
--
-- NULL = segue o índice (comportamento de sempre). 0 é valor legítimo.
-- Aditiva: nenhuma linha muda de número até alguém digitar um negociado.

ALTER TABLE public.orcamento_valor_fixo_categorias
  ADD COLUMN IF NOT EXISTS valor_negociado numeric NULL;

ALTER TABLE public.orcamento_valor_fixo_categorias
  DROP CONSTRAINT IF EXISTS orcamento_valor_fixo_negociado_chk;
ALTER TABLE public.orcamento_valor_fixo_categorias
  ADD CONSTRAINT orcamento_valor_fixo_negociado_chk
  CHECK (valor_negociado IS NULL OR valor_negociado >= 0);

COMMENT ON COLUMN public.orcamento_valor_fixo_categorias.valor_negociado IS
  'Valor mensal fechado em negociação; substitui o corrigido pelo índice. NULL = vale o índice.';

NOTIFY pgrst, 'reload schema';
