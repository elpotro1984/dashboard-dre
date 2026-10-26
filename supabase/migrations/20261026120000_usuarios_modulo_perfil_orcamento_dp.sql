-- ============================================================================
-- Tela de Usuários MÓDULO → PERFIL — passo 3 (26/10/2026).
-- Desenho: docs/superpowers/specs/2026-10-26-usuarios-modulo-perfil.md
--
-- Duas mudanças, ambas DIFF-ZERO para os usuários de hoje (conferido pelo
-- retrato de permissões, scripts/usuarios-retrato-permissoes.ts):
--
--   1. Orçamento ganha a SUA lista de empresas (orcamento_user_empresas). Até
--      a tela nova existir, ela é um ESPELHO EXATO de user_company_access
--      (backfill + gatilho), então o alcance de todo mundo é o mesmo de hoje.
--      As policies do módulo passam a ler dela.
--   2. O DP passa a ser herdado pelo admin (decisão de 26/10/2026), mantendo o
--      bloqueio nominal da Carol. Os admins de hoje são Lucas e Marcelo (já
--      gestores do DP) e Carol (bloqueada): ninguém ganha acesso hoje.
--
-- Idempotente. Aplicar pelo SQL Editor. O app funciona ANTES e DEPOIS dela:
-- sem a tabela, getOrcamentoUser cai em user_company_access (o de hoje).
-- ============================================================================

-- ── 1. Empresas do Orçamento ────────────────────────────────────────────────
-- Por que não continuar em user_company_access: aquela tabela é a fronteira do
-- RLS dos dados FINANCEIROS (user_has_company_access não confere o módulo), e
-- na tela nova cada módulo tem a sua lista — o Orçamento numa empresa não pode
-- abrir lançamento financeiro dela.
CREATE TABLE IF NOT EXISTS public.orcamento_user_empresas (
  user_id     uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  company_id  uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  created_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, company_id)
);

ALTER TABLE public.orcamento_user_empresas ENABLE ROW LEVEL SECURITY;

-- Leitura: a própria pessoa (é o que getOrcamentoUser lê com o client dela) e
-- admin. Escrita só service role (as rotas de Usuários) — sem policy de escrita.
DROP POLICY IF EXISTS orcamento_user_empresas_select ON public.orcamento_user_empresas;
CREATE POLICY orcamento_user_empresas_select ON public.orcamento_user_empresas
  FOR SELECT TO authenticated
  USING (user_id = (SELECT auth.uid()) OR (SELECT public.is_admin()));

COMMENT ON TABLE public.orcamento_user_empresas IS
  'Empresas que cada usuário alcança no módulo Orçamento. Até a tela de Usuários módulo → perfil, espelho exato de user_company_access (gatilho orcamento_espelha_user_company_access).';

-- Backfill: cópia INTEIRA de user_company_access, não só de quem tem o módulo.
-- É o que torna o espelho exato: hoje, conceder o Orçamento a alguém faz valer
-- as unidades que ele já tem — com a cópia inteira, isso continua verdade.
INSERT INTO public.orcamento_user_empresas (user_id, company_id)
SELECT uca.user_id, uca.company_id
FROM public.user_company_access uca
ON CONFLICT DO NOTHING;

-- Espelho TEMPORÁRIO: três rotas gravam em user_company_access (PATCH e convite
-- de Usuários, e /api/segments/companies). Um gatilho cobre as três e qualquer
-- gravador futuro. SAI quando a tela nova passar a gravar as empresas do
-- Orçamento separadamente (passo 5 do desenho) — senão ele desfaria a escolha.
CREATE OR REPLACE FUNCTION public.orcamento_espelha_user_company_access()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO public.orcamento_user_empresas (user_id, company_id)
    VALUES (NEW.user_id, NEW.company_id)
    ON CONFLICT DO NOTHING;
    RETURN NEW;
  ELSIF TG_OP = 'DELETE' THEN
    DELETE FROM public.orcamento_user_empresas
    WHERE user_id = OLD.user_id AND company_id = OLD.company_id;
    RETURN OLD;
  ELSE -- UPDATE (ninguém faz hoje; coberto para o espelho não divergir)
    DELETE FROM public.orcamento_user_empresas
    WHERE user_id = OLD.user_id AND company_id = OLD.company_id;
    INSERT INTO public.orcamento_user_empresas (user_id, company_id)
    VALUES (NEW.user_id, NEW.company_id)
    ON CONFLICT DO NOTHING;
    RETURN NEW;
  END IF;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.orcamento_espelha_user_company_access() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS orcamento_espelha_user_company_access ON public.user_company_access;
CREATE TRIGGER orcamento_espelha_user_company_access
  AFTER INSERT OR UPDATE OR DELETE ON public.user_company_access
  FOR EACH ROW EXECUTE FUNCTION public.orcamento_espelha_user_company_access();

-- Predicado de empresa das policies do Orçamento: lia user_has_company_access
-- (a lista do Financeiro); passa a ler a lista do próprio módulo. Todas as
-- policies "<tabela> orcamento read" chamam esta função, então mudam juntas.
CREATE OR REPLACE FUNCTION public.orcamento_pode_ler_empresa(target_company_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  select
    public.orcamento_has_access()
    and (
      public.is_admin()
      or exists (
        select 1 from public.orcamento_user_empresas e
        where e.user_id = auth.uid()
          and e.company_id = target_company_id
      )
    );
$$;

-- Tem o módulo? Igual a antes, mais o PERFIL GRAVADO do módulo: a tela nova
-- grava role 'construtor' | 'construtor_amplo' | 'validador' na linha de
-- concessão e o perfil do Compras deixa de decidir o Orçamento. Espelha
-- resolveOrcamentoPapel (src/lib/auth/orcamento.ts). Hoje todas as linhas são
-- 'auto', então o ramo novo não é tomado por ninguém.
CREATE OR REPLACE FUNCTION public.orcamento_has_access()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  select exists (
    select 1
    from public.users u
    where u.id = auth.uid()
      and u.active = true
      and (
        u.profile = 'admin'
        or (
          u.profile is distinct from 'validador_contrato'
          and exists (
            select 1 from public.user_module_roles r
            where r.user_id = u.id
              and r.module = 'orcamento'
              and (
                u.profile in ('diretor', 'gerente', 'gerente_setor')
                or r.role in ('construtor', 'construtor_amplo', 'validador')
              )
          )
        )
      )
  );
$$;

REVOKE EXECUTE ON FUNCTION public.orcamento_has_access() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.orcamento_pode_ler_empresa(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.orcamento_has_access() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.orcamento_pode_ler_empresa(uuid) TO authenticated, service_role;

-- ── 2. DP herdado pelo admin ────────────────────────────────────────────────
-- Leitura DIRETA das tabelas dp_*: gestor OU admin ativo, nunca e-mail
-- bloqueado. A lista do NOT IN é conferida contra DP_EMAILS_BLOQUEADOS (app)
-- por dp-bloqueio.test.ts. O gatilho dp_guard_module_grant FICA: a tela de
-- Usuários grava pelo service role, e ele segue barrando escrita pelo console.
CREATE OR REPLACE FUNCTION public.dp_has_access()
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.users u
    WHERE u.id = auth.uid()
      AND u.active IS NOT FALSE
      AND lower(coalesce(u.email, '')) NOT IN ('carol@quokka.net.br')
      AND (
        u.profile = 'admin'
        OR u.role = 'admin'
        OR EXISTS (
          SELECT 1 FROM public.user_module_roles r
          WHERE r.user_id = u.id
            AND r.module = 'dp'
            AND r.role = 'gestor'
        )
      )
  );
$$;

REVOKE EXECUTE ON FUNCTION public.dp_has_access() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.dp_has_access() TO authenticated, service_role;

COMMENT ON FUNCTION public.dp_has_access() IS
  'DP: leitura DIRETA das tabelas dp_* — papel gestor ou admin ativo, nunca e-mail bloqueado. Analista lê apenas pelo app (admin client + recorte por empresa).';

NOTIFY pgrst, 'reload schema';
