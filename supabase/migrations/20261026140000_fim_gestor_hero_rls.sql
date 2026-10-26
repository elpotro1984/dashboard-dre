-- ============================================================================
-- Fim do "gestor_hero" no RLS (varredura de acessos de 26/10/2026).
-- Desenho: docs/superpowers/specs/2026-10-26-usuarios-modulo-perfil.md
--
-- PROBLEMA: is_hero_manager() (users.role = 'gestor_hero') liberava, direto no
-- banco, LEITURA de TODAS as empresas e ESCRITA em financial_entries, sync_log
-- e omie_categories de qualquer empresa. users.role = 'gestor_hero' era
-- derivado do perfil do Compras (diretor, contas_a_pagar) — não da tela de
-- Usuários. Na varredura, 8 pessoas ativas tinham o papel; ex.: Larissa
-- (8 empresas no Financeiro) lia as 30 por uma chamada direta à API do
-- Supabase com a própria sessão, e Marcelo Teste (sem o módulo Financeiro)
-- também.
--
-- O app nunca dependeu disso para mostrar dados: as telas do Financeiro
-- filtram por user_company_access (resolveAllowedCompanyIds) e os módulos
-- Compras/Orçamento/Caixa/Case/Contratos leem pelo service role. A
-- sincronização manual (o único gravador pela sessão do usuário) fica só para
-- admin no mesmo deploy — é a tela Conexões, que já é só de admin.
--
-- CORREÇÃO: is_hero_manager() passa a responder FALSE para todos (a função
-- fica, porque ~50 policies e accessible_company_ids() a chamam) e o papel
-- some dos cadastros. A fronteira financeira volta a ser UMA só:
-- admin OU user_company_access — exatamente o que a tela de Usuários grava.
--
-- Idempotente. Aplicar pelo SQL Editor.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.is_hero_manager()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  -- Desligado em 26/10/2026: empresa no Financeiro só pela tela de Usuários
  -- (user_company_access). Não reativar — ver o cabeçalho da migration.
  SELECT false;
$$;

GRANT EXECUTE ON FUNCTION public.is_hero_manager() TO authenticated;

COMMENT ON FUNCTION public.is_hero_manager() IS
  'Desligada (sempre false) desde 26/10/2026: o acesso a empresas vem só de is_admin() ou user_company_access, gravados pela tela de Usuários.';

UPDATE public.users
SET role = 'gestor_unidade'
WHERE role = 'gestor_hero';

-- users.company_id: as policies antigas ainda leem "a empresa do usuário" por
-- ele, por fora de user_company_access. Na varredura estava NULL em todos e a
-- tela de Usuários não o grava; zerar garante que siga assim.
UPDATE public.users
SET company_id = NULL
WHERE company_id IS NOT NULL;

-- De carona (mesma varredura): count_unmapped_categories() é SECURITY DEFINER
-- e respondia a QUALQUER usuário logado a contagem de categorias sem
-- mapeamento somando todas as empresas. Só o painel de alertas do admin a
-- chama (/api/home/stats, já restrito a admin) — para os demais, zero.
CREATE OR REPLACE FUNCTION public.count_unmapped_categories()
 RETURNS integer
 LANGUAGE sql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT CASE WHEN NOT (SELECT public.is_admin()) THEN 0 ELSE (
    SELECT count(*)::int
    FROM (
      SELECT DISTINCT fe.category_code
      FROM public.financial_entries fe
      WHERE fe.category_code IS NOT NULL
    ) c
    WHERE NOT EXISTS (
      SELECT 1 FROM public.category_mapping cm
      WHERE cm.omie_category_code = c.category_code
    )
  ) END;
$function$;

NOTIFY pgrst, 'reload schema';
