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

Códigos de erro (envelope `ApiError` de `@ln/contracts`): `UNAUTHORIZED` 401, `VALIDATION_ERROR` 400, `LEASE_ERROR` 404/409, `USAGE_INVALID` 422, `USAGE_MISMATCH` 422, `KILL_SWITCH` 503, `DISPATCH_OFF` 409, `KIND_FORBIDDEN`/`KIND_UNKNOWN`/`DATA_CLASS_BLOCKED`/`COST_CAP_EXCEEDS_BUDGET` 422, `BUDGET_EXHAUSTED` 409, `FORBIDDEN` 403.

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
- **Piloto**: códigos novos `PILOT_STOPPED` (503), `ROUTE_INVALID` (422), `ACCOUNT_OUT_OF_ROUTE`, `TRACE_REQUIRED`, `TRACE_MISMATCH`; `resumePilot` exige `openbot:pilot_admin`. Roteiro completo: `docs/ATIVACAO-STAGING.md`.
