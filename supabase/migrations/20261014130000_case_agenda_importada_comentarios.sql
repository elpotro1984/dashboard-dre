-- Comentários do cartão do Trello: é neles que o time escrevia os dados do
-- contrato (fundo, horário, valores). A descrição quase sempre só tem o NP.
ALTER TABLE public.case_agenda_importada
  ADD COLUMN IF NOT EXISTS comentarios jsonb NOT NULL DEFAULT '[]'::jsonb;
