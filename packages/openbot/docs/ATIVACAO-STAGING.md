# Adaptador OpenBot: ativação em staging e roteiro do piloto de 10 matérias
Estado: **pronto para o staging, desligado.** Nada foi ativado, criado ou chamado: nenhum agente no OpenBot, nenhuma rota no ar, nenhuma flag ligada, nenhuma chamada de modelo. Dono: Integration. Combinado com o AgentOps (kit em `packages/agents`: `pilot-protocol.md`, `pilot.ts`) e com o desenho do Chief Architect (`fast-track/custo/piloto-10-materias-openbot.md`). Ligar qualquer coisa abaixo exige o OK do PM, depois do parecer do QA.

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

## 3. Etapas, vias e rotas do piloto
| Etapa (AgentOps) | Tipo no adaptador | Via preferida → backups | Troca no limite? |
|---|---|---|---|
| `triage` (pauta) | `classification` | opencode → claude → antigravity | sim |
| `draft` (redação) | `editorial_draft` | claude | **nunca**: espera a janela e a mesma via retoma |
| `factcheck` | `fact_check` | codex → antigravity | sim |
| `review` | `editorial_review` | codex → antigravity | sim |
| `social_pack` (rascunho de LinkedIn) | `social_copy` | claude | não (via única) |
| `roles` (entidades) | `entity_resolution` | claude | não (via única) |
| `rights_seo_qa` | determinística, **fora do OpenBot** | — | — |

Regras impostas pelo código: a rota só pode ser **restringida** no despacho (nunca ampliada); redação tem uma só via; cada via só recebe tarefas cuja via atual é a dela (`pull` exige `account` no piloto); executar por uma via diferente da atribuída é recusado (422) e **para o piloto**; o limite **não consome tentativa**; esgotadas todas as vias, a tarefa espera a janela (a retomada informada ou 30 min) e recomeça pela via preferida. **Sem API e sem fallback fora da rota.** A conta usada fica na linha (`account`, `declared_model`).

## 4. Roteiro de ativação (cada passo reversível; só avança com evidência do anterior)
1. **Backend:** tabelas e rotas (`createOpenBotRoutes(deps)`), `RedisCallbackStore` e `RedisHealthStore`, `TaskIo`. Rotas **não registram IP, cabeçalhos nem corpo**.
2. **DevOps:** segredo HMAC no cofre (atual + anterior), staging com Postgres e Redis; confirmar que o proxy não loga corpo nem cabeçalhos de assinatura.
3. **QA:** homologar o adaptador (parecer) com os testes deste pacote contra o Postgres e o Redis do staging.
4. **Proprietário/PM:** decisão registrada para ligar `openbotDispatch` **só no staging** (`openbotFlagsFrom({ overrides: { openbotDispatch: true } })` em código de staging; produção nunca). Piloto: `pilot: { enabled: true, rows, state, gate: canDispatchNext }`.
5. **AgentOps (com OK do PM):** criar os 3 a 5 agentes, cada um com **uma via** e o prompt `editorial-0.2` fixado por commit; agente puxa com `account` da sua via.
6. **Teste do kill switch** (§5) e **ensaio sem modelo** (uma tarefa de teste respondida por um agente de mentira, para exercitar pull→callback→linha).
7. **Piloto das 10 matérias** (§7) sem publicar.
8. Resultado ao Chief Architect (decide redesenho de custo). **Reversão a qualquer momento:** desligar `openbotDispatch` (despacho 409 e novas entregas param) ou acionar o kill switch (503 em tudo).

## 5. Teste do kill switch (registrar o resultado)
Com o piloto ligado e uma tarefa pendente: (1) acionar o kill → `pull`, `heartbeat` e despacho respondem **503 `KILL_SWITCH`** e nada é entregue; (2) o callback de tarefa em andamento ainda é aceito (para registrar); (3) desligar o kill → o `pull` volta a entregar; (4) o kill **prevalece** sobre a flag (`openbotFlagsFrom({ overrides: { openbotDispatch: true }, kill: true })` dá `dispatchEnabled: false`). Coberto por teste unitário; **falta repetir no staging real**.

## 6. Parada imediata (uma linha da planilha marca e o piloto para)
| Condição | Quem detecta | Efeito | Retomar |
|---|---|---|---|
| Tentativa de despachar publicação (`create_post`, `publish`…) | despacho (422) | linha `violation-N` com `published_attempt`; piloto parado | `resumePilot` (admin) com o gate aceitando |
| Chamada à API tarifada (faixa `api` ou custo > 0) | callback | linha com `tarifada_api_call`; parado | idem |
| Segredo em texto (erro, mensagem de limite, notas) | callback | texto mascarado; `secret_in_log`; parado | idem |
| Ferramenta fora do contrato (relatada pelo OpenBot) | callback | `tool_outside_contract`; parado | idem |
| Conta fora da rota | callback (422) | linha de violação; parado | idem |
| `canDispatchNext` do AgentOps recusa as linhas | pull, heartbeat, despacho | 503; parado | corrigir a linha e `resumePilot` |
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
