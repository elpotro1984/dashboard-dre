-- =============================================================================
-- Orçamento — o de-para DEPARTAMENTO DO DP → SETOR DO ORÇAMENTO (27/10/2026).
--
-- É o cadastro que torna possível puxar o quadro de pessoal do Departamento
-- Pessoal para a tela de Despesas com Pessoal, empresa a empresa.
--
-- ── Por que um de-para, e não casar por nome na hora ──────────────────────
-- Os dois lados são cadastros diferentes, mantidos por gente diferente: o
-- departamento vem da Sólides ("ÁREA - EMPRESA", já sem o sufixo quando chega
-- aqui) e o setor do orçamento é cadastrado à mão em `orcamento_setores`. Na
-- conferência da folha de 19/10/2026, 37 de 112 pessoas tinham setor diferente
-- do departamento da Sólides — casar por nome na hora deixaria boa parte do
-- quadro SEM setor.
--
-- E sem setor é o pior resultado possível aqui: `podeEscreverNoSetor` recusa
-- linha sem dono, então a pessoa cairia no balde "Não atribuído", que gestor
-- nenhum alcança. O gestor abriria a tela de Pessoal e não veria o colaborador
-- que o sync acabou de criar, sem nenhum erro em lugar nenhum. Com o de-para,
-- departamento não mapeado é LISTADO e não entra.
--
-- A tela pré-sugere o de-para por nome (é o padrão do módulo: o modelo já vem
-- preenchido), mas quem confirma é o admin.
--
-- ── Por que guarda o NOME do setor, e não o id ────────────────────────────
-- `orcamento_setores` é por empresa × ANO: um id vale para um ano só, e o
-- de-para teria de ser refeito todo janeiro. Pior, `cloneSetores` copia os
-- setores de um ano para o outro pelo NOME — então o nome é a identidade que o
-- sistema já usa para atravessar anos. Mesmo enquadramento de
-- `orcamento_user_setores` (o escopo de setor de cada usuário), e pela mesma
-- razão. Por isso a tabela também NÃO tem `year`: o de-para é cadastral
-- ("de que setor é a gente do Comercial?"), não do exercício.
--
-- ── A chave é COLUNA, não índice por expressão ────────────────────────────
-- `departamento_chave` é calculada no app (`chaveDepartamento`, em
-- `src/lib/orcamento/dp-sync.ts`) e o UNIQUE é sobre colunas comuns, de
-- propósito. É a pegadinha já registrada em `orcamento_grupo_escopo`: sobre
-- índice por expressão, `upsert({ ignoreDuplicates: true })` não ignora nada e
-- o lote inteiro morre com 23505. Mesma escolha de `dp_tabela_salarial`, que
-- também carrega as suas `*_chave`.
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.orcamento_dp_setores (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,

  -- O departamento como o DP o entrega, na grafia dele (é o que a tela mostra).
  departamento text NOT NULL CHECK (btrim(departamento) <> ''),
  -- A chave de comparação: minúsculas, sem acento, espaços colapsados.
  departamento_chave text NOT NULL CHECK (btrim(departamento_chave) <> ''),

  -- O NOME do setor do orçamento desta empresa (não o id — ver o cabeçalho).
  setor_nome text NOT NULL CHECK (btrim(setor_nome) <> ''),

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES public.users(id) ON DELETE SET NULL,

  CONSTRAINT orcamento_dp_setores_company_departamento_key
    UNIQUE (company_id, departamento_chave)
);

CREATE INDEX IF NOT EXISTS orcamento_dp_setores_empresa_idx
  ON public.orcamento_dp_setores (company_id);

-- ── RLS ─────────────────────────────────────────────────────────────────────
-- Mesmo par de policies do de-para de tipos de viagem: admin escreve, quem
-- alcança a empresa no Orçamento lê. A ESCRITA do app passa pelo admin client
-- depois do guard duplo (admin do Orçamento + concessão do DP) — a policy de
-- admin aqui é a segunda linha de defesa, não a primeira.
ALTER TABLE public.orcamento_dp_setores ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "orcamento_dp_setores admin all" ON public.orcamento_dp_setores;
CREATE POLICY "orcamento_dp_setores admin all" ON public.orcamento_dp_setores
  FOR ALL TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "orcamento_dp_setores orcamento read" ON public.orcamento_dp_setores;
CREATE POLICY "orcamento_dp_setores orcamento read" ON public.orcamento_dp_setores
  FOR SELECT TO authenticated
  USING (public.orcamento_pode_ler_empresa(company_id));

COMMENT ON TABLE public.orcamento_dp_setores IS
  'Orçamento: de-para departamento do DP → NOME do setor do orçamento, por empresa (sem ano). Departamento não mapeado não entra no quadro.';

NOTIFY pgrst, 'reload schema';
