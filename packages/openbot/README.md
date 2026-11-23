# @ln/openbot — adaptador OpenBot (Frente 09, Integration)
Implementa o contrato do ADR-003: o OpenBot executa e coordena os agentes; estado, filas, outbox e orçamento ficam no banco do projeto. O adaptador funciona por **pull com lease, iniciado pelo OpenBot** (só conexão de saída), com **callback assinado e idempotente**. Sem dependências além de `@ln/contracts` e `zod`. Convenções do scaffold: TypeScript estrito, imports sem extensão, Vitest em `src/__tests__/` (raiz: `npm test`, `npm run typecheck`, `npm run lint`).

**Nada aqui publica.** O OpenBot nunca recebe tarefa de publicação (`NEVER_DISPATCH_KINDS`); a publicação é só do `publisher_social` (`@ln/growth`, ADR-008). Nenhuma chamada de rede, nenhum servidor, nenhuma variável de ambiente e nenhum segredo no código (teste `properties.test.ts` varre o fonte).

## Módulos
| Arquivo | O que faz |
|---|---|
| `src/types.ts` | Tarefas despacháveis, proibidas, classes de dado liberadas, `LeasedTask` (só IDs e limites), `UsageReport` |
| `src/signing.ts` | HMAC-SHA256 `v1=<hex>` sobre `${timestampMs}.${corpo}`; janela de 5 min (anti-replay); comparação em tempo constante; rotação (segredo atual e anterior) |
| `src/lease-queue.ts` | Porta `LeaseQueue` (a real é o outbox PostgreSQL do Backend) + implementação em memória com a mesma semântica: dedupe por chave, lease com expiração, heartbeat, complete idempotente, retentável/`failed`/`dead` |
| `src/costs.ts` | Validação do custo relatado (custo desconhecido = recusa), `CostLedger` (dedupe por `executionId`, estouro da tarefa registrado), `budgetStatus` (alerta em 80%, teto US$ 50), `reconcile` (OpenBot × ledger do gateway por `generationId`) |
| `src/health.ts` | Saúde pelo último pull: `sem_contato` / `saudavel` / `atrasado`; atrasado ⇒ workers próprios de reserva + pausa de publicação |
| `src/handlers.ts` | Handlers puros: `handlePull`, `handleHeartbeat`, `handleCallback`, `dispatchTask`, `getOpenBotStatus` |

Protocolo, formato das requisições e fluxos: `docs/PROTOCOL.md`.

## Garantias (cada uma tem teste)
- Assinatura obrigatória em pull, heartbeat e callback; sem segredo configurado tudo é 401 (falha fechada); chamada recusada não conta como contato.
- Despacho: flag desligada por padrão (`dispatchEnabled`), kill switch, permissão `openbot:dispatch`, tipos de publicação recusados, só dados `public`/`internal`, teto da tarefa ≤ teto mensal, sem saldo ⇒ 409, idempotente por chave.
- Callback: replay do `callbackId` = 200 `duplicate` sem efeito; custo inválido ⇒ 422 **sem consumir** o `callbackId`; custo de outra tarefa/lease ⇒ 422; lease alheio/vencido ⇒ 409; falha retentável volta à fila (tentativa 2); custo da tentativa falha também é registrado.
- Orçamento: estouro do teto mensal devolve `pauseModelCalls: true` (o gateway bloqueia novas chamadas); estouro do teto da tarefa é sinalizado (`overrun`), nunca escondido.
- Conciliação: custo sem lastro no gateway, gasto no gateway sem relato e divergência por geração reprovam (`reconcile().ok === false`).

## Não verificado / pendente
- **OpenBot real:** endpoint customizado por agente, métrica de uso por execução (tokens/custo por execução) e relay de webhook estão como "não verificado" no ADR-003. O formato de `UsageReport` e do cabeçalho de assinatura é **proposta deste adaptador**, a confirmar no R2-10 com o OpenBot de produção; nada foi chamado.
- **Persistência:** `LeaseQueue`, `CostLedger`, `HealthStore` e `CallbackStore` têm só implementação em memória; as reais (tabelas de outbox/ledger/callbacks, `FOR UPDATE SKIP LOCKED`) são do Backend/Architect. O `callbackId` precisa de tabela com retenção ≥ janela de assinatura.
- **Rotas HTTP:** os handlers não estão ligados a `apps/web/app/api` (dono: Backend). Sugestão: `POST /api/openbot/pull|heartbeat|callback` passando o corpo cru e os cabeçalhos `x-ln-signature`/`x-ln-timestamp` aos handlers.
- **Flag:** `openbotDispatch` não existe em `@ln/contracts/flags`; aqui é parâmetro (padrão desligado). Pedir ao Chief Architect.
- **Segredo:** o provedor de segredos (`deps.secrets()`) deve ler do cofre do OpenBot/Vertra; nenhum segredo foi criado ou usado. Credencial do OpenBot de produção segue como pendência de R2-09.
- Sem teste com BullMQ/Redis nem com o OpenBot real.
