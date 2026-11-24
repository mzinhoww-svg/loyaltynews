# Adaptador OpenBot: ativação em staging e roteiro do piloto de 10 matérias
Estado: **pronto para o staging, desligado** (22–23/11; **a DP-41 de 23/11 substitui as rotas com OpenCode e Antigravity abaixo: ver §0**). Nada foi ativado, criado ou chamado: nenhum agente no OpenBot, nenhuma rota no ar, nenhuma flag ligada, nenhuma chamada de modelo. Dono: Integration. Combinado com o AgentOps (kit em `packages/agents`: `pilot-protocol.md`, `pilot.ts`) e com o desenho do Chief Architect (`fast-track/custo/piloto-10-materias-openbot.md`). Ligar qualquer coisa abaixo exige o OK do PM, depois do parecer do QA.

## 0. Checklist de ativação do piloto no staging (DP-41) — estado de 23/11/2026
Base conferida: **ft/backend 1173425 + 59eed1b** (o 423 Locked vale desde a `0a2e2c8` e o `pull` conferir a assinatura antes do 423, desde a `59eed1b`; rotas `/api/openbot`, `PgTaskIo`, fila com lease, flag DP-41 de Backend 2 `467ba9e`), **ft/growth** (este adaptador), **ft/agents f32358f** (kit do piloto do AgentOps). Prova: `apps/web/app/api/openbot/staging-dryrun.test.ts` (ver §0.4). **Nada foi ativado, criado nem chamado**: nenhum OpenBot, modelo, rede ou mLabs; agentes de mentira em processo.

### 0.1 O que a DP-41 exige e como o código a cumpre
| Exigência (proprietário, 23/11) | Como é cumprida | Prova |
|---|---|---|
| `openbotDispatch` só no **staging** | `FLAG_RELEASES.openbotDispatch = { staging: 'DP-41', production: null }`; liga só com `APP_ENV=staging` **e** `LN_FLAGS_ON=openbotDispatch`; em produção a subida é recusada ("sem decisão para production") | ensaio §1 |
| Piloto só em staging | `APP_ENV=staging` **e** `LN_OPENBOT_PILOT=1`; sem uma das duas, o piloto não existe | ensaio §1 |
| Só as assinaturas pagas: **Claude e Codex** | `DP41_ACCOUNTS`: rotas sem `opencode`/`antigravity`; despacho com outra conta = 422 `ROUTE_INVALID`; `pull` de outra conta = 422 `ACCOUNT_OUT_OF_ROUTE` + linha de violação + **piloto parado** | `pilot.test.ts` (bloco DP-41), ensaio §3/§4 |
| Pauta só claude; checagem e revisão **só codex, sem reserva**; redação só claude | no limite da codex a tarefa fica pendente (`nextAccount: null`) e só a codex retoma depois da janela | `pilot.test.ts` |
| Sem API tarifada | lane `api` ou custo > 0 no piloto = parada imediata `api_tarifada` | ensaio §3 |
| Sem publicação | `create_post`/`publish` nunca são despachados; a tentativa para o piloto (`tentativa_de_publicar`) | ensaio §4 |
| Tudo em rascunho para leitura do editor-chefe | o adaptador só move texto por IDs; a leitura é da Editorial/Studio (item 9 abaixo) | — |

### 0.2 O que falta, quem faz e o que já está provado
| # | Pendência | Dono | Situação |
|---|---|---|---|
| 1 | **Integrar a ft/agents (≥ f32358f) na ft/backend.** A rota do Backend procura `canDispatchNext` na raiz de `@ln/agents`; antes do `f32358f` o índice não exportava o piloto e o piloto **falhava fechado** (**423** `PILOT_STOPPED`, "canDispatchNext indisponível"). O AgentOps já exporta (`export * from './pilot'`). Há 1 erro de tipo na ft/agents (`qualification.ts:314`, `number \| undefined`) a conferir | Backend 1 / DevOps (int) | **bloqueia** |
| 2 | **`PgTaskIo` guardar e devolver `meta.articleId`** (3 linhas em `apps/workers/src/openbot-pg.ts`: gravar em `meta` e tipar `getInputFor`; `meta` já é JSONB, **sem migração**). Sem isso cada etapa vira uma "matéria" na planilha (cada etapa tem refId próprio) e a prova de independência não encontra o redator. O adaptador (ft/growth ≥ `80fdcb2`) já deriva o id da chave da Editorial `<articleId>:<etapa>:<tentativa>`, leva em `meta`, e o agente o devolve em `trace.articleId` | **Backend 1** | **bloqueia** (diff provado no ensaio) |
| 3 | **Ligar o `OpenBotModelGateway` na Fábrica.** Hoje a Fábrica (`apps/workers/src/editorial-factory.ts`) só usa o gateway de modelops (`createModelopsTransport`); nada instancia `OpenBotModelGateway`. Falta uma opção de fiação (`openbotGateway`) escolhida quando o piloto está ligado, com os mesmos stores PostgreSQL e o gate | Editorial + Backend | **bloqueia** |
| 4 | **Quem grava o veredito na linha.** `canDispatchNext` exige `gate_verdict` e `reviewed_draft_task_id` em toda linha concluída de checagem/revisão; ninguém chama `PgPilotRowStore.patch`. Fluxo proposto: ao fim do gate da Editorial, `applyRowPatch(row, {gate_verdict, gate_reasons, cross_provider_ok, unsupported_facts…})` (AgentOps, recusa campo de medição do adaptador) e depois `rows.patch(task_id, attempt, patch)`. Até lá a linha fica **pendente** (não para o despacho) e a avaliação final do piloto não fecha | Editorial (+ AgentOps `unsupported_facts` da folha de leitura) | **bloqueia a avaliação**, não o despacho |
| 5 | **Contrato de variáveis da Vertra.** `infra/vertra/env-contract.json` não lista `OPENBOT_HMAC_SECRET` (+`_PREVIOUS`), `LN_FLAGS_ON`, `LN_OPENBOT_PILOT` (nem `MLABS_MCP_TOKEN`, `MLABS_MCP_URL`, `MLABS_PROFILE_ID`, `MLABS_CHANNEL_ID`). Declarar como **somente staging** (as do piloto) e confirmar que o `guard-env` recusa `LN_FLAGS_ON` com `openbotDispatch` e `LN_OPENBOT_PILOT` em produção | DevOps | pendente |
| 6 | **Segredo HMAC** no cofre (atual e anterior), nunca no chat; staging com PostgreSQL | Proprietário / DevOps | **não criado** |
| 7 | **Agentes do OpenBot** (claude para pauta/redação/social/entidades; codex para checagem/revisão), cada um com uma via, prompt `editorial-0.3`, assinando o HMAC e mandando `x-ln-signature`/`x-ln-timestamp`. **Não verificado** que o OpenBot real consegue chamar um endpoint HTTP customizado com esses cabeçalhos e corpo; é o maior risco aberto (o ensaio usa agentes de mentira) | AgentOps (com OK do PM) + Integration (ensaio sem modelo no staging) | **bloqueia**, risco de plataforma |
| 8 | **Retomar o piloto depois de uma parada.** `resumePilot` existe (permissão `openbot:pilot_admin`, só com o gate aceitando), mas **não há rota nem comando** que o chame; uma parada exigiria mexer no banco | Backend (comando/rota admin) | pendente |
| 9 | **Onde o editor-chefe lê** (rascunho, evidências, planilha) e **como se exporta** a planilha (`pilotCsv`; colunas idênticas às do AgentOps, provado) | Studio / PM | decisão |
| 10 | Fontes habilitadas, revisão (QA 2 deste conjunto), integração e ok do PM para ligar | PM / QA 2 / DevOps | a cargo do PM |
| 11 | Repetir **no staging real** o teste do kill switch (§5) e o ensaio sem modelo (uma tarefa respondida por agente de mentira) | Integration + DevOps | só depois de 1–7 |
| 12 | Modelo da pauta (Haiku, backup Sonnet **na mesma conta**) é configuração do agente OpenBot; o adaptador só vê conta e modelo declarado (o kit valida "haiku ou sonnet") | AgentOps | — |

**Atualização (23/11, tarde) — o que mudou nas pendências acima:**
- **Itens 1, 2 e 8: feitos pelo Backend** (ft/backend `cb9e0dd`): ft/agents integrada (gate no índice de `@ln/agents`), `PgTaskIo` com `meta.articleId`, e a rota Studio `POST /api/studio/openbot/pilot/resume` (só admin, auditada, só limpa a parada se o `canDispatchNext` aceita).
- **Itens 3 e 4: peças prontas, falta a ligação final.** Editorial (ft/editorial `8262175`): `modelGateway`, `pilotSink` e `loadPilotWiring` na Fábrica, `reviewedDraftTaskId` com o id da TAREFA, veredito e `output_valid` pelo sink. Integration (ft/growth `d0d0de1`): o gateway devolve `taskId`/`attempt` e espera o custo e a linha do piloto; `apps/workers/src/openbot-wiring.ts` (`createPilotWiring(env, db)` e `pilotWiringImporter(db)`) monta o gateway e o sink sobre as mesmas tabelas das rotas, com o gate e o `applyRowPatch` reais, só staging, falha fechada. **Falta:** o `main` da Fábrica chamar `loadPilotWiring(process.env, pilotWiringImporter(db))` (uma linha; Editorial/Backend) e **unificar** a opção `openbotGateway` do Backend com a `modelGateway` da Editorial (mesmo papel no mesmo arquivo; ficar com a da Editorial, que leva o sink do veredito).
- **Continuam abertos:** 5 (contrato de variáveis da Vertra: DevOps), 6 (segredo HMAC), 7 (agentes do OpenBot; risco de plataforma), 9 (onde o editor-chefe lê), 10 e 11 (revisão, ensaio no staging real). `unsupported_facts/high/medium/low` vêm da leitura humana (API da Editorial em `docs/piloto-leitura-api.md`), não da Fábrica.

### 0.3 Ordem de ativação (cada passo reversível; só avança com evidência do anterior)
1. Itens 1, 2, 3 e 5 integrados (código e contrato de variáveis), `npm test` e o ensaio §0.4 verdes na ft/backend integrada.
2. Item 6: segredo no cofre. Staging com `APP_ENV=staging`, `OPENBOT_HMAC_SECRET`, **sem** `LN_FLAGS_ON` e **sem** `LN_OPENBOT_PILOT` (tudo desligado): conferir `/api/health` sem flags ligadas.
3. Item 7: agentes criados (OK do PM), cada um provado com uma tarefa de mentira **antes** de ligar o despacho.
4. Ligar, nesta ordem: `LN_OPENBOT_PILOT=1`, depois `LN_FLAGS_ON=openbotDispatch` (a subida registra "flags ligadas: openbotDispatch (DP-41, staging)"). Reversão imediata: remover `LN_FLAGS_ON` (pull **423** `DISPATCH_OFF` para quem assina corretamente; sem segredo ou com assinatura errada o pull dá 401) ou acionar o kill switch (`route:openbot` → **423** `KILL_SWITCH` no pull, no heartbeat e no io; o callback em curso ainda é aceito).
5. Item 11 (kill switch e ensaio no staging real), depois as 10 matérias, sem publicar; item 4 gravando os vereditos; item 8 pronto para uma parada.

### 0.4 O ensaio ponta a ponta (sem disparar nada)
`npx vitest run apps/web/app/api/openbot/staging-dryrun.test.ts` (PGlite; sem rede). Usa a configuração de staging pelo código real (`resolveFlags`, `pilotEnabled`), as rotas reais, a Fábrica (`OpenBotModelGateway` + `PgTaskIo`), o **gate real** `canDispatchNext` e agentes falsos (`FakeOpenBot`). Cobre: flag só no staging com a DP-41 (produção recusa); nada disparado com a flag ligada; flag desligada = **423** `DISPATCH_OFF` (com assinatura válida); sem segredo = 401; o gate de `@ln/agents` ao alcance da rota (ou falha fechada, com o motivo); ciclo de uma matéria (pauta, redação, checagem e revisão independentes, social, entidades) só com claude e codex, custo 0, uma linha por execução, 2 matérias contadas; linhas pendentes do veredito sem parar o piloto e liberadas depois do `applyRowPatch` oficial; colunas da planilha idênticas às do AgentOps; paradas (API tarifada); conta fora da DP-41, publicação e kill switch. **Resultado em 23/11:** na árvore integrada (ft/backend + ft/growth `80fdcb2` + ft/agents `f32358f` + a mudança do item 2) **11/11 passam**; na ft/growth sozinha (sem o gate) 5 passam e **6 ficam "puladas"** (nunca como aprovadas).
**O que o ensaio NÃO prova:** o OpenBot real (cabeçalhos assinados, limites das contas, texto e hora de retomada), nenhum modelo, o comportamento sob carga, o PostgreSQL 18 do staging real (rodou em PGlite), nem as pendências 5–12.

---

## 1. O que existe e está testado (offline)
| Peça | Onde | Prova |
|---|---|---|
| Pull com lease, heartbeat, callback HMAC idempotente | `src/handlers.ts`, `src/signing.ts`, `src/lease-queue.ts` | `handlers.test`, `signing-and-queue.test` |
| Faixas de custo: `api`, `subscription` (Claude/Codex), `opencode`, `antigravity`; custo 0, sem geração obrigatória | `src/costs.ts` | `lanes-and-routes.test` |
| Tipos `editorial_review` e `social_copy` (texto, nunca publicação) | `src/types.ts` | idem |
| **Rotas de contas e troca de via no limite** (pauta: opencode→claude→antigravity; checagem e revisão: codex→antigravity; **redação nunca troca**) | `src/types.ts` (`DEFAULT_ROUTES`), `src/lease-queue.ts`, `src/handlers.ts` | `lanes-and-routes.test`, `pilot.test` |
| Trilha do piloto (uma linha por execução), planilha CSV, parada imediata, gate `canDispatchNext` | `src/pilot.ts`, `src/handlers.ts` | `pilot.test` |
| **Gateway síncrono** para o `ModelGateway.invoke` da Editorial (despacha, espera o callback, `pending` no tempo-limite) | `src/gateway.ts` | `gateway-and-routes.test` (compatível com o tipo real da Editorial) |
| Cola HTTP (`POST /api/openbot/pull|heartbeat|callback`) e flag `openbotDispatch` do contrato | `src/routes.ts` | idem |
| Dedupe de `callbackId` e saúde em Redis | `src/redis-stores.ts` | `redis.integration.test` (Redis real, local) |

## 2. Pré-condições do piloto (as do Chief Architect) e situação
| # | Pré-condição | Dono | Situação |
|---|---|---|---|
| 1 | Adaptador com as rotas `pull|heartbeat|callback`, fila e ledger **reais**, homologado | Integration (código) + Backend (rotas e tabelas) | Código e handlers prontos. **Faltam:** rotas em `apps/web`, tabelas (fila com `FOR UPDATE SKIP LOCKED`, ledger, linhas do piloto, estado do piloto, `callbackId`), homologação do QA |
| 2 | Flag `openbotDispatch` ligada **só no staging**, kill switch testado | Proprietário (decisão registrada), DevOps | Flag existe no contrato, **desligada**. Roteiro do teste do kill switch: §5 |
| 3 | Modo `qualification` homologado (ADR-021) | Backend + FinOps | Fora deste pacote |
| 4 | Política v7 (DP-27) no contrato | Chief Architect | Fora deste pacote |
| 5 | Agentes OpenBot (redator, checador, extrator, pauta) configurados, prompts versionados | AgentOps, **só com OK do PM** | Rascunho em `pilot-agents.draft.json`; nada criado |
| 6 | Complemento OpenRouter **desligado** | DevOps/FinOps | O adaptador trata faixa `api` no piloto como **parada imediata** (§6) |
| + | Armazém do conteúdo (`TaskIo`/`PgTaskIo`) e as rotas `io/input` e `io/result` do agente (contrato em `PROTOCOL.md`, combinado com o Backend) | Backend | Em implementação pelo Backend (informado por ele); a fila PostgreSQL deve passar `@ln/openbot/testing` |
| + | Segredo HMAC no cofre (atual e anterior) | Proprietário/DevOps | **Não criado.** O adaptador recebe os segredos por `deps.secrets()`; nenhum valor foi gerado ou gravado |

## 3. Etapas, vias e rotas do piloto (DP-41: só Claude e Codex)
| Etapa (AgentOps) | Tipo no adaptador | Via no piloto | Troca no limite? |
|---|---|---|---|
| `triage` (pauta) | `classification` | **claude** (Haiku; backup Sonnet **na mesma conta**) | não (via única) |
| `draft` (redação) | `editorial_draft` | **claude** | **nunca**: espera a janela e a mesma via retoma |
| `factcheck` | `fact_check` | **codex**, sem reserva | não: no limite fica pendente e a codex retoma depois da janela |
| `review` | `editorial_review` | **codex**, sem reserva | idem |
| `social_pack` (rascunho de LinkedIn) | `social_copy` | **claude** | não |
| `roles` (entidades) | `entity_resolution` | **claude** | não |
| `rights_seo_qa` | determinística, **fora do OpenBot** | — | — |

Regras impostas pelo código: com o piloto ativo as rotas padrão perdem `opencode` e `antigravity` (`DP41_ACCOUNTS`; `PilotControl.allowedAccounts` só pode estreitar); a rota só pode ser **restringida** no despacho (nunca ampliada); despacho com conta fora da DP-41 = 422 `ROUTE_INVALID`; `pull` de outra conta = 422 `ACCOUNT_OUT_OF_ROUTE`, linha de violação e **piloto parado**; executar por uma via diferente da atribuída é recusado (422) e **para o piloto**; o limite **não consome tentativa**. **Sem API e sem fallback fora da rota.** As lanes `opencode` e `antigravity` continuam no código **fora do piloto** (rotas padrão sem piloto: pauta opencode→claude→antigravity; checagem e revisão codex→antigravity).

## 4. Roteiro de ativação (cada passo reversível; só avança com evidência do anterior)
1. **Backend:** tabelas e rotas (`createOpenBotRoutes(deps)`), `RedisCallbackStore` e `RedisHealthStore`, `TaskIo`. Rotas **não registram IP, cabeçalhos nem corpo**.
2. **DevOps:** segredo HMAC no cofre (atual + anterior), staging com Postgres e Redis; confirmar que o proxy não loga corpo nem cabeçalhos de assinatura.
3. **QA:** homologar o adaptador (parecer) com os testes deste pacote contra o Postgres e o Redis do staging.
4. **Proprietário/PM:** decisão registrada para ligar `openbotDispatch` **só no staging** (`openbotFlagsFrom({ overrides: { openbotDispatch: true } })` em código de staging; produção nunca). Piloto: `pilot: { enabled: true, rows, state, gate: canDispatchNext }`.
5. **AgentOps (com OK do PM):** criar os 3 a 5 agentes, cada um com **uma via** e o prompt `editorial-0.2` fixado por commit; agente puxa com `account` da sua via.
6. **Teste do kill switch** (§5) e **ensaio sem modelo** (uma tarefa de teste respondida por um agente de mentira, para exercitar pull→callback→linha).
7. **Piloto das 10 matérias** (§7) sem publicar.
8. Resultado ao Chief Architect (decide redesenho de custo). **Reversão a qualquer momento:** desligar `openbotDispatch` (despacho 409 e novas entregas param) ou acionar o kill switch (**423** `KILL_SWITCH` no `pull`, no `heartbeat`, no `io` e no despacho da Fábrica; só o callback segue aceito, para fechar e registrar o que já foi gasto).

## 5. Teste do kill switch (registrar o resultado)
Com o piloto ligado e uma tarefa pendente: (1) acionar o kill → `pull`, `heartbeat`, `io/input`, `io/result` e o despacho respondem **423 `KILL_SWITCH`** (Locked, com o JSON; a borda da Vertra troca o corpo de 502/503/504 por HTML, por isso não é 503) e nada é entregue; (2) o callback de tarefa em andamento ainda é aceito (para registrar); (3) desligar o kill → o `pull` volta a entregar; (4) o kill **prevalece** sobre a flag (`openbotFlagsFrom({ overrides: { openbotDispatch: true }, kill: true })` dá `dispatchEnabled: false`). Coberto por teste unitário; **falta repetir no staging real**.

## 6. Parada imediata (uma linha da planilha marca e o piloto para)
| Condição | Quem detecta | Efeito | Retomar |
|---|---|---|---|
| Tentativa de despachar publicação (`create_post`, `publish`…) | despacho (422) | linha `violation-N` com `published_attempt`; piloto parado | `resumePilot` (admin) com o gate aceitando |
| Chamada à API tarifada (faixa `api` ou custo > 0) | callback | linha com `tarifada_api_call`; parado | idem |
| Segredo em texto (erro, mensagem de limite, notas) | callback | texto mascarado; `secret_in_log`; parado | idem |
| Ferramenta fora do contrato (relatada pelo OpenBot) | callback | `tool_outside_contract`; parado | idem |
| Conta fora da rota | callback (422) | linha de violação; parado | idem |
| `canDispatchNext` do AgentOps recusa as linhas | pull, heartbeat, io, despacho | **423** `PILOT_STOPPED`; parado | corrigir a linha e `resumePilot` |
Limite do que o adaptador **consegue** detectar: ferramenta fora do contrato e segredo só aparecem se o agente do OpenBot **relatar** ou escrever no texto que passa por aqui; o log do próprio OpenBot não é visível ao adaptador. O QA confere o resto (nada publicado, nenhuma chamada tarifada).

## 7. Piloto: o que cada parte faz
- **Fluxo por matéria:** pauta → redação (Claude) → checagem e revisão (Codex: `fact_check` e `editorial_review`; a chamada única `check_edit` saiu do roteiro por decisão do PM) → entidades e texto social (Claude) → gates determinísticos (fora do OpenBot). Fábrica: `OpenBotModelGateway` no lugar do gateway de modelops; `idempotencyKey` por etapa.
- **Cada callback do agente** envia `trace` (`stage`, `account`, `startedAt`, `endedAt`, `packetChars`, `limit` se bateu, `reviewedDraftTaskId` nas etapas de checagem e revisão (sem ele a independência não se prova), `promptVersion`, `sourceId`, `outputValid`, `toolOutsideContract`) e `usage` na faixa gratuita (`lane`, `account`, `model` declarado, `costMicro: 0`).
- **Planilha:** o adaptador preenche `task_id, kind, article_id, source_id, stage, account, declared_model, prompt_version, started_at, ended_at, attempt, reviewed_draft_task_id, outcome, limit_*, account_resumed_at` (a retomada observada é marcada quando a mesma conta volta a concluir), `packet_chars`, `tokens_measured` (sempre `false`), `output_valid` e os quatro sinalizadores. **Editorial/AgentOps completam por `patch`:** `gate_verdict`, `gate_reasons`, `cross_provider_ok`, `unsupported_facts`. Exportação: `pilotCsv(rows)` (colunas do AgentOps, na ordem; célula protegida contra fórmula).
- **Independência:** `adapterReport(rows)` compara autor e checador pelo **modelo declarado** (não pela conta), porque a via Antigravity hospeda modelos de várias famílias (um Claude via Antigravity **não** é independente de um redator Claude). O `OpenBotModelGateway` confere o mesmo na resposta.
- **Tokens:** o OpenBot não os expõe; `tokens_measured` fica `false` e o tamanho do pacote em caracteres é o substituto.

## 8. O que o OpenBot desta máquina mostra hoje (leitura de `list_models`, 23/11/2026)
Provedores conectados com uma conta `default` cada: `claude`, `codex`, `antigravity`; `opencode` com modelos gratuitos (inclui `opencode/deepseek-v4.1-flash-free`); `deepseek` e `openrouter` existem (tarifados: **desligados no piloto**). Isto confirma que a via existe, **não** que o limite grátis do OpenCode esteja disponível agora (o PM informou que esgotou hoje), nem que contas de produto e de implementação estejam separadas (há uma conta por provedor: premissa e risco aceito, DP-30).

## 9. Não verificado
Os cabeçalhos assinados e o corpo do callback a partir de um agente OpenBot real; se o OpenBot informa o texto e a hora de retomada do limite; o id exato do modelo por conta (vem declarado no custo); comportamento do pull sob carga; tabelas e rotas reais; limites de uso das assinaturas e do OpenCode; separação de contas de produto e implementação. **Nada foi chamado no OpenBot, no mLabs ou em modelo.**
