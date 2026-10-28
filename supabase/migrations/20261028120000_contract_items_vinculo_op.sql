-- Vínculo da RP com a OP, vindo do relatório de requisições (formato novo de
-- 28/10/2026): coluna D "Item" e coluna F "Nome Evento OP". Decidem a comissão
-- (decidirComissaoPorOp em src/lib/contracts/validate.ts): evento "Custo
-- administrativo" + item da lista de comissões + descrição com "comissão" →
-- aprovada; qualquer falta → análise especialista.
-- Aplicar ANTES do deploy: o upload grava as duas colunas e o processamento as lê.
ALTER TABLE public.contract_validation_items
  ADD COLUMN IF NOT EXISTS item_op text,
  ADD COLUMN IF NOT EXISTS nome_evento_op text;
