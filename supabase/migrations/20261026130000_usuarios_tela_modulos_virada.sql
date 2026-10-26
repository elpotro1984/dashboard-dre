-- ============================================================================
-- Tela de Usuários MÓDULO → PERFIL — VIRADA (passo 5).
-- Desenho: docs/superpowers/specs/2026-10-26-usuarios-modulo-perfil.md
--
-- APLICAR SÓ NA VIRADA: no mesmo momento em que a tela nova vira a padrão
-- (env USUARIOS_TELA_MODULOS=1) e a migração dos perfis roda
-- (scripts/usuarios-migrar-perfis.ts). Antes disso, NÃO aplicar: a tela antiga
-- depende do gatilho-espelho abaixo para o Orçamento acompanhar as unidades.
--
-- 1. Sai o gatilho-espelho user_company_access → orcamento_user_empresas
--    (temporário desde 20261026120000). A tela nova grava as empresas do
--    Orçamento por conta própria; com o espelho, salvar as empresas do
--    Financeiro reescreveria as do Orçamento.
-- 2. can_validate_bi_reports() reconhece a CSC gravada no Financeiro
--    (user_module_roles module='financeiro', role='csc'). Com a tela nova, quem
--    é CSC no Financeiro e tem um perfil no Compras fica com users.profile = o
--    perfil do Compras — e a função lia só profile = 'csc'. Espelha
--    canAccessBiValidation no app.
--
-- Idempotente.
-- ============================================================================

DROP TRIGGER IF EXISTS orcamento_espelha_user_company_access ON public.user_company_access;
DROP FUNCTION IF EXISTS public.orcamento_espelha_user_company_access();

COMMENT ON TABLE public.orcamento_user_empresas IS
  'Empresas que cada usuário alcança no módulo Orçamento — gravadas pela tela de Usuários (módulo → perfil), independentes das empresas do Financeiro.';

CREATE OR REPLACE FUNCTION public.can_validate_bi_reports()
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.users u
    WHERE u.id = auth.uid()
      AND u.active
      -- Validador de contrato é perfil-ILHA (só /contratos): nem a exceção
      -- nominal por e-mail o libera. Espelha canAccessBiValidation no app.
      AND u.profile::text IS DISTINCT FROM 'validador_contrato'
      AND (
        u.role = 'admin'
        OR u.profile::text = 'admin'
        OR u.profile::text = 'csc'
        OR EXISTS (
          SELECT 1 FROM public.user_module_roles r
          WHERE r.user_id = u.id
            AND r.module = 'financeiro'
            AND r.role = 'csc'
        )
        OR lower(u.email) IN ('marcela@quokka.net.br', 'marcelo@quokka.net.br')
      )
  );
$$;

GRANT EXECUTE ON FUNCTION public.can_validate_bi_reports() TO authenticated;

NOTIFY pgrst, 'reload schema';
