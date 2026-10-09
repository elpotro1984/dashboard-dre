-- =============================================================================
-- TRILHA: `finalizou` entra no CHECK de `orcamento_alteracoes.acao` (09/10/2026).
--
-- ── O defeito ─────────────────────────────────────────────────────────────
-- `actions/finalizacao.ts` grava `acao: 'finalizou'` ao fechar uma fatia, e esse
-- valor nunca esteve no `orcamento_alteracoes_acao_chk`. O INSERT falha com 23514
-- — e falha EM SILÊNCIO: `registrarAlteracao` só escreve no console, de propósito,
-- porque a trilha nunca pode derrubar a ação que ela registra.
--
-- O efeito é pior aqui do que nos outros casos da mesma família: Finalizar é o
-- gesto que **publica no Budget e trava a fatia para todo mundo**, e a trilha é o
-- único lugar onde "quem fechou e quando" existe — a própria linha de
-- `orcamento_finalizacoes` guarda o fecho, mas o histórico de quem mexeu é da
-- trilha. Hoje, portanto, finalizar não deixa rastro nenhum.
--
-- `reabriu` JÁ estava na lista (veio do ciclo antigo, que usava a mesma palavra),
-- então reabrir sempre registrou. Era só metade do par funcionando, o que torna o
-- buraco ainda mais difícil de notar: a trilha mostra as reaberturas e não mostra
-- os fechamentos.
--
-- ── A SEXTA vez ───────────────────────────────────────────────────────────
-- É a sexta vez que um valor novo é inventado no código sem conferir o CHECK da
-- coluna neste módulo (as cinco anteriores estão registradas no CLAUDE.md:
-- `categoria_metodo.metodo`, `finalizacoes_metodo_check`,
-- `validacoes_alvo_tipo_chk`, `alteracoes_alvo_tipo_chk` e
-- `budget_uploads_raw.source`). Por isso esta migration vem acompanhada de
-- `trilha-check.test.ts`, que lê ESTE arquivo e compara a lista com o vocabulário
-- que o app pode escrever (`ACAO_LABEL` / `ALVO_LABEL`, exaustivos por tipo).
-- Valor novo no TypeScript sem migration passa a quebrar a suíte, em vez de
-- quebrar a gravação em produção sem ninguém ver.
--
-- A lista abaixo é a ANTERIOR + `finalizou`. Nada sai: os valores do ciclo
-- removido (`enviou_validacao`, `concluiu`, `publicou`…) continuam porque as
-- linhas já gravadas precisam seguir legíveis.
-- =============================================================================

ALTER TABLE public.orcamento_alteracoes
  DROP CONSTRAINT IF EXISTS orcamento_alteracoes_acao_chk;

ALTER TABLE public.orcamento_alteracoes
  ADD CONSTRAINT orcamento_alteracoes_acao_chk
  CHECK (acao IN (
    'criou', 'alterou', 'cancelou', 'reativou', 'excluiu',
    'moveu_categoria', 'moveu_setor',
    'solicitou', 'liberou', 'contestou', 'marcou_ciente', 'atendeu',
    'entregou_setor', 'desfez_entrega',
    -- O fecho da fatia. Faltava aqui desde 30/09/2026.
    'finalizou',
    'enviou_validacao', 'concluiu_validacao', 'reenviou', 'concluiu', 'publicou', 'reabriu'
  ));

NOTIFY pgrst, 'reload schema';
