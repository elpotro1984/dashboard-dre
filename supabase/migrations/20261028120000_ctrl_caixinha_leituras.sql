-- Caixinhas da Puxada (Vendas e Pós-Vendas) — 28/10/2026.
--
-- Cada valor DIFERENTE lido da planilha das caixinhas vira uma linha. É assim
-- que o Control Hub percebe o fechamento mensal (a planilha mudou num ciclo
-- novo → o corte vai para o dia 10 desse ciclo) e sabe desde quando descontar
-- as requisições que ainda não estão na planilha. Regras em
-- src/lib/ctrl/caixinha.ts.
--
-- `corte`: a partir deste dia (inclusive) as requisições com vencimento são
-- descontadas do valor da planilha. Ajustar o corte à mão (UPDATE na última
-- linha da caixinha) é o jeito de corrigir um fechamento; a próxima correção
-- no mesmo ciclo preserva o corte ajustado.
--
-- Sem CHECK em `caixinha`: a chave vem só da configuração no código
-- (CAIXINHAS) e uma lista fechada aqui teria de andar junto a cada caixinha
-- nova — o tipo de CHECK que já quebrou cinco vezes no Orçamento.
--
-- RLS ligada e SEM policy: leitura e escrita só pelo service role, depois do
-- guard do Compras na action (getSaldoCaixinha).

CREATE TABLE IF NOT EXISTS public.ctrl_caixinha_leituras (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  caixinha text NOT NULL,
  valor numeric(14, 2) NOT NULL,
  corte date NOT NULL,
  lido_em timestamptz NOT NULL DEFAULT now(),
  lido_por uuid REFERENCES public.users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS ctrl_caixinha_leituras_caixinha_lido_em_idx
  ON public.ctrl_caixinha_leituras (caixinha, lido_em DESC);

ALTER TABLE public.ctrl_caixinha_leituras ENABLE ROW LEVEL SECURITY;
