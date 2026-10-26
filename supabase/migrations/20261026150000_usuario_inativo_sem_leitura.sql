-- ============================================================================
-- Usuário DESATIVADO não lê nada pelo banco (26/10/2026).
--
-- Achado pelo teste automático da trava (scripts/teste-trava-acessos.ts,
-- `npm run teste:trava`): desativar na tela de Usuários não bloqueia o login no
-- Supabase Auth (de propósito — o cadastro pendente nasce inativo e precisa
-- logar para ver a tela /pendente). O app recusa a sessão, mas pela API direta
-- o desativado ainda lia:
--   - o NOME das empresas que tinha (policy de companies por
--     user_company_access, sem conferir `active`);
--   - as próprias linhas de user_company_access.
-- Dados financeiros já estavam fechados (accessible_company_ids e
-- user_has_company_access exigem usuário ativo).
--
-- Correção: as duas policies passam a exigir usuário ativo. companies usa o
-- mesmo conjunto das tabelas financeiras (accessible_company_ids: admin ativo
-- = todas; demais = user_company_access com usuário ativo).
--
-- Idempotente. Aplicar pelo SQL Editor.
-- ============================================================================

DROP POLICY IF EXISTS "Users read companies via user_company_access" ON public.companies;
CREATE POLICY "Users read companies via user_company_access"
  ON public.companies
  FOR SELECT
  TO authenticated
  USING (id IN (SELECT public.accessible_company_ids()));

DROP POLICY IF EXISTS "Users can read own company access" ON public.user_company_access;
CREATE POLICY "Users can read own company access"
  ON public.user_company_access
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.users u
      WHERE u.id = (SELECT auth.uid())
        AND u.active = true
        AND (u.id = user_company_access.user_id OR u.role = 'admin')
    )
  );

NOTIFY pgrst, 'reload schema';
