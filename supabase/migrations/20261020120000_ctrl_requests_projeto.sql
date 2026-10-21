-- Campo "Projeto" da requisição (Compras) → codigo_projeto no contas a pagar do
-- Omie. Guarda só o NOME; o código Omie é resolvido NO ENVIO
-- (ensureProjetoByNome: cria/reusa por nome no CNPJ pagador). NULL = "Sem
-- Projeto" (campo vazio no Omie). Sem cruzamento com orçamento.
--
-- Precedência no lançamento (ver src/lib/ctrl/actions/contapagar-launch.ts):
-- EVENTO (Viva) que casa com um projeto já existente SOBREPÕE; sem evento ou
-- evento sem projeto, vale este campo; "Sem Projeto" → sem projeto no Omie.
alter table public.ctrl_requests
  add column if not exists projeto_nome text;
