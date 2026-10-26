# Tela de Usuários: MÓDULO → PERFIL (perfil por módulo)

**VIRADA FEITA em 26/10/2026:** commits `9d5cb87e` + `9879bf20` em produção; migrations 20261026120000 e 20261026130000 aplicadas; `scripts/usuarios-migrar-perfis.ts` gravado (65 usuários; 4 inativos sem acesso pulados). Retrato pós-virada × base (`_retratos/comparacao-pos-virada.txt`, fora do repo): 17 usuários com diferença, **zero ganho** — as 26 retiradas dos 14 da planilha, Pedro Leo → Visão Financeira, Carol com a regra `dp-bloqueado` no catálogo, overrides de Compras iguais ao perfil gravados como NULL (papéis idênticos) e resto de escopo do Compras limpo em quem não tem o módulo (Pedro Leo, Lucas Teste). Incidente: a rede caiu no meio da gravação de `ctrl_user_orgs` da Cristiane Braga e ela ficou sem empresa no Compras; restaurada pelo retrato de base em minutos e o executor passou a devolver o escopo anterior quando a reinserção falha (`9879bf20`). **Falta:** a reabilitação pela planilha (aba "A reabilitar").

**Status anterior (histórico dos passos):**
- **Passo 1 FEITO**: `computeModuleAccess` extraído de `session.ts` para `src/lib/auth/module-access.ts`, usado pela sessão e pelo retrato. Retrato × base = diferença zero.
- **Passo 2 FEITO**: perfis por módulo (`financeiroPerfil`, `comprasPerfil`; Orçamento aceita `construtor_amplo` gravado) = linha gravada em `user_module_roles` ?? o que o `profile` dava. Ligados em: `canAccessPathByProfile` (parâmetro opcional `perfis`; a whitelist do franqueado/CSC passou a ser só do Financeiro), middleware, menu (`nav-links` — item só do Compras sai da whitelist), layout `(app)`, `canAccessBiValidation`, `getCtrlUser().profile`, layout do Compras (tour) e a identidade da API externa. Teste `access-perfis.test.ts` cruza 3.780 combinações perfil × módulos × e-mail × rota exigindo igualdade sem linha gravada. Retrato × base = **diferença zero**; 1037 testes + lint + build verdes. Em produção não existe nenhuma linha `financeiro`/`compras` e todas as do Orçamento são `auto`, então o código novo não tem efeito até a migração do passo 4.
- **Passo 3 — FEITO. Migration `20261026120000_usuarios_modulo_perfil_orcamento_dp.sql` APLICADA em 26/10/2026** (retrato depois × base = diferença zero; espelho OK lendo a tabela nova; 270 = 270 linhas em `user_company_access` × `orcamento_user_empresas`):
  - `orcamento_user_empresas` + backfill com `user_company_access` INTEIRO + gatilho `orcamento_espelha_user_company_access` (espelho TEMPORÁRIO: cobre as 3 rotas que gravam unidades; **remover no passo 5**, senão desfaz a escolha da tela nova). `orcamento_pode_ler_empresa()` lê a tabela nova; `orcamento_has_access()` aceita também o papel gravado (`construtor`/`construtor_amplo`/`validador`).
  - `getOrcamentoUser` lê `orcamento_user_empresas` filtrando pelo próprio id (a policy deixa admin ler tudo, e o "ver como" cai ali com papel rebaixado). Tabela ausente → `user_company_access` (comportamento anterior); outro erro → nenhuma empresa.
  - DP herdado pelo admin: `resolveDpRole(rows, email, isAdmin)` na sessão, middleware e root page; `dp_has_access()` aceita admin ativo; bloqueio da Carol nos dois lados.
  - Travas: `orcamento-rls-espelho.test.ts` (papéis gravados do app ⊂ lista do banco; predicado de empresa lê a tabela do módulo) e a seção [4b] do retrato (alcance do Orçamento = unidades do Financeiro enquanto o espelho vale).
  - Retrato antes e depois da migration × base = diferença zero; espelho OK; 1040 testes + lint + build verdes.
- **Passos 4 e 5 — código FEITO (26/10/2026), virada PENDENTE:**
  - Regras puras em `src/lib/usuarios/acessos.ts` (+ 19 testes): `acessosIniciais` (acesso efetivo de hoje → formulário, com avisos do que muda ao salvar), `validarAcessos`, `planoDeGravacao`, `perfilDeCompatibilidade` (admin → admin; com Compras → o perfil do Compras; só Financeiro → franqueado/csc; SÓ Validação de Contratos → `validador_contrato`, a ilha que `is_contracts_only_user()` reconhece; resto → solicitante com `can_compras=false`). Teste-chave: abrir e salvar sem mexer não muda o acesso.
  - Leitura `carregar-acessos.ts`; executor `gravar-acessos.ts` (escopo → linhas → `users`; registra `dp_concessoes`; valida ids contra o cadastro); rotas `PUT /api/users/[userId]/acessos` (recusa tirar o próprio Admin) e `POST /api/users/acessos`. As rotas antigas ficaram intocadas.
  - Tela `users-acessos-manager.tsx` — PADRÃO em `/usuarios` desde 26/10/2026 (a dona do projeto testou a antiga achando que era a nova: deixar a nova atrás de `?tela=modulos` confundiu). Reserva: `?tela=antiga`, ou env `USUARIOS_TELA_MODULOS=0`.
  - DP: tela de Acessos REMOVIDA (página, client, actions, queries, regras puras e teste); `escopoDp` recorta gestor e analista por `dp_user_empresas`, só admin vê todas; bloqueio da Carol entrou no catálogo de regras especiais (`dp-bloqueado`).
  - Menu: a whitelist da Visão Financeira/CSC não esconde mais Case/Viagens/Compras de quem tem os dois.
  - Validação Relatório: `notifyCscPendingValidation` reconhece a linha `financeiro=csc`; a migration da virada faz o mesmo em `can_validate_bi_reports()`.
  - Script `scripts/usuarios-migrar-perfis.ts` (simula por padrão; `DRY=0` grava pelo mesmo executor da tela). Simulação de 26/10: 69 usuários · 15 mudam (os 14 da planilha, 26 módulos, + Pedro Leo legado → Visão Financeira) · 4 inativos sem acesso pulados · **0 ganhos**. Recusa gravar se houver ganho ou formulário inválido.
  - Retrato do código × base: só `regras_especiais` da Carol (`dp-bloqueado`, esperado). 1052 testes + lint + build verdes.
  - **Checklist da VIRADA (nesta ordem):** (1) deploy do código; (2) aplicar `20261026130000_usuarios_tela_modulos_virada.sql` (tira o gatilho-espelho; `can_validate_bi_reports` lê a linha csc); (3) `npx tsx scripts/usuarios-migrar-perfis.ts` (simular de novo — o cadastro pode ter mudado) e então `DRY=0`; (4) [desnecessário: a tela nova já é a padrão no código]; (5) retrato contra a base: só as reduções da simulação; (6) reabilitar pela planilha.
  - **Antes da virada, não alternar as duas telas no mesmo usuário:** a tela nova grava linhas de perfil por módulo que a antiga não mostra nem limpa.
  - **Gap pré-existente, não tocado (fase 3):** `users.role = 'gestor_hero'` (diretor e contas a pagar) faz `is_hero_manager()` liberar, pelo RLS, a leitura de lançamentos de TODAS as empresas pelo PostgREST, independentemente do módulo Financeiro. O app recorta; o banco não.
- **Ordem dos passos 4 e 5 (decidido ao fechar o passo 3):** a migração dos perfis (passo 4) roda **no mesmo deploy da tela nova** (passo 5), não antes. Motivo: com a tela antiga, reabilitar o Financeiro de quem tem perfil do Compras marca só `can_financeiro`, e sem linha gravada o perfil derivado é `legado` (acesso amplo) — o contrário da decisão 1. A tela nova grava a linha de perfil junto da marca do módulo.
- Root page (`app/page.tsx`) segue calculando à parte de propósito: decide só o pouso (`/home` × `/pendente`), que não depende de perfil, e passa Viagens fixo em `false`.
- **Fica para a fase 3 (registrado, não bloqueia):** quem tiver **CSC gravado** e um perfil do Compras terá `users.profile` = perfil do Compras, e dois leitores ainda olham `profile = 'csc'`: a policy/função `can_validate_bi_reports` no banco e os destinatários do aviso de pendência em `financeiro/relatorios/validation.ts:1091`. A rota e o menu já leem o perfil do módulo. Hoje ninguém é CSC com Compras, então isso não tem efeito agora. Autor: Carol + Claude. Data: 26/10/2026. Continuação de [2026-10-07-ctrl-papel-por-empresa-usuarios.md](2026-10-07-ctrl-papel-por-empresa-usuarios.md), cujo método (aditivo, diff-zero, prova por retrato) este desenho repete.

## 0. Restrição inegociável

> "Todos os dados são muito sensíveis. Os usuários cadastrados hoje já possuem suas permissões e não podemos deixar que eles vejam nada além do permitido. Além disso, temos as regras especiais. Essas também precisam ser mantidas."

Toda mudança de acesso tem de ser **uma das decididas em §2**. Qualquer outra diferença no retrato (§8) bloqueia o passo.

## 1. Problema

Hoje a atribuição é **perfil → módulos**: um `users.profile` único por pessoa, e os módulos são marcados depois. O mesmo perfil decide ao mesmo tempo:

| leitor | o que o perfil decide |
|---|---|
| `session.ts` (`deriveCtrlRoles`, `deriveDreRole`) | papel no Compras e papel legado do Financeiro |
| `auth/orcamento.ts` (`resolveOrcamentoPapel`) | papel no Orçamento (diretor → validador, gerente → construtor amplo, gerente_setor → construtor) |
| `access.ts` (`canAccessPathByProfile`) | rotas; franqueado/csc seguem whitelist do Financeiro |
| banco | `get_ctrl_role()` e as policies do Orçamento leem `users.profile`; `is_admin()` lê `users.role` |
| e-mails | `notifications.ts` e `approval-reminders/recipients.ts` filtram por `users.profile` |

O pedido inverte a ordem: **escolhe-se o módulo, depois o perfil DENTRO do módulo**, com empresa e setor quando o módulo os tem.

## 2. Decisões do dono do projeto (26/10/2026)

| módulo | perfis | empresa | setor |
|---|---|---|---|
| **Admin** | — (acesso a tudo; desabilita os demais) | — | — |
| Financeiro | Visão Financeira · CSC | sim | — |
| Orçamento | Preenchedor (setores) · Preenchedor amplo · Aprovador | sim | sim (quando a empresa orça por setor) |
| Compras | Solicitante · Gerente · Gerente Sócio · Diretor · Contas a Pagar | sim | sim |
| Caixa | — | — | — |
| Case | — | — | — |
| Validação de Contratos | — | — | — |
| Departamento Pessoal | Visão Operacional · Visão Estratégica | sim | — |

1. **Financeiro: todo não-admin vira "Visão Financeira"** (ou CSC, quem já é), inclusive quem hoje é diretor/gerente/contas a pagar/solicitante com Financeiro. O perfil do Compras dessas pessoas fica como está. **É uma redução aceita** — ver §7.1 para quem perde o quê.
2. **Orçamento tem dois preenchedores**: "Preenchedor" = `construtor` (só os setores marcados) e "Preenchedor amplo" = `construtor_amplo` (vê a empresa inteira, edita os seus setores). "Aprovador" = `validador`. Mapeamento 1:1 com os papéis que já existem.
3. **O DP passa a ser concedido pela tela de Usuários, como todo módulo, e o Admin o herda.** A construção de sigilo (sem botão em Usuários, admin não herda, gatilho no banco, concessão só pela tela de Acessos do DP) é **derrubada**. **Fica a regra especial: a Carol, apesar de admin, não acessa o DP.** "Visão Operacional" = `analista`, "Visão Estratégica" = `gestor`.
4. **Empresa (e setor) por MÓDULO, sem lista mestre** (esclarecido em 26/10/2026): cada módulo tem a sua própria lista — X e Y no Financeiro, só X no Compras. Ver §4.
5. **Empresa e setor valem para TODOS os perfis do módulo** que os tem — inclusive Visão Estratégica do DP (que hoje vê todas as empresas) e Preenchedor amplo/Aprovador do Orçamento.
6. **A tela Configurações › Acessos do DP é REMOVIDA de vez.** O único caminho de concessão do DP passa a ser a tela de Usuários.
7. **Migração dos usuários existentes leva SÓ o Compras** para quem tem o Compras e mais algum módulo: fica só com o Compras, e o admin reabilita os demais à mão pela lista de §7.7. **Quem não tem o Compras mantém todos os seus módulos** — tanto quem tem um módulo só quanto quem tem vários (confirmado em 26/10/2026).

Módulos fora da lista do pedido — **VB** (1 pessoa: Marcelo) e **Viagens** (desligado por `VIAGENS_ENABLED`) — ficam **intocados**: não aparecer na tela nova não pode virar perda de acesso.

## 3. Modelo de dados

### 3.1 Perfil por módulo: linhas em `user_module_roles`, sem coluna nova

`user_module_roles` não tem CHECK de `module`/`role` (só o único `(user_id, module, role)`), e a sessão já a lê no mesmo join. Gravar o perfil de cada módulo ali **não exige migration** e não arrisca o 42703 que derruba o `select` da sessão (ver a memória "Migration pendente esvazia a tela inteira").

| módulo | linha | hoje |
|---|---|---|
| Financeiro | `('financeiro', 'visao_financeira' \| 'csc')` | nova |
| Compras | `('compras', '<perfil>')` | nova (chave distinta de `'ctrl'`, que é o fallback legado de `deriveCtrlRoles`) |
| Orçamento | `('orcamento', 'construtor' \| 'construtor_amplo' \| 'validador')` | já existe com `'auto'`; o override já é lido por `papelOverride` — falta aceitar `construtor_amplo` |
| DP | `('dp', 'analista' \| 'gestor')` | já existe |
| Caixa / Contratos | concessão já existente | igual |
| Case | `users.can_case` | igual |

**Valor ausente = regra de hoje.** A resolução (§5) usa a linha explícita quando existe e, senão, deriva do `users.profile` exatamente como hoje. Enquanto ninguém grava linha nova, o sistema é idêntico.

### 3.2 `users.profile` continua existindo, como campo de compatibilidade

Vários leitores do banco e dos e-mails dependem dele (§1). Na fase 1 ele **continua sendo gravado**, com a regra:

- admin → `admin` (e `users.role = 'admin'`, que é o que `is_admin()` lê);
- tem Compras → o perfil do Compras (é o que `get_ctrl_role()`, notificações e lembretes já esperam);
- sem Compras, com Financeiro → `franqueado` ou `csc`;
- só Contratos (sem mais nada) → `validador_contrato` não é mais necessário — Contratos é concessão; a ilha do `validador_contrato` continua valendo para quem já a tem (2 pessoas) até a fase 3.

Exemplo do caso mais comum (os 13 de §7.1): Financeiro = Visão Financeira, Compras = Diretor → `profile = 'diretor'`, `can_financeiro = true`, linha `('financeiro','visao_financeira')`. É **a mesma representação de hoje** + uma linha.

## 4. Empresa por MÓDULO — cada módulo tem a sua lista

Não há lista mestre. Cada módulo guarda as empresas dele, e a tela oferece **todas as empresas ativas** dentro de cada módulo.

| módulo | onde fica a lista | observação |
|---|---|---|
| Financeiro | `user_company_access` (já existe) | É **a fronteira do RLS dos dados financeiros**: `user_has_company_access()` libera lançamentos sem conferir o módulo. Por isso esta tabela passa a ser **só** do Financeiro — nunca gravar nela empresa de outro módulo, senão quem não tem Financeiro passa a ler lançamentos pelo PostgREST. |
| Compras | `ctrl_user_orgs` (já existe) | A escolha é por **org** (Viva, Feat…), que reúne vários CNPJs (`ctrl_org_companies`). Papel por empresa (`role`) continua. |
| Orçamento | **`orcamento_user_empresas` (nova)** | Hoje as empresas do Orçamento SÃO o `user_company_access`. Separar exige a tabela **e** as policies do Orçamento lendo dela. |
| DP | `dp_user_empresas` (já existe) | Passa a valer para os dois perfis (hoje o gestor ignora a tabela e vê todas). |

Por que o retrato importava aqui: **30 usuários ativos têm empresa no Compras que não está no `user_company_access` deles**, e 24 nem têm Financeiro. As listas já são independentes na prática — o desenho só formaliza isso e protege a fronteira do RLS.

**Setores**: Compras = `user_sectors` (setor já é por org); Orçamento = `orcamento_user_setores` (por empresa), habilitado só quando a empresa orça por setor. Ambos valem para todos os perfis do módulo.

## 5. Resolução (uma função pura por módulo)

Mesmo padrão do `resolveCtrlRolesForOrg` de 07/10: **explícito ?? derivado-de-hoje**, extraído para funções puras e testadas, chamadas pela sessão, pelo middleware, pela root page e pelo retrato.

- `resolveFinanceiroPerfil(rows, profile, canFinanceiro)` → `'visao_financeira' | 'csc' | null` (admin à parte). O `access.ts` passa a aplicar a whitelist do franqueado **por esse perfil**, e só às rotas do Financeiro — hoje a whitelist é decidida por `profile === 'franqueado' || 'csc'` e **barra também o `/ctrl`**, o que impediria "Visão Financeira + Diretor no Compras".
- `resolveComprasPerfil(rows, profile, canCompras)` → perfil do Compras; `deriveCtrlRoles` passa a recebê-lo. O override por org (`ctrl_user_orgs.role`) segue por cima, como hoje.
- `resolveOrcamentoPapel` ganha `construtor_amplo` no override. **Ordem atual preservada**: o override vem antes do atalho de admin (é o "ver como").
- `resolveDpRole(rows, email, isAdmin)`: admin → `gestor`, **exceto e-mail bloqueado** (Carol).

**Extração antes de tudo:** a montagem de `loadSessionContext` (session.ts:156-261) vira uma função pura `computeAccess(row)`. Hoje o retrato espelha essa montagem à mão (`scripts/usuarios-retrato-permissoes.ts`); com a extração, o retrato e a sessão passam a usar a MESMA função e o espelho deixa de poder divergir.

## 6. O DP sai do regime sigiloso — o que muda, peça a peça

| peça | hoje | depois |
|---|---|---|
| `resolveDpRole` / sessão / middleware / root page | só concessão; admin não herda | concessão **ou admin**; e-mail bloqueado nunca |
| `dp_has_access()` (RLS) | só `role='gestor'`, nunca Carol | `gestor` **ou admin ativo**, nunca Carol |
| gatilho `dp_guard_module_grant` | só service role escreve `module='dp'` | **mantém** — a tela de Usuários grava pelo service role (como já faz com Contratos/Caixa/Orçamento), então o gatilho não atrapalha e segue barrando escrita direta pelo console |
| tela Configurações › Acessos do DP | único caminho de concessão | **removida de vez** (decisão 6): dois caminhos de concessão divergiriam |
| Visão Estratégica (`gestor`) × empresas | vê todas, ignora `dp_user_empresas` | **recortada** pelas empresas marcadas (decisão 5). As telas do DP leem com admin client e recortam no app — o recorte do gestor entra no mesmo ponto do analista. Admin continua vendo todas. |
| `dp_concessoes` (registro) | gravado pela tela de Acessos | gravado pela rota de Usuários |
| catálogo de regras especiais | o DP ficava de fora por sigilo | **entra** o bloqueio da Carol (`DP_EMAILS_BLOQUEADOS`) — regra nominal nova sempre vai ao catálogo |
| `dp-bloqueio.test.ts` | confere app × banco | continua conferindo |

Efeito no retrato: os 3 admins são Lucas e Marcelo (já gestores do DP) e Carol (bloqueada) → **nenhum acesso muda hoje**. Admin futuro passa a ver o DP automaticamente — consequência aceita da decisão 3.

## 7. Retrato de base (26/10/2026) — quem cada decisão afeta

69 usuários, 65 ativos: 21 franqueado, 15 gerente, 13 solicitante, 5 contas a pagar, 4 diretor, 3 admin, 2 gerente_setor, 2 validador_contrato.

### 7.1 Financeiro → Visão Financeira (decisão 1, redução aceita)
13 pessoas perdem, pela regra de rota, `/conexoes`, as telas de `/financeiro` além de BI e Documentos, e `/s/<segmento>/mapeamento`: Marina Paiva, Larissa Sanabio, Clariane, Marcelo Teste, Marcela de Souza, Jessica Paiva, Pedro Leo, Jéssica Carvalho, Sergio Rocha, Regis, Fernando Sotrate, Vitor, Renato. A Validação Relatório da Marcela é regra nominal decidida antes da whitelist — **mantida**.

### 7.2 Orçamento (decisão 2, sem mudança)
5 não-admins: 2 validador, 2 construtor_amplo, 1 construtor (Luiz Gustavo, sem empresa nem setor — já não alcança nada hoje).

### 7.3 DP (decisão 3)
Concessões: Lucas e Marcelo (gestor). Carol bloqueada. Nenhuma mudança efetiva.

### 7.4 Empresas (decisão 4)
30 ativos com empresa do Compras fora do `user_company_access`; 24 sem Financeiro. É por isso que cada módulo mantém a sua lista e o `user_company_access` fica só do Financeiro (§4).

### 7.7 Migração só do Compras (decisão 7) — quem o admin reabilita à mão
Só quem tem o Compras **e** mais algum módulo perde os demais na migração — os números finais estão na planilha. Quem não tem Compras (23 com um módulo só; Gessika Lacerda, Pedro Leo e Livia Felonta com vários) **mantém tudo**. 22 só têm Compras e não mudam.

Lista completa: `npx tsx scripts/usuarios-lista-permissoes.ts <retrato.json>` → `.json` + `.xlsx` (abas "Usuários hoje", "A reabilitar" com coluna "Feito?", "Legenda"), gravados fora do repositório.

Consequência para o retrato do passo 4 (§8): a diferença esperada passa a ser **só reduções** — as 13 do Financeiro de §7.1 **mais** os 32 módulos de §7.7. Nenhuma linha do retrato pode GANHAR acesso.

### 7.5 Perfil do Compras sem o módulo Compras
Pedro Leo (solicitante; usa Financeiro + Case), Lucas Teste (gerente; usa só Orçamento como construtor amplo), Yuri (contas a pagar; usa só Case). No backfill viram: sem Compras, e o perfil vai para o módulo que usam (Lucas Teste → Orçamento "Preenchedor amplo").

### 7.6 Regras especiais que casam com usuários (todas por e-mail/ID, nenhuma passa pelo perfil)
Régis (alçada restrita + gerente fixo de tipo de despesa), Marcela (Validação Relatório + visão completa do Compras), Marcelo (Validação Relatório + aprovador Case + destaque de diretor), Pedro Leo (aprovador Case + resumo por e-mail), Leonardo (rota direta ao diretor), Vitor (diretor fixo), Teste Controladoria e Larissa Militino (setores extras no relatório). + o bloqueio da Carol no DP.

## 8. Ordem de implantação (cada passo verificável e reversível)

0. **Retrato de base** — feito. `npx tsx scripts/usuarios-retrato-permissoes.ts` grava em `../_retratos/` (fora do repositório: o arquivo tem e-mails e permissões).
1. **Extrair `computeAccess`** de `session.ts` (refactor puro) e trocar o espelho do retrato por ela. Prova: retrato novo × base = **diferença zero**.
2. **Funções de resolução** (§5) com "explícito ?? hoje" + testes travando que, sem linha explícita, o resultado é o de hoje para todos os perfis. Retrato = diferença zero.
3. **Migrations aditivas** (aplicadas pelo SQL Editor — esta máquina não aplica DDL): `orcamento_user_empresas` (+ backfill = `user_company_access` de quem tem Orçamento, + policies do Orçamento lendo dela), `dp_has_access()` com admin. Nenhuma coluna nova em `users`. Retrato = diferença zero (os admins do DP já têm acesso).
4. **Migração dos perfis** por script com `DRY=1` primeiro: grava o perfil do Compras de todos; para quem tem mais de um módulo, **retira** os demais (decisão 7). Retrato = **só reduções**, exatamente as de §7.1 + §7.7. Qualquer ganho de acesso, ou redução fora da lista, para o passo. O admin reabilita pela planilha.
5. **Tela nova** (Admin → módulos → perfil → empresa → setor), atrás de flag. Teste: abrir e salvar um usuário sem mexer = nada muda no retrato. A rota grava as linhas de módulo **e** mantém `users.profile`/`users.role` coerentes (§3.2).
6. **DP pela tela de Usuários**; retirar a tela de Acessos do DP; bloqueio da Carol no catálogo.
7. **Deploy** e retrato pós-deploy contra a base.
8. **Fase 3 (depois, separada):** migrar os leitores de `users.profile` no banco e nos e-mails para os perfis por módulo, e só então aposentar o `profile` como fonte.

Reversão: tudo é acréscimo. Desligar a flag volta à tela antiga; apagar as linhas novas de `user_module_roles` volta à derivação de hoje.

## 9. Pendências do dono do projeto

Todas resolvidas em 26/10/2026: sem lista mestre (empresa por módulo); empresa e setor para todos os perfis; tela de Acessos do DP removida; quem não tem Compras mantém todos os módulos.

## Varredura de acessos pós-virada (26/10/2026, tarde)

Pedido da dona: todo acesso vem da tela de Usuários; no Financeiro, só as empresas definidas nela.
Retrato atual × base da manhã: as diferenças são as reabilitações feitas pela tela. A auditoria
estática cobriu rotas de API, telas, relatórios e as funções SECURITY DEFINER do banco.

Brechas fechadas:

1. **gestor_hero no RLS** (a mais grave). `is_hero_manager()` (users.role='gestor_hero', derivado
   de diretor/contas_a_pagar) lia TODAS as empresas e gravava em financial_entries/sync_log/
   omie_categories de qualquer uma, pela API do Supabase com a própria sessão. 8 pessoas ativas.
   Migration `20261026140000_fim_gestor_hero_rls.sql`: a função passa a `false`, o papel some dos
   cadastros, `users.company_id` (ramo legado das policies) é zerado e `count_unmapped_categories()`
   deixa de responder a não-admin. `papelLegado` nunca mais grava gestor_hero.
2. **Sync / Conexões**: as APIs aceitavam gestor_hero; agora só admin (igual à tela /conexoes).
3. **resolveAllowedCompanyIds** (porta de todas as telas/rotas do Financeiro): sem perfil devolvia
   TODAS; não conferia o módulo; tinha fallback por users.company_id. Agora: admin todas; demais só
   com can_financeiro e só user_company_access. A cópia em cash-flow.ts virou re-export.
4. **Validação de Relatório BI**: CSC e exceções nominais viam, aceitavam, regeravam e enviavam
   relatório de qualquer empresa. Agora tela, rotas e geração da leva respeitam as empresas do
   Financeiro da pessoa (`biValidationCompanyScope`). Hoje não muda ninguém (sem CSC; Marcela tem
   todas).
5. **Histórico de relatórios BI**: o autor continuava abrindo relatório de empresa que perdeu.
6. **Tela antiga de Usuários** removida (`?tela=antiga`): gravava Financeiro "legado" (amplo) e
   gestor_hero. `POST /api/users/invite` responde 410; `PATCH /api/users/[id]` só ativa/desativa.

Mantidos por decisão/desenho: Caixa global (decisão de 17/09/2026); Hero Holding mostra indicadores
das unidades Viva a quem tem a holding; lançamentos roteados por departamento aparecem para quem tem
a empresa de DESTINO; `entry_excluded_by_company_project()` revela só se um projeto é excluído
(configuração, sem valores). Testes: `src/lib/auth/fronteira-financeiro.test.ts`.
