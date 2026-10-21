-- Libera o tipo 'projeto' no cache de opções da Omie (ctrl_omie_options), usado
-- para cachear os PROJETOS por CNPJ — a lista do campo "Projeto" da requisição.
-- O cache é atualizado diariamente (lazy, na 1ª leitura após 24h) + botão
-- "Atualizar agora". Ver src/lib/ctrl/omie-projetos.ts.
--
-- O CHECK antigo (kind in categoria/departamento/conta_corrente) recusava
-- 'projeto' com 23514. Recriado incluindo 'projeto'. Aditivo: as linhas e kinds
-- existentes seguem válidos.
alter table public.ctrl_omie_options
  drop constraint if exists ctrl_omie_options_kind_check;

alter table public.ctrl_omie_options
  add constraint ctrl_omie_options_kind_check
  check (kind in ('categoria', 'departamento', 'conta_corrente', 'projeto'));
