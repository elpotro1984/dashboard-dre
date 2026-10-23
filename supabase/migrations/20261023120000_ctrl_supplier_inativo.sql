-- Fornecedor INATIVADO (Compras › Fornecedores › aba "Inativados").
--
-- "Remover a homologação": o fornecedor deixa de aparecer na criação de
-- requisição, o envio ao pagamento passa a ser recusado (as travas comparam
-- status <> 'aprovado') e o cadastro é inativado na Omie em cada unidade da
-- empresa do Compras onde ele existe. Reativar volta para 'aprovado' e
-- reativa na Omie.
--
-- Quem inativou/reativou e o motivo ficam em ctrl_supplier_history (action
-- 'inativado' / 'reativado', coluna texto) — sem coluna nova em ctrl_suppliers,
-- para a tela não depender desta migration para carregar.
--
-- Aditiva: enquanto não roda, só o botão Inativar falha (22P02, com mensagem);
-- o resto da tela segue igual.

ALTER TYPE public.ctrl_supplier_status ADD VALUE IF NOT EXISTS 'inativo';
