-- =============================================================================
-- Grupos de despesa: a empresa USA esse subnível? (27/10/2026)
--
-- Pedido do dono do projeto: uma chavinha no card "Grupos de despesa" da
-- Configuração da empresa. Ligada, a árvore de categorias aparece para o admin
-- cadastrar os grupos; desligada, somem as opções e o cadastro. **Padrão:
-- desligada**, exceto na empresa de teste do módulo.
--
-- O grupo é o subnível entre a categoria da DRE e a despesa ("Softwares" ›
-- "Design" › "Figma"). Ele nasceu para uma empresa que organiza a despesa
-- assim; a maioria não organiza, e para essas a árvore é uma tela longa que
-- convida a preencher o que não se aplica — o mesmo argumento de
-- `orcamento_metodos_ocultos`.
--
-- ── Guarda-se o que está ATIVO, e aqui a polaridade é o INVERSO da de
--    `orcamento_metodos_ocultos` ────────────────────────────────────────────
-- Lá a tabela lista EXCLUSÕES porque o padrão é "aparece"; aqui o padrão pedido
-- é "não aparece", então a tabela lista as EXCEÇÕES do outro lado: **existe
-- linha = a empresa usa grupos**. A regra é a mesma — guardar a exceção, nunca
-- a regra —, e é ela que faz tabela vazia significar exatamente o padrão
-- pedido, sem backfill e sem empresa que "nasce ligada" porque alguém esqueceu
-- de desmarcá-la. Empresa nova nasce desligada, que é o que se quer.
--
-- Quem for ler isto depois: não presuma "linha = inativo" por analogia com
-- `orcamento_metodos_ocultos`. A polaridade está num lugar só do código
-- (`gruposAtivosNaEmpresa`, em src/lib/orcamento/grupos-ativo.ts), com teste.
--
-- ── Por EMPRESA, sem ano ───────────────────────────────────────────────────
-- O catálogo que esta chave governa (`orcamento_grupos_despesa`) é por empresa
-- e SEM ano — "a lista atravessa os exercícios". Uma chave por ano se
-- desligaria sozinha em cada janeiro e faria o cadastro inteiro sumir da tela
-- sem ninguém ter mexido nela. Mesmo enquadramento de
-- `orcamento_metodos_ocultos`: "esta empresa usa grupos?" é fato cadastral da
-- unidade, não do exercício.
--
-- ── Isto esconde a PORTA, não o número ────────────────────────────────────
-- Desligar não apaga grupo, escopo nem despesa: o `grupo_id` continua gravado
-- em cada despesa e a Prévia continua mostrando o subnível que já existe —
-- aquelas despesas ESTÃO naqueles grupos, e reescrevê-las como "Sem grupo"
-- seria mentir sobre o que está no banco. O que a chave governa é o que se
-- OFERECE daqui em diante: o cadastro e a lista de grupos da montagem. Religar
-- devolve tudo, e é por isso que desligar não precisa ser recusado.
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.orcamento_grupos_despesa_ativo (
  company_id uuid PRIMARY KEY REFERENCES public.companies(id) ON DELETE CASCADE,
  ativado_em timestamptz NOT NULL DEFAULT now(),
  ativado_por uuid REFERENCES public.users(id) ON DELETE SET NULL
);

-- ── Semeadura: ligado onde JÁ HÁ cadastro ──────────────────────────────────
-- O pedido nomeia a "Empresa Teste Módulo Orçamento", e em 27/10/2026 ela é a
-- ÚNICA empresa com grupos cadastrados (19 grupos, 86 escopos; as demais têm
-- zero). Semear pelo dado, em vez de pelo nome, dá o mesmo resultado hoje e uma
-- garantia a mais: nenhuma empresa perde de vista um cadastro que alguém fez
-- entre a escrita desta migration e a aplicação dela.
INSERT INTO public.orcamento_grupos_despesa_ativo (company_id)
SELECT DISTINCT g.company_id
FROM public.orcamento_grupos_despesa g
ON CONFLICT (company_id) DO NOTHING;

-- ── RLS ─────────────────────────────────────────────────────────────────────
-- LEITURA para qualquer usuário do módulo que alcance a empresa: é ela que diz
-- à tela de montagem se o campo "grupo" deve existir. Um gerente que não
-- pudesse ler veria o campo sempre, contradizendo a chave.
--
-- ESCRITA admin-only (é configuração da empresa, como "Orçar por setor"). A
-- action repete a trava; a policy é a segunda linha de defesa.
ALTER TABLE public.orcamento_grupos_despesa_ativo ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "orcamento_grupos_ativo admin all"
  ON public.orcamento_grupos_despesa_ativo;
CREATE POLICY "orcamento_grupos_ativo admin all"
  ON public.orcamento_grupos_despesa_ativo
  FOR ALL TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "orcamento_grupos_ativo orcamento read"
  ON public.orcamento_grupos_despesa_ativo;
CREATE POLICY "orcamento_grupos_ativo orcamento read"
  ON public.orcamento_grupos_despesa_ativo
  FOR SELECT TO authenticated
  USING (public.orcamento_pode_ler_empresa(company_id));

NOTIFY pgrst, 'reload schema';
