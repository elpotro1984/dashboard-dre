-- Orçamento: chave "Aprovação do diretor" por empresa × ano (27/10/2026).
--
-- Algumas empresas não têm a figura do diretor: o próprio gestor que monta o
-- orçamento é quem aprova. Desligada, os papéis de construtor passam a decidir
-- (✓/✗/💬) — só nos setores em que escrevem. Ver `podeDecidir`.
--
-- DEFAULT true: toda empresa continua exatamente como estava até alguém
-- desligar a chave. Aditiva, sem migração de dado.

ALTER TABLE public.orcamento_company_config
  ADD COLUMN IF NOT EXISTS aprovacao_diretor boolean NOT NULL DEFAULT true;

COMMENT ON COLUMN public.orcamento_company_config.aprovacao_diretor IS
  'false = empresa sem diretor: o gestor que monta o orçamento aprova os próprios itens.';

NOTIFY pgrst, 'reload schema';
