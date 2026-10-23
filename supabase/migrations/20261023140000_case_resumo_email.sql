-- Resumo do contrato por e-mail (botão "Enviar e-mail" da tela do contrato).
-- As colunas guardam o ÚLTIMO envio — é o que acende o ✓ do botão. Cada envio
-- fica também em case_history, que é onde está a lista completa.
ALTER TABLE public.case_contracts
  ADD COLUMN IF NOT EXISTS resumo_enviado_em  timestamptz,
  ADD COLUMN IF NOT EXISTS resumo_enviado_por uuid REFERENCES public.users(id);

ALTER TYPE public.case_history_action ADD VALUE IF NOT EXISTS 'resumo_enviado';
