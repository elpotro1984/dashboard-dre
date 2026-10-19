-- ============================================================================
-- Departamento Pessoal — FOLHA GERENCIAL (19/10/2026).
--
-- Traz para o Control Hub a planilha de folha que o DP monta todo mês
-- ("Setembro.xlsx": abas CONTROLE, SALÁRIO, ALIM_TRASP, RESCISÕES, TOTAIS e
-- TABELAS). É folha de CONFERÊNCIA: a oficial (eSocial, guias) continua na
-- contabilidade. O cálculo é do app (src/lib/dp/folha/motor.ts, puro e
-- testado, validado contra a planilha de setembro); o banco guarda só o que
-- a Sólides não tem:
--
--   dp_folha_parametros  a aba TABELAS, com VIGÊNCIA (competência AAAA-MM).
--   dp_folha_cadastro    o fixo de cada pessoa que só a planilha sabia
--                        (plano, odonto, alimentação, transporte, escala…).
--   dp_folha_lancamentos o variável do mês (dias, férias, copart., descontos,
--                        ajustes manuais com motivo).
--   dp_folha_fechamentos o RETRATO da folha fechada de uma empresa × mês.
--                        Existe linha = está fechada; reabrir apaga a linha
--                        (mesmo desenho das finalizações do Orçamento: não há
--                        estado para prender ninguém).
--   dp_folha_rescisoes   a aba RESCISÕES (entra em "Indenizações" nos totais).
--   dp_folha_avulsos     quem está na folha e NÃO existe na Sólides (PJ que
--                        nunca vai estar lá, cadastro atrasado). Decisão de
--                        19/10/2026: 11 das 124 linhas de set/2026 eram assim.
--
-- A PESSOA da folha é um número: POSITIVO = solides_id do espelho; NEGATIVO =
-- avulso (dp_folha_avulsos.pessoa_id, de uma sequência negada). Por isso as
-- colunas `solides_id` de cadastro, lançamentos e rescisões NÃO têm FK para
-- dp_colaboradores: a FK recusaria o avulso. O app confere a empresa de cada
-- pessoa em toda escrita (actions-folha.ts), e o espelho nunca apaga linha.
--
-- Tudo aditivo. RLS: leitura direta só para o gestor (dp_has_access()); as
-- telas leem e gravam pelo admin client DEPOIS do guard do app, que recorta
-- por empresa — a analista nunca lê estas tabelas direto.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.dp_folha_parametros (
  vigencia   TEXT PRIMARY KEY CHECK (vigencia ~ '^\d{4}-(0[1-9]|1[0-2])$'),
  dados      JSONB NOT NULL,
  updated_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.dp_folha_cadastro (
  solides_id            BIGINT PRIMARY KEY CHECK (solides_id <> 0),
  plano_saude           TEXT NOT NULL DEFAULT 'nenhum'
                        CHECK (plano_saude IN ('nenhum', 'ambulatorial', 'enfermaria', 'apartamento')),
  -- Dependentes NO PLANO: [{ "nome": "...", "nascimento": "AAAA-MM-DD" }]
  plano_dependentes     JSONB NOT NULL DEFAULT '[]'::jsonb,
  odonto_vidas          INTEGER NOT NULL DEFAULT 0 CHECK (odonto_vidas BETWEEN 0 AND 20),
  salario_familia_cotas INTEGER NOT NULL DEFAULT 0 CHECK (salario_familia_cotas BETWEEN 0 AND 20),
  dependentes_ir        INTEGER NOT NULL DEFAULT 0 CHECK (dependentes_ir BETWEEN 0 AND 20),
  adiantamento          BOOLEAN NOT NULL DEFAULT false,
  alimentacao           NUMERIC(12, 2) NOT NULL DEFAULT 0 CHECK (alimentacao >= 0),
  transporte_tipo       TEXT NOT NULL DEFAULT 'nenhum' CHECK (transporte_tipo IN ('nenhum', 'bilhete', 'gasolina')),
  transporte_opcao      TEXT,
  transporte_valor      NUMERIC(12, 2) NOT NULL DEFAULT 0 CHECK (transporte_valor >= 0),
  escala                TEXT NOT NULL DEFAULT '5 dias',
  home_office           NUMERIC(12, 2) NOT NULL DEFAULT 0 CHECK (home_office >= 0),
  sem_inss              BOOLEAN NOT NULL DEFAULT false,
  -- Setor da FOLHA (a classificação do DP, que difere do departamento da
  -- Sólides em 37 de 112 pessoas na planilha de set/2026). NULL = o da Sólides.
  setor_folha           TEXT,
  conta                 TEXT,
  observacao            TEXT,
  updated_by            UUID REFERENCES public.users(id) ON DELETE SET NULL,
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.dp_folha_lancamentos (
  competencia        TEXT NOT NULL CHECK (competencia ~ '^\d{4}-(0[1-9]|1[0-2])$'),
  solides_id         BIGINT NOT NULL CHECK (solides_id <> 0),
  situacao           TEXT NOT NULL DEFAULT 'normal' CHECK (situacao IN ('normal', 'afastado', 'licenca_maternidade')),
  dias_trabalhados   NUMERIC(5, 2) NOT NULL DEFAULT 30 CHECK (dias_trabalhados BETWEEN 0 AND 31),
  outros_proventos   NUMERIC(12, 2) NOT NULL DEFAULT 0,
  dias_ferias        NUMERIC(5, 2) NOT NULL DEFAULT 0 CHECK (dias_ferias BETWEEN 0 AND 31),
  inss_ferias        NUMERIC(12, 2) NOT NULL DEFAULT 0 CHECK (inss_ferias >= 0),
  coparticipacao     NUMERIC(12, 2) NOT NULL DEFAULT 0,
  outros_descontos   NUMERIC(12, 2) NOT NULL DEFAULT 0,
  comissao           NUMERIC(12, 2) NOT NULL DEFAULT 0,
  vt_dias_desconto   NUMERIC(5, 2) NOT NULL DEFAULT 0 CHECK (vt_dias_desconto BETWEEN 0 AND 31),
  -- { "irrf": { "valor": 123.45, "motivo": "..." }, ... } — só colunas de cálculo (motor.ts, COLUNAS_AJUSTAVEIS).
  ajustes            JSONB NOT NULL DEFAULT '{}'::jsonb,
  observacao         TEXT,
  updated_by         UUID REFERENCES public.users(id) ON DELETE SET NULL,
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (competencia, solides_id)
);

CREATE TABLE IF NOT EXISTS public.dp_folha_fechamentos (
  company_id  UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  competencia TEXT NOT NULL CHECK (competencia ~ '^\d{4}-(0[1-9]|1[0-2])$'),
  -- { vigencia, linhas: [resultado do motor por pessoa], rescisoes: [...] }
  resultado   JSONB NOT NULL,
  fechado_por UUID REFERENCES public.users(id) ON DELETE SET NULL,
  fechado_em  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (company_id, competencia)
);

CREATE TABLE IF NOT EXISTS public.dp_folha_rescisoes (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id     UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  competencia    TEXT NOT NULL CHECK (competencia ~ '^\d{4}-(0[1-9]|1[0-2])$'),
  data_pagamento DATE,
  tipo           TEXT NOT NULL DEFAULT '',
  setor          TEXT NOT NULL DEFAULT '',
  valor          NUMERIC(12, 2) NOT NULL CHECK (valor >= 0),
  solides_id     BIGINT,
  nome           TEXT NOT NULL,
  observacao     TEXT,
  created_by     UUID REFERENCES public.users(id) ON DELETE SET NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS dp_folha_rescisoes_comp_idx ON public.dp_folha_rescisoes (company_id, competencia);

-- Pessoas FORA da Sólides. O id é negativo para nunca colidir com solides_id.
CREATE SEQUENCE IF NOT EXISTS public.dp_folha_avulso_seq;
CREATE TABLE IF NOT EXISTS public.dp_folha_avulsos (
  pessoa_id         BIGINT PRIMARY KEY DEFAULT (-nextval('public.dp_folha_avulso_seq')) CHECK (pessoa_id < 0),
  company_id        UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  nome              TEXT NOT NULL CHECK (btrim(nome) <> ''),
  cpf               TEXT,
  setor             TEXT,
  -- Mesmo vocabulário da Sólides ("CLT", "Estagiário", "Prestador de Serviço", "Sócio", "Jovem Aprendiz").
  tipo_contrato     TEXT,
  salario           NUMERIC(12, 2) CHECK (salario >= 0),
  data_nascimento   DATE,
  data_admissao     DATE,
  data_desligamento DATE,
  centro_custo_id   UUID REFERENCES public.dp_centros_custo(id) ON DELETE SET NULL,
  -- Quando a pessoa aparece na Sólides e é unificada: o solides_id que herdou cadastro e meses.
  unificado_com     BIGINT,
  observacao        TEXT,
  created_by        UUID REFERENCES public.users(id) ON DELETE SET NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by        UUID REFERENCES public.users(id) ON DELETE SET NULL,
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS dp_folha_avulsos_company_idx ON public.dp_folha_avulsos (company_id);

-- ── RLS: mesma regra do resto do módulo — leitura direta só para o gestor,
-- nunca is_admin(); escrita só service role (sem policy de escrita).
ALTER TABLE public.dp_folha_parametros  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.dp_folha_cadastro    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.dp_folha_lancamentos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.dp_folha_fechamentos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.dp_folha_rescisoes   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.dp_folha_avulsos     ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS dp_folha_parametros_select ON public.dp_folha_parametros;
CREATE POLICY dp_folha_parametros_select ON public.dp_folha_parametros FOR SELECT TO authenticated USING (public.dp_has_access());
DROP POLICY IF EXISTS dp_folha_cadastro_select ON public.dp_folha_cadastro;
CREATE POLICY dp_folha_cadastro_select ON public.dp_folha_cadastro FOR SELECT TO authenticated USING (public.dp_has_access());
DROP POLICY IF EXISTS dp_folha_lancamentos_select ON public.dp_folha_lancamentos;
CREATE POLICY dp_folha_lancamentos_select ON public.dp_folha_lancamentos FOR SELECT TO authenticated USING (public.dp_has_access());
DROP POLICY IF EXISTS dp_folha_fechamentos_select ON public.dp_folha_fechamentos;
CREATE POLICY dp_folha_fechamentos_select ON public.dp_folha_fechamentos FOR SELECT TO authenticated USING (public.dp_has_access());
DROP POLICY IF EXISTS dp_folha_rescisoes_select ON public.dp_folha_rescisoes;
CREATE POLICY dp_folha_rescisoes_select ON public.dp_folha_rescisoes FOR SELECT TO authenticated USING (public.dp_has_access());
DROP POLICY IF EXISTS dp_folha_avulsos_select ON public.dp_folha_avulsos;
CREATE POLICY dp_folha_avulsos_select ON public.dp_folha_avulsos FOR SELECT TO authenticated USING (public.dp_has_access());

COMMENT ON TABLE public.dp_folha_parametros IS 'DP (sigiloso): parâmetros da folha gerencial por vigência (INSS, IRRF, planos, VT…). Validados pelo app (folha/parametros.ts).';
COMMENT ON TABLE public.dp_folha_cadastro IS 'DP (sigiloso): o fixo da folha de cada pessoa que a Sólides não tem (plano, odonto, VA, VT, escala, adiantamento…).';
COMMENT ON TABLE public.dp_folha_lancamentos IS 'DP (sigiloso): variáveis do mês por pessoa + ajustes manuais com motivo.';
COMMENT ON TABLE public.dp_folha_fechamentos IS 'DP (sigiloso): retrato da folha fechada (empresa × competência). Existe linha = fechada; reabrir apaga.';
COMMENT ON TABLE public.dp_folha_rescisoes IS 'DP (sigiloso): rescisões pagas no mês (indenizações nos totais).';
COMMENT ON TABLE public.dp_folha_avulsos IS 'DP (sigiloso): pessoas da folha que não existem na Sólides. pessoa_id negativo = a "pessoa" em cadastro/lançamentos/rescisões.';
