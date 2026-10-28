-- DP › ficha do colaborador › card "Benefícios" (28/10/2026)
--
-- O que cada pessoa recebe, ESCOLHIDO no cadastro de benefícios da empresa
-- (dp_beneficios_config): a faixa do vale-alimentação, o bilhete do VT, a faixa
-- de km da gasolina e da carona, os dias presenciais do home office, a
-- modalidade do SESI, a assiduidade, os filhos do salário-família que não
-- estão na Sólides e os "outros benefícios" (rótulo, valor e para onde vão).
--
-- Grava a ESCOLHA, nunca o valor: o valor é lido do cadastro da empresa na hora
-- (um reajuste do bloco chega a todo mundo). jsonb validado pelo app
-- (src/lib/dp/beneficios-colaborador.ts, puro e testado). `company_id` é a
-- empresa em que as escolhas foram feitas — a ficha avisa quando a pessoa
-- mudou de empresa e as escolhas apontam para o cadastro da anterior.
--
-- Fora do espelho de propósito (como dp_colaborador_ajustes): dp_colaboradores
-- é reescrito pela sincronização todo dia.
--
-- Por enquanto é só cadastro: a folha segue com dp_folha_cadastro.
--
-- Aditiva: tabela nova, nada existente muda.

CREATE TABLE IF NOT EXISTS public.dp_colaborador_beneficios (
  solides_id  BIGINT PRIMARY KEY REFERENCES public.dp_colaboradores(solides_id) ON DELETE CASCADE,
  company_id  UUID REFERENCES public.companies(id) ON DELETE SET NULL,
  dados       JSONB NOT NULL,
  updated_by  UUID REFERENCES public.users(id) ON DELETE SET NULL,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Leitura pelo predicado do DP (nunca is_admin()); escrita só pelo admin client
-- depois do guard — sem policy de escrita.
ALTER TABLE public.dp_colaborador_beneficios ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS dp_colaborador_beneficios_select ON public.dp_colaborador_beneficios;
CREATE POLICY dp_colaborador_beneficios_select ON public.dp_colaborador_beneficios
  FOR SELECT TO authenticated USING (public.dp_has_access());

COMMENT ON TABLE public.dp_colaborador_beneficios IS 'DP (sigiloso): benefícios escolhidos por pessoa no cadastro da empresa — ver src/lib/dp/beneficios-colaborador.ts.';
