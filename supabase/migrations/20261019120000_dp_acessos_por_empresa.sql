-- ============================================================================
-- Departamento Pessoal — papéis e recorte por EMPRESA (19/10/2026).
--
-- Pedido do dono do projeto: a equipe do DP vai usar o módulo, e nem todo
-- mundo pode ver todas as empresas. Decisões:
--   - dois papéis em user_module_roles (module='dp'):
--       'gestor'   → todas as empresas, Configurações e Acessos;
--       'analista' → só as empresas desta tabela;
--   - quem concede é o GESTOR, pela tela Configurações › Acessos do próprio DP
--     (a tela de Usuários continua sem mostrar nada do DP — sigilo);
--   - a admin Carol nunca entra (bloqueio nominal no app, @/lib/auth/dp, e
--     em dp_has_access() — ver o fim deste arquivo);
--   - toda concessão fica registrada em dp_concessoes.
--
-- dp_user_empresas é ADITIVA: gestor ignora a tabela, então os dois gestores
-- de hoje (Lucas, Marcelo) não mudam de comportamento.
--
-- RLS: dp_has_access() continua exigindo role='gestor' (migration
-- 20260929150000). Isso significa que o ANALISTA não lê NADA das tabelas dp_*
-- direto pelo PostgREST — e é de propósito: o espelho não tem coluna de
-- empresa (ela é resolvida na leitura pelo de-para), então uma policy por
-- empresa não teria em que se apoiar. Todas as telas do DP leem com o admin
-- client DEPOIS do gate do app, que recorta por empresa. Falha fechada: se
-- alguém um dia ler com o client do usuário, o analista vê zero, nunca outra
-- empresa.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.dp_user_empresas (
  user_id     UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  company_id  UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  created_by  UUID REFERENCES public.users(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, company_id)
);

ALTER TABLE public.dp_user_empresas ENABLE ROW LEVEL SECURITY;

-- Leitura direta só para gestor (mesmo predicado das outras dp_*); sem policy
-- de escrita: o app grava com o service role depois de requireDpGestor().
DROP POLICY IF EXISTS dp_user_empresas_select ON public.dp_user_empresas;
CREATE POLICY dp_user_empresas_select ON public.dp_user_empresas
  FOR SELECT TO authenticated USING (public.dp_has_access());

COMMENT ON TABLE public.dp_user_empresas IS
  'DP (sigiloso): empresas que cada ANALISTA do DP enxerga. Gestor ignora (vê todas). Escrita só service role, pela tela Configurações › Acessos.';

COMMENT ON FUNCTION public.dp_has_access() IS
  'DP (sigiloso): leitura DIRETA das tabelas dp_* — só o papel gestor. Analista lê apenas pelo app (admin client + recorte por empresa).';

-- ── Bloqueio nominal também no banco ────────────────────────────────────────
-- O app já recusa (DP_EMAILS_BLOQUEADOS em src/lib/auth/dp.ts): nem a tela de
-- Acessos concede, nem a sessão reconhece a concessão. Repetir aqui fecha o
-- último caminho — uma linha inserida à mão com o service role daria leitura
-- direta pelo PostgREST. As duas listas são conferidas por dp-bloqueio.test.ts;
-- mudar uma sem a outra quebra a suíte.
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

COMMENT ON FUNCTION public.dp_has_access() IS
  'DP (sigiloso): leitura DIRETA das tabelas dp_* — só o papel gestor, nunca e-mail bloqueado. Analista lê apenas pelo app (admin client + recorte por empresa).';

-- ── Registro das concessões ─────────────────────────────────────────────────
-- Quem liberou o DP a quem, com qual papel e quais empresas. Num módulo
-- sigiloso, "quem deu acesso a esta pessoa?" precisa de resposta. Retrato do
-- que ficou valendo depois de cada gesto (não o diff): é o que se lê.
CREATE TABLE IF NOT EXISTS public.dp_concessoes (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  alvo_user_id UUID REFERENCES public.users(id) ON DELETE SET NULL,
  acao         TEXT NOT NULL CHECK (acao IN ('concedeu', 'alterou', 'removeu')),
  papel        TEXT CHECK (papel IN ('gestor', 'analista')),
  empresas     UUID[] NOT NULL DEFAULT '{}',
  por_user_id  UUID REFERENCES public.users(id) ON DELETE SET NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS dp_concessoes_created_idx ON public.dp_concessoes (created_at DESC);

ALTER TABLE public.dp_concessoes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS dp_concessoes_select ON public.dp_concessoes;
CREATE POLICY dp_concessoes_select ON public.dp_concessoes
  FOR SELECT TO authenticated USING (public.dp_has_access());

COMMENT ON TABLE public.dp_concessoes IS
  'DP (sigiloso): trilha das concessões do módulo (Configurações › Acessos). Escrita só service role; ninguém edita nem apaga pelo PostgREST.';
