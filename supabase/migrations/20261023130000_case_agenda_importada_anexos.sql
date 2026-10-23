-- Contratos anexados no sistema a um evento importado do Trello. Tabela própria,
-- não a coluna `anexos` do evento: aquela é o retrato dos anexos do cartão e o
-- script de importação a reescreve a cada reimportação — um contrato subido aqui
-- sumiria no próximo `DRY=0`. Uma linha por arquivo também evita que duas pessoas
-- anexando ao mesmo tempo percam uma à outra (append em jsonb não é atômico).
-- O arquivo fica no bucket `case-attachments`, na pasta `<uid>/` de quem subiu
-- (regra de upload do bucket); a leitura é por URL assinada gerada no servidor.

CREATE TABLE IF NOT EXISTS public.case_agenda_importada_anexos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  importado_id uuid NOT NULL REFERENCES public.case_agenda_importada(id) ON DELETE CASCADE,
  nome text NOT NULL,
  path text NOT NULL UNIQUE,
  tamanho bigint,
  enviado_por uuid REFERENCES public.users(id) ON DELETE SET NULL,
  enviado_em timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS case_agenda_importada_anexos_importado_idx
  ON public.case_agenda_importada_anexos (importado_id);

ALTER TABLE public.case_agenda_importada_anexos ENABLE ROW LEVEL SECURITY;

-- Leitura por quem tem o módulo; gravação pelas actions (service role), que
-- conferem a sessão e a pasta do arquivo antes de gravar.
CREATE POLICY case_agenda_importada_anexos_select ON public.case_agenda_importada_anexos
  FOR SELECT TO authenticated
  USING (public.has_case_access());
