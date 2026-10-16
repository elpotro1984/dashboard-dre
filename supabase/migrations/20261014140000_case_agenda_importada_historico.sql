-- Histórico completo do cartão do Trello (comentários + atividades de todas as
-- pessoas), substituindo a coluna `comentarios`, que trazia só os comentários.
-- `historico_desde` marca o cartão mais antigo que o arquivo exportado: o
-- começo do histórico dele ficou só no Trello (nulo = completo).
ALTER TABLE public.case_agenda_importada
  ADD COLUMN IF NOT EXISTS historico jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS historico_desde date;

-- `comentarios` fica sem leitor depois deste deploy. Não é removida aqui porque
-- o código anterior ainda a lê até o deploy novo entrar; remover junto
-- derrubaria a agenda do Trello nesse intervalo.
