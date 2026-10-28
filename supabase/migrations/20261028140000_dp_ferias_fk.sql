-- DP › Pagamento de férias › checkbox "FK" (28/10/2026)
--
-- Marca as férias que NÃO são férias verdadeiras para os benefícios: na Gestão
-- de benefícios, férias com FK marcado não tiram dias do VT, da gasolina, da
-- carona nem do vale-alimentação por dia. Desmarcado (o padrão) = férias de
-- verdade, que reduzem os dias.
--
-- Por enquanto só a Gestão de benefícios lê a coluna: a Folha do mês segue
-- contando todas as férias do controle.
--
-- Aditiva: o código lê sem a coluna (trata tudo como FK desmarcado) e só gravar
-- FK marcado exige esta migration.

ALTER TABLE public.dp_ferias ADD COLUMN IF NOT EXISTS fk BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN public.dp_ferias.fk IS 'FK marcado = não são férias verdadeiras para os benefícios (não reduzem os dias na Gestão de benefícios).';
