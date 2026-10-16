-- Eventos importados de fora do sistema (hoje: o quadro do Trello que
-- controlava a agenda antes do módulo Case). Tabela PRÓPRIA, não linhas em
-- case_contracts: um evento importado não tem cliente, valor nem título, e em
-- case_contracts ele apareceria na lista de contratos, no dashboard e no
-- fechamento como contrato de R$ 0, consumiria a numeração de NP e ficaria ao
-- alcance das actions de Omie e ClickSign. Aqui só a agenda o lê.

CREATE TABLE IF NOT EXISTS public.case_agenda_importada (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  origem text NOT NULL DEFAULT 'trello' CHECK (origem IN ('trello')),
  -- id do cartão: reimportar o mesmo quadro atualiza em vez de duplicar.
  origem_id text NOT NULL,
  origem_url text,
  titulo_original text NOT NULL,
  categoria text,
  turma text,
  local_name text,
  local_city text,
  unidade text,
  intermediacao boolean NOT NULL DEFAULT false,
  event_date date NOT NULL,
  event_date_fim date,
  atracoes text[] NOT NULL DEFAULT '{}',
  -- Números de contrato do controle antigo, lidos da descrição do cartão.
  nps integer[] NOT NULL DEFAULT '{}',
  observacao text,
  anexos jsonb NOT NULL DEFAULT '[]'::jsonb,
  importado_em timestamptz NOT NULL DEFAULT now(),
  UNIQUE (origem, origem_id)
);

CREATE INDEX IF NOT EXISTS case_agenda_importada_event_date_idx
  ON public.case_agenda_importada (event_date);

ALTER TABLE public.case_agenda_importada ENABLE ROW LEVEL SECURITY;

-- Só leitura pelo usuário do módulo; a gravação é do script de importação
-- (service role).
CREATE POLICY case_agenda_importada_select ON public.case_agenda_importada
  FOR SELECT TO authenticated
  USING (public.has_case_access());
