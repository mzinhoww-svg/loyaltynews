# Protocolo do adaptador OpenBot (proposta, ADR-003)
Estado: **proposta do adaptador, não validada contra o OpenBot de produção** (R2-10). Nada foi chamado.

## Princípios
1. **Pull, só saída:** o OpenBot chama o LN (HTTP assinado). O LN nunca abre conexão para o OpenBot e não expõe nenhuma porta nova.
2. **Só IDs no fio:** a tarefa entregue tem `id`, `kind`, `profileId`, `refId`, `dataClass`, `maxCostMicro`, `attempt`, `leaseId`, `leaseExpiresAt`. O agente lê e grava o conteúdo pelas APIs do LN (autenticadas), nunca pela fila. O resultado volta como `resultRef` (id), não como texto.
3. **Publicação fora do OpenBot:** tipos `social_publish`, `publish`, `create_post`, `creative_composition` e `source_ingestion` nunca são despachados. Quem publica é o `publisher_social` determinista.
4. **Falha fechada:** sem segredo, assinatura inválida, kill switch, flag desligada ou orçamento esgotado ⇒ nada é entregue nem despachado.

## Assinatura
Cabeçalhos: `x-ln-timestamp` (ms desde a época) e `x-ln-signature: v1=<hex>`, com `hex = HMAC_SHA256(segredo, "<timestamp>.<corpo cru>")`. Janela de ±5 min. O LN aceita uma lista de segredos (atual primeiro, anteriores para rotação). Segredo só no cofre; os handlers o recebem por `deps.secrets()`.

## Endpoints (a ligar em `apps/web/app/api`, dono: Backend)
| Rota | Handler | Corpo (JSON) | Resposta |
|---|---|---|---|
| `POST /api/openbot/pull` | `handlePull` | `{workerId, limit?(1–10), kinds?}` | `{tasks:[LeasedTask], leaseMs, serverTime}` |
| `POST /api/openbot/heartbeat` | `handleHeartbeat` | `{taskId, leaseId}` | `{leaseExpiresAt}` |
| `POST /api/openbot/callback` | `handleCallback` | `{callbackId, taskId, leaseId, outcome:'completed'\|'failed', resultRef?, error?, retryable?, usage?}` | `{duplicate, task?, costRecorded, overrun, budget, pauseModelCalls}` |
| (interno) | `dispatchTask` | `{kind, profileId, refId, idempotencyKey, dataClass, maxCostMicro, maxAttempts?}` | `{created, task}` (201/200) |
| (interno) | `getOpenBotStatus` | — | saúde, fila, custo, flags |

Códigos de erro (envelope `ApiError` de `@ln/contracts`): `UNAUTHORIZED` 401, `VALIDATION_ERROR` 400, `LEASE_ERROR` 404/409, `USAGE_INVALID` 422, `USAGE_MISMATCH` 422, `KILL_SWITCH` 423, `DISPATCH_OFF` 409, `KIND_FORBIDDEN`/`KIND_UNKNOWN`/`DATA_CLASS_BLOCKED`/`COST_CAP_EXCEEDS_BUDGET` 422, `BUDGET_EXHAUSTED` 409, `FORBIDDEN` 403.

## Ciclo da tarefa
`pending → leased → completed` (ou `failed` se não retentável; `pending` de novo se retentável; `dead` ao esgotar tentativas). Lease expirado volta a ser puxável (outra tentativa; o antigo detentor perde o lease). `complete` com o mesmo lease é idempotente. O `callbackId` já visto devolve 200 `duplicate` sem efeito; callback recusado por validação **não** consome o `callbackId`.

## Custos
Cada execução relata `UsageReport` (`executionId`, `taskId`, `leaseId`, `model`, `generationIds[]`, tokens, `costMicro` inteiro). Custo ausente/desconhecido ⇒ 422 (bloqueio por preço desconhecido). Dedupe por `executionId`. `overrun` quando o custo passa de `maxCostMicro`; `pauseModelCalls` quando o gasto passa do teto mensal (US$ 50 = 50.000.000 micro; o valor oficial é do modelops). Conciliação: `reconcile(reports, entradasDoGateway)` por `generationId`.

## Falha do OpenBot
Se o OpenBot para de puxar (> 3 min), `evaluateHealth` devolve `atrasado`: os workers próprios de reserva assumem a fila (podem usar `kinds`) e a publicação pausa (falha fechada).

## Não verificado (do ADR-003 e deste adaptador)
Endpoint customizado por agente no OpenBot; métrica de uso por execução; relay de webhook; se o OpenBot consegue enviar os cabeçalhos de assinatura e o corpo no formato acima; retenção da tabela de `callbackId`.

## Atualização de 23/11/2026 (piloto de 10 matérias)
- **`pull`** aceita `account` (`claude|codex|opencode|antigravity`): a via só recebe tarefas cuja via atual é a dela. **No piloto é obrigatório.** O lease devolvido traz `account`.
- **Rotas de contas** por tipo (`DEFAULT_ROUTES`): pauta opencode→claude→antigravity; checagem e revisão codex→antigravity; redação só claude. O despacho aceita `route` apenas para **restringir** a rota padrão. No `callback`, `trace.limit` (a conta bateu o limite) passa a tarefa à próxima via (o limite não conta como tentativa); na última via, ou na redação, espera a janela e recomeça pela preferida. `nextAccount` na resposta diz quem puxa agora (`null` = espera).
- **`usage`** ganha `lane` (`api|subscription|opencode|antigravity`) e `account`. Nas faixas gratuitas: `costMicro` exatamente 0, sem `generationIds` e tokens opcionais (omitidos = não medidos). Custo > 0 numa faixa gratuita é recusado.
- **`callback`** ganha `trace` (`stage`, `account`, `startedAt`, `endedAt`, `packetChars`, `limit{message,at,resumeAt?}`, `reviewedDraftTaskId`, `promptVersion`, `sourceId`, `outputValid`, `toolOutsideContract`, `notes`) e `retryAfterSeconds`. A conta de `trace` e a do `usage` têm de coincidir (422 `TRACE_MISMATCH`) e ser a da via atribuída (422 `ACCOUNT_OUT_OF_ROUTE`). No piloto a trilha é obrigatória (422 `TRACE_REQUIRED`).
- **Piloto**: códigos novos `PILOT_STOPPED` (423), `ROUTE_INVALID` (422), `ACCOUNT_OUT_OF_ROUTE`, `TRACE_REQUIRED`, `TRACE_MISMATCH`; `resumePilot` exige `openbot:pilot_admin`. Roteiro completo: `docs/ATIVACAO-STAGING.md`.

## Atualização de 23/11/2026 (DP-41 e matéria no piloto)
- **DP-41:** com o piloto ativo só valem as contas `claude` e `codex` (`DP41_ACCOUNTS`). Despacho com outra conta = 422 `ROUTE_INVALID`; `pull` de outra conta = 422 `ACCOUNT_OUT_OF_ROUTE` + linha de violação + piloto parado. Checagem e revisão só na `codex`, sem reserva (no limite a tarefa fica pendente).
- **`meta.articleId`** na entrada (`io/input`): o gateway deriva o id da matéria da chave `<articleId>:<classe>:<tentativa>` (ou `input.articleId`); o agente o devolve em `trace.articleId` e a linha do piloto usa esse id como `article_id` (sem ele, o `refId`).
- Linha concluída de checagem/revisão **sem `gate_verdict`** fica fora da consulta do `canDispatchNext` até a Editorial gravá-lo (`awaitingEditorialGate`): não para o piloto.

## Rotas do agente: entrada e resultado do conteúdo (combinado com o Backend, 23/11/2026)
A fila só leva IDs; o conteúdo vai por duas rotas do agente, assinadas com o MESMO HMAC (`x-ln-signature`, `x-ln-timestamp`) e **presas ao lease vivo** da tarefa.
- **Quem grava a entrada:** a Fábrica, no MESMO processo, por `TaskIo.putInput` (no Backend, `PgTaskIo`), chamado pelo `OpenBotModelGateway` a cada `invoke` (inclusive ao retomar a espera). Tem de ser **idempotente**: mesmo `refId` e mesmo conteúdo = nada a fazer; conteúdo DIFERENTE = lançar `InputConflict` (a entrada de uma tarefa em andamento não muda; o gateway devolve recusa `input_divergente`). Falha do armazém = recusa `armazem_de_conteudo_indisponivel` e **nenhuma tarefa é despachada**. Só dado público ou interno.
- `POST /api/openbot/io/input` — corpo `{taskId, leaseId}` → `{data:{refId, input, taskClass, promptVersion, meta?:{reviewedDraftTaskId?}}}`. Só quem tem o lease vivo da tarefa lê. `meta.reviewedDraftTaskId` é o id da tarefa do rascunho que a checagem/revisão recebe (a Fábrica o põe em `input.reviewedDraftTaskId`; o gateway o repassa em `meta` com o formato de id validado). A via seguinte, depois de um limite, lê a mesma entrada com o lease novo.
- `POST /api/openbot/io/result` — corpo `{taskId, leaseId, result}` → `{data:{resultRef}}`. O agente **não escolhe** o `resultRef`: é `resultRefFor(taskId, tentativa)` = `res-<taskId>-a<tentativa>` (idempotente por tentativa; a tentativa 2 não sobrescreve a 1). Primeira gravação vence; a mesma gravação repetida devolve o mesmo `resultRef`; conteúdo diferente na mesma tentativa = 409. Teto de 256 KB por resultado; o teto da entrada é do Backend com a Editorial (recomendo ≥ 512 KB: rascunho + evidências).
- O agente então manda esse `resultRef` no `callback`. Com `requireDerivedResultRef: true` em `OpenBotDeps`, o callback de `completed` só aceita exatamente o derivado (422 `RESULT_REF_MISMATCH`, sem consumir o `callbackId`): o agente não aponta para resultado de outra tarefa.
- **Conformidade da fila:** `@ln/openbot/testing` exporta `leaseQueueConformanceCases(make)`, a mesma suíte que passa a fila em memória (dedupe, lease, claim em paralelo sem duplicar, troca de via no limite, redação que não troca, limite que não consome tentativa, espera da janela). A fila PostgreSQL (`FOR UPDATE SKIP LOCKED`) tem de passá-la inteira e lançar `LeaseError` com as mesmas razões (`tarefa_inexistente`, `lease_invalida`, `lease_expirada`).

## Teste de ponta a ponta local (23/11/2026)
`apps/web/app/api/openbot/e2e-agent.test.ts` roda a Fábrica (`OpenBotModelGateway` + `PgTaskIo`) contra as ROTAS REAIS sobre o PGlite, com um agente falso (`FakeOpenBot`, em `@ln/openbot/testing`) que faz pull → `io/input` → `io/result` → `callback` assinado. Parte 1, flag `openbotDispatch` desligada (padrão do contrato): a Fábrica não despacha nem grava entrada, o pull responde 423 `DISPATCH_OFF`, uma tarefa já em curso ainda fecha. Parte 2, flag ligada só no teste: ciclo redação (claude) → checagem independente (codex) com `reviewedDraftTaskId` em `meta`, troca de via no limite (codex → antigravity), independência pelo modelo declarado, redação que espera a janela e é retomada pela mesma via, recusas no fio (assinatura, lease alheio, `resultRef` de outra tarefa, replay do callback), via fora da rota e piloto sem o gate do AgentOps (falha fechada). O agente falso não chama OpenBot, modelo nem rede. Efeito no código: o gateway agora recusa antes de gravar a entrada quando o despacho está desligado (`DISPATCH_OFF`) ou parado (`KILL_SWITCH`).

## 423 Locked: recusa por decisão de parar (PM-2026-11-23-I)

`DISPATCH_OFF` (despacho desligado), `KILL_SWITCH` e `PILOT_STOPPED` respondem **423 Locked** com o corpo JSON e o mesmo `error.code`, em TODAS as rotas do agente que os emitem: `pull`, `heartbeat`, `io/input` e `io/result` (e o despacho da Fábrica, `dispatchTask`, para `KILL_SWITCH` e `PILOT_STOPPED`; o `DISPATCH_OFF` do despacho segue 409). Motivo: a borda da Vertra troca o corpo de 502, 503 e 504 por HTML, então o agente perdia o código. **503 fica só para indisponibilidade real** (banco, Redis). O agente trata qualquer 423 como "parar o ciclo, sem repetir em laço". O callback segue aceito durante a parada (fecha a tarefa e registra o custo já gasto). `OpenBotModelGateway` mapeia a recusa pelo `error.code`, então não muda.
