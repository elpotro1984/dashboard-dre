-- ============================================================================
-- Departamento Pessoal — a tabela salarial abre o cargo em
-- CARGO | SENIORIDADE | STEP.
--
-- Pedido do dono do projeto (26/10/2026): "Analista de Relacionamento JÚNIOR I"
-- vira Cargo "Analista de Relacionamento", Senioridade "Júnior", Step "I".
-- Step é sempre algarismo romano; senioridade é Júnior, Pleno ou Sênior, ou
-- vazia. Desfaz a 20261002140000, que tinha levado o step para dentro do nome.
--
-- Esta migration só cria as colunas e troca a chave — NÃO mexe em nenhuma
-- linha. O preenchimento das linhas que já existem é do script
-- scripts/dp-tabela-separar-cargo.ts, que usa a MESMA regra do app
-- (separarCargo, em src/lib/dp/cargos.ts). Reescrever a regra em SQL seria
-- manter duas leituras do mesmo nome, e elas divergiriam justamente nos casos
-- difíceis (acento, caixa, senioridade no meio do nome).
--
-- Compatível com o código anterior: ele grava senioridade e step vazios, e a
-- chave nova continua única com as linhas como estão hoje.
-- ============================================================================

ALTER TABLE public.dp_tabela_salarial
  ADD COLUMN IF NOT EXISTS senioridade TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS step TEXT NOT NULL DEFAULT '';

-- Os vocabulários são os de SENIORIDADES e STEPS (src/lib/dp/cargos.ts);
-- cargos.test.ts lê esta migration e exige a mesma lista.
ALTER TABLE public.dp_tabela_salarial DROP CONSTRAINT IF EXISTS dp_tabela_salarial_senioridade_chk;
ALTER TABLE public.dp_tabela_salarial
  ADD CONSTRAINT dp_tabela_salarial_senioridade_chk CHECK (senioridade IN ('', 'Júnior', 'Pleno', 'Sênior'));

ALTER TABLE public.dp_tabela_salarial DROP CONSTRAINT IF EXISTS dp_tabela_salarial_step_chk;
ALTER TABLE public.dp_tabela_salarial
  ADD CONSTRAINT dp_tabela_salarial_step_chk CHECK (step IN (
    '', 'I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X',
    'XI', 'XII', 'XIII', 'XIV', 'XV', 'XVI', 'XVII', 'XVIII', 'XIX', 'XX'
  ));

-- A chave ganha as duas colunas: "Analista" Júnior I e "Analista" Júnior II
-- são linhas diferentes da mesma tabela. Colunas comuns, não índice por
-- expressão (a pegadinha de orcamento_grupo_escopo).
ALTER TABLE public.dp_tabela_salarial DROP CONSTRAINT IF EXISTS dp_tabela_salarial_company_setor_cargo_key;
ALTER TABLE public.dp_tabela_salarial
  ADD CONSTRAINT dp_tabela_salarial_company_setor_cargo_key UNIQUE (company_id, setor_chave, cargo_chave, senioridade, step);

-- "Ordenar A–Z": setor, cargo, senioridade na ordem da carreira (sem, Júnior,
-- Pleno, Sênior) e o step pelo VALOR do romano — a ordem alfabética poria o IX
-- antes do V.
CREATE OR REPLACE FUNCTION public.dp_ordenar_tabela(p_company_id UUID)
RETURNS VOID
LANGUAGE sql SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE public.dp_tabela_salarial t
     SET ordem = o.n
    FROM (
      SELECT id, row_number() OVER (
        ORDER BY setor_chave,
                 cargo_chave,
                 array_position(ARRAY['', 'Júnior', 'Pleno', 'Sênior'], senioridade),
                 array_position(ARRAY['', 'I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X',
                                      'XI', 'XII', 'XIII', 'XIV', 'XV', 'XVI', 'XVII', 'XVIII', 'XIX', 'XX'], step),
                 id
      ) AS n
      FROM public.dp_tabela_salarial
      WHERE company_id = p_company_id
    ) o
   WHERE t.id = o.id;
$$;

REVOKE EXECUTE ON FUNCTION public.dp_ordenar_tabela(UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.dp_ordenar_tabela(UUID) TO service_role;

COMMENT ON TABLE public.dp_tabela_salarial IS 'DP (sigiloso): tabela salarial de cada empresa — Setor | Cargo | Senioridade | Step | Salário.';
COMMENT ON COLUMN public.dp_tabela_salarial.cargo IS 'Cargo SEM senioridade e step (o nome completo é cargo + senioridade + step).';
