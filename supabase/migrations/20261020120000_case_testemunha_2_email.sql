-- A 2ª testemunha passa a assinar pela ClickSign, como a 1ª: precisa de e-mail.
-- Nula = ela sai só impressa no PDF (comportamento de antes).
ALTER TABLE public.case_contracts
  ADD COLUMN IF NOT EXISTS testemunha_2_email text;
