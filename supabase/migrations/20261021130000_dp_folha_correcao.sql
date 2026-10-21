-- ============================================================================
-- Departamento Pessoal — CORREÇÃO do esquema da folha gerencial (21/10/2026).
--
-- A migration 20261019130000 foi aplicada em produção numa versão ANTIGA e
-- reaplicada depois: como ela usa CREATE TABLE IF NOT EXISTS, a 2ª execução
-- criou só as tabelas que faltavam e deixou as existentes como estavam.
-- Conferido contra produção em 21/10/2026 (OpenAPI do PostgREST, tabelas
-- vazias):
--
--   dp_folha_cadastro     sem setor_folha, recorrentes e ferias; FK de
--                         solides_id para dp_colaboradores (recusa o avulso,
--                         que tem id negativo).
--   dp_folha_lancamentos  dias_trabalhados NOT NULL DEFAULT 30, dias_ferias,
--                         inss_ferias e vt_dias_desconto NOT NULL DEFAULT 0 —
--                         o NULL é o modo AUTOMÁTICO do motor, então salvar um
--                         lançamento falharia (e um padrão 30/0 viraria
--                         "informado"); a mesma FK.
--   dp_folha_rescisoes    a mesma FK.
--   dp_folha_layouts      não existe.
--
-- Esta migration leva o banco ao desenho atual da 20261019130000 por ALTER, e
-- funciona com ou sem dados: as FKs saem; as colunas entram com o padrão; os
-- CHECKs são todos recriados (a versão antiga pode ter outra lista de
-- situações). Em banco novo, onde a 20261019130000 já criou tudo certo, ela não
-- muda nada.
-- ============================================================================

-- 1. FKs para dp_colaboradores e CHECKs antigos: saem todos e voltam os atuais.
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT conrelid::regclass AS tbl, conname
    FROM pg_constraint
    WHERE conrelid IN ('public.dp_folha_cadastro'::regclass, 'public.dp_folha_lancamentos'::regclass, 'public.dp_folha_rescisoes'::regclass)
      AND (contype = 'c' OR (contype = 'f' AND confrelid = 'public.dp_colaboradores'::regclass))
  LOOP
    EXECUTE format('ALTER TABLE %s DROP CONSTRAINT %I', r.tbl, r.conname);
  END LOOP;
END $$;

-- 2. dp_folha_cadastro
ALTER TABLE public.dp_folha_cadastro ADD COLUMN IF NOT EXISTS setor_folha TEXT;
ALTER TABLE public.dp_folha_cadastro ADD COLUMN IF NOT EXISTS recorrentes JSONB NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE public.dp_folha_cadastro ADD COLUMN IF NOT EXISTS ferias JSONB NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE public.dp_folha_cadastro
  ADD CONSTRAINT dp_folha_cadastro_solides_id_chk CHECK (solides_id <> 0),
  ADD CONSTRAINT dp_folha_cadastro_plano_chk CHECK (plano_saude IN ('nenhum', 'ambulatorial', 'enfermaria', 'apartamento')),
  ADD CONSTRAINT dp_folha_cadastro_odonto_chk CHECK (odonto_vidas BETWEEN 0 AND 20),
  ADD CONSTRAINT dp_folha_cadastro_sf_chk CHECK (salario_familia_cotas BETWEEN 0 AND 20),
  ADD CONSTRAINT dp_folha_cadastro_dep_ir_chk CHECK (dependentes_ir BETWEEN 0 AND 20),
  ADD CONSTRAINT dp_folha_cadastro_alimentacao_chk CHECK (alimentacao >= 0),
  ADD CONSTRAINT dp_folha_cadastro_transporte_chk CHECK (transporte_tipo IN ('nenhum', 'bilhete', 'gasolina')),
  ADD CONSTRAINT dp_folha_cadastro_transporte_valor_chk CHECK (transporte_valor >= 0),
  ADD CONSTRAINT dp_folha_cadastro_home_office_chk CHECK (home_office >= 0);

-- 3. dp_folha_lancamentos: NULL = automático.
ALTER TABLE public.dp_folha_lancamentos
  ALTER COLUMN dias_trabalhados DROP NOT NULL,
  ALTER COLUMN dias_trabalhados DROP DEFAULT,
  ALTER COLUMN dias_ferias DROP NOT NULL,
  ALTER COLUMN dias_ferias DROP DEFAULT,
  ALTER COLUMN inss_ferias DROP NOT NULL,
  ALTER COLUMN inss_ferias DROP DEFAULT,
  ALTER COLUMN vt_dias_desconto DROP NOT NULL,
  ALTER COLUMN vt_dias_desconto DROP DEFAULT;
ALTER TABLE public.dp_folha_lancamentos
  ADD CONSTRAINT dp_folha_lancamentos_competencia_chk CHECK (competencia ~ '^\d{4}-(0[1-9]|1[0-2])$'),
  ADD CONSTRAINT dp_folha_lancamentos_solides_id_chk CHECK (solides_id <> 0),
  ADD CONSTRAINT dp_folha_lancamentos_situacao_chk CHECK (situacao IN ('normal', 'afastado', 'licenca_maternidade')),
  ADD CONSTRAINT dp_folha_lancamentos_dias_chk CHECK (dias_trabalhados BETWEEN 0 AND 31),
  ADD CONSTRAINT dp_folha_lancamentos_ferias_chk CHECK (dias_ferias BETWEEN 0 AND 31),
  ADD CONSTRAINT dp_folha_lancamentos_inss_ferias_chk CHECK (inss_ferias >= 0),
  ADD CONSTRAINT dp_folha_lancamentos_vt_chk CHECK (vt_dias_desconto BETWEEN 0 AND 31);

-- 4. dp_folha_rescisoes
ALTER TABLE public.dp_folha_rescisoes
  ADD CONSTRAINT dp_folha_rescisoes_competencia_chk CHECK (competencia ~ '^\d{4}-(0[1-9]|1[0-2])$'),
  ADD CONSTRAINT dp_folha_rescisoes_valor_chk CHECK (valor >= 0);

-- 5. dp_folha_layouts (colunas das planilhas de fora, por empresa)
CREATE TABLE IF NOT EXISTS public.dp_folha_layouts (
  company_id  UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  tipo        TEXT NOT NULL CHECK (tipo IN ('contabilidade', 'valores')),
  mapeamento  JSONB NOT NULL,
  updated_by  UUID REFERENCES public.users(id) ON DELETE SET NULL,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (company_id, tipo)
);
ALTER TABLE public.dp_folha_layouts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS dp_folha_layouts_select ON public.dp_folha_layouts;
CREATE POLICY dp_folha_layouts_select ON public.dp_folha_layouts FOR SELECT TO authenticated USING (public.dp_has_access());

-- 6. RLS de todas as tabelas da folha, como na 20261019130000 (não dá para
-- conferir as policies de fora; recriar é idempotente). Leitura direta só para o
-- gestor — nunca is_admin(); escrita só service role.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['dp_folha_parametros', 'dp_folha_cadastro', 'dp_folha_lancamentos', 'dp_folha_fechamentos', 'dp_folha_rescisoes', 'dp_folha_avulsos']
  LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_select', t);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR SELECT TO authenticated USING (public.dp_has_access())', t || '_select', t);
  END LOOP;
END $$;

-- 7. O predicado de RLS do DP, reafirmado. Produção foi criada de um rascunho
-- anterior a qualquer commit, então não dá para garantir que a versão aplicada
-- da 20261019120000 tinha o bloqueio nominal. É a MESMA definição de lá
-- (CREATE OR REPLACE é idempotente); dp-bloqueio.test.ts confere esta, que
-- passa a ser a última.
CREATE OR REPLACE FUNCTION public.dp_has_access()
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.user_module_roles r
    JOIN public.users u ON u.id = r.user_id
    WHERE r.user_id = auth.uid()
      AND r.module = 'dp'
      AND r.role = 'gestor'
      AND u.active IS NOT FALSE
      AND lower(coalesce(u.email, '')) NOT IN ('carol@quokka.net.br')
  );
$$;

REVOKE EXECUTE ON FUNCTION public.dp_has_access() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.dp_has_access() TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
