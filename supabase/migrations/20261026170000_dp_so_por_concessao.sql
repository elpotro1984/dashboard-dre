-- ============================================================================
-- Departamento Pessoal — admin NÃO herda o DP; só a concessão abre o módulo, e
-- quem concede é só o Lucas Meireles (decisão do dono do projeto, 26/10/2026).
--
-- A 20261026120000_usuarios_modulo_perfil_orcamento_dp fez o admin herdar o DP
-- (com o bloqueio nominal da Carol no NOT IN). Com a herança, qualquer admin
-- abriria o DP a outra conta só por torná-la admin. A regra agora:
--   - o DP é marcado pessoa a pessoa, inclusive para admin, na tela de
--     Usuários — e só o Lucas vê e grava essa seção (app:
--     src/lib/auth/concessao-reservada.ts + src/lib/usuarios/gravar-acessos.ts);
--   - o bloqueio por e-mail sai: sem herança, a Carol não vê o DP sem a
--     concessão, e o Lucas pode liberá-la marcando o módulo no cadastro dela;
--   - o gatilho dp_guard_module_grant FICA: só o service role escreve a linha
--     module='dp' (a tela grava por ele; o console, não).
--
-- dp-acesso-banco.test.ts lê a última definição desta função e recusa que ela
-- volte a citar admin.
-- ============================================================================

-- 1. Antes de tirar a herança: Lucas e Marcelo seguem gestores do DP por linha
-- própria (concedida em 20260929150000; conferido em 26/10/2026 que as duas
-- linhas existem). Garantia idempotente — sem a linha, tirar a herança cortaria
-- o DP dos dois no mesmo instante.
WITH novas AS (
  INSERT INTO public.user_module_roles (user_id, module, role, granted_by)
  SELECT u.id, 'dp', 'gestor', '8f794ea7-dec9-47f6-9eb8-20a8e8d025e9'::uuid
    FROM public.users u
   WHERE u.id IN ('8f794ea7-dec9-47f6-9eb8-20a8e8d025e9', 'bb98c142-3d9c-450c-b8b8-da88320e4d6b')
     AND NOT EXISTS (
       SELECT 1 FROM public.user_module_roles r
        WHERE r.user_id = u.id AND r.module = 'dp' AND r.role = 'gestor'
     )
  RETURNING user_id
)
INSERT INTO public.dp_concessoes (alvo_user_id, acao, papel, empresas, por_user_id)
SELECT user_id, 'concedeu', 'gestor', '{}', '8f794ea7-dec9-47f6-9eb8-20a8e8d025e9'::uuid FROM novas;

-- 2. Leitura DIRETA das tabelas dp_*: só quem tem a concessão de gestor, ativo.
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
  );
$$;

REVOKE EXECUTE ON FUNCTION public.dp_has_access() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.dp_has_access() TO authenticated, service_role;

COMMENT ON FUNCTION public.dp_has_access() IS
  'DP: só a concessão (linha module=dp, papel gestor) e usuário ativo. Admin não herda; quem concede é só o Lucas (app).';
