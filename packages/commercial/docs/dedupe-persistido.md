# Dedupe de impressões persistido (múltiplas instâncias)

Dono: Frente 10 (Comercial). Destinatários: Backend (adaptador), DevOps (Redis), Chief Architect (DDL, se a opção B for escolhida).
Estado: **proposta**; o lado do pacote já está pronto (`ImpressionLedger`), falta o adaptador de armazenamento.

## Problema
Hoje a regra "uma impressão por visualização de página + posição; visível e clique uma vez por impressão" vive em mapas na memória do processo. Com mais de uma instância (ou um deploy no meio da sessão do leitor):
1. a mesma visualização atendida por duas instâncias conta duas vezes (infla impressão, o que o Blueprint proíbe);
2. reiniciar zera o dedupe: um refresh depois do restart conta de novo;
3. o mapa só cresce (hoje há um teto que o limpa de uma vez, perdendo tudo);
4. o id padrão `imp-N` é sequencial por processo: duas instâncias geram o mesmo id e o clique de uma impressão pode ser atribuído à outra.

## O que o pacote já oferece
`ImpressionLedger` (src/ledger.ts), injetável em `new AdServer(ledger)`:

| Método | Uso |
|---|---|
| `new ImpressionLedger({ newId, now })` | `newId: () => crypto.randomUUID()` resolve o item 4 |
| `preload(entries)` | antes de servir: carrega as entradas da requisição lidas do armazenamento compartilhado (não marca como alteradas) |
| `drainChanges()` | depois de servir: devolve o que nasceu ou mudou e zera; é o que se grava |
| `evict(beforeMs)` | TTL local do cache de trabalho |
| `snapshot()` / `load()` | cópia/restauração (testes, depuração) |
| `viewKey(pageViewId, positionId)` | chave canônica da visualização |

O ad server continua síncrono e sem I/O; o adaptador do Backend faz o I/O em volta dele (ciclo de 3 passos por requisição). Coberto por testes de duas instâncias sobre um armazenamento simulado (`src/snapshot.test.ts`).

## Opção A (recomendada): Redis 8.2 (já na pilha, ADR-002) com TTL
Chaves (sem dado pessoal: só ids opacos; não guardar IP, user agent nem cookie):

| Chave | Valor | TTL | Escrita |
|---|---|---|---|
| `ln:ad:view:{pageViewId}:{positionId}` | JSON da `LedgerEntry` | 30 min | `SET ... NX EX 1800` |
| `ln:ad:imp:{impressionId}` | hash `{creativeId, visible, clicked, at}` | 2 h | `HSETNX imp visible 1` / `HSETNX imp clicked 1` |
| `ln:ad:cnt:{creativeId}:{AAAA-MM-DD}` | hash dos 5 contadores | 3 dias | `HINCRBY` |

Ciclo por requisição de `serve`: (1) `GET` da chave da visualização → `ledger.preload`; (2) `ads.serve`; (3) `drainChanges` → `SET NX`. Se o `NX` falhar (outra instância ganhou a corrida), a instância lê a entrada vencedora, devolve `counted:false` e não incrementa. Por isso o passo 3 deve ser feito **antes** de aplicar o contador (ou compensar com `HINCRBY -1`); o adaptador deve preferir "gravar a entrada, e só então contar".

Contadores: acumular no Redis e um worker gravar em `ad_delivery_daily` a cada minuto (`UPSERT` somando o delta, depois subtrair do Redis o que foi gravado). Isto tira a escrita em PostgreSQL do caminho público do anúncio, que hoje é uma por requisição.

Falha do Redis (política): **sub-contar, nunca inflar** (perda ou restauração: ver a seção "Perda ou restauração do Redis"). Sem dedupe confiável, servir o criativo com `counted:false` e `reason:'dedupe_indisponivel'`, e registrar métrica de operação. Nunca cair para memória do processo e contar.

Tamanho: memória ≈ (entradas vivas) × (~200 bytes); entradas vivas = impressões por segundo × 1800 s. Não há tráfego medido ainda; dimensionar quando houver analytics (nenhum número assumido aqui).

## Opção B (alternativa sem Redis): tabela PostgreSQL
Proposta de DDL (para o Chief Architect, não incluída em `packages/db`):

```
ad_impressions(
  impression_id text primary key,
  view_key      text not null,          -- `${pageViewId}|${positionId}`
  creative_id   text not null references ad_creatives(id),
  created_at    timestamptz not null default now(),
  visible_at    timestamptz,
  clicked_at    timestamptz
)
unique index ad_impressions_view_key_uq on ad_impressions(view_key)
index ad_impressions_created_idx on ad_impressions(created_at)   -- expurgo
```
Primeira impressão: `INSERT ... ON CONFLICT (view_key) DO NOTHING RETURNING` (vazio = já existia, ler a entrada). Visível/clique: `UPDATE ... SET visible_at = now() WHERE impression_id = $1 AND visible_at IS NULL RETURNING` (uma linha = contou). Expurgo por job diário (`DELETE ... WHERE created_at < now() - interval '2 hours'`) ou partição por dia.

## Comparação
| | A. Redis | B. Tabela |
|---|---|---|
| Latência no caminho público | baixa | uma ida ao PostgreSQL por impressão |
| Atomicidade primeira-escrita | `SET NX`, `HSETNX` | `ON CONFLICT`, `UPDATE ... IS NULL` |
| Expiração | nativa (TTL) | job de expurgo |
| Infra nova | Redis já previsto | nenhuma, mas aumenta carga do banco |
| Contadores sem escrita por requisição | sim (`HINCRBY` + worker) | não |

Recomendação: A. Se o Redis não estiver provisionado no staging, B destrava sem esperar, com o mesmo contrato do `ImpressionLedger` (só troca o adaptador).

## Pendências
- Backend: adaptador `ImpressionStore` (preload/commit) em `apps/web/app/api/_lib/commercial`, usando `new ImpressionLedger({ newId: () => crypto.randomUUID() })` por processo.
- DevOps: instância Redis no ambiente de staging (opção A) e política de memória (`maxmemory-policy volatile-ttl`).
- Chief Architect: só se a opção B for escolhida (migração `ad_impressions`).
- Verificação com tráfego real fica para depois do staging; os testes atuais usam armazenamento simulado.

## Perda ou restauração do Redis (ponto levantado pelo DevOps)
O ADR-012 não faz backup do Redis. Se o Redis for reiniciado sem persistência, receber `FLUSHALL` ou for restaurado de um ponto antigo, as chaves de dedupe somem ou voltam a um estado anterior. Dentro do TTL isso **inflaria**: a mesma visualização (30 min) seria contada de novo, e um visível/clique já contado (2 h) poderia contar outra vez. "Sub-contar, nunca inflar" só vale se a perda for detectada e a contagem suspensa. Isto está implementado em `src/audit.ts`.

### Mitigação: lacuna de auditabilidade
Ao detectar a perda, o adaptador chama `ads.audit.reportLoss({ detectedAtMs, lastHealthyAtMs, reason })`. Efeito:

| Janela | Intervalo | O que acontece |
|---|---|---|
| Não auditável | `lastHealthyAt` até detecção + 2 h | período marcado "não auditável" nos relatórios |
| Impressões novas | detecção até detecção + 30 min (`VIEW_TTL_MS`) | o criativo continua sendo servido e rotacionado, mas **não é contado** (`counted:false`, `reason:'dedupe_suspenso'`) |
| Visível e clique | detecção até detecção + 2 h (`IMPRESSION_TTL_MS`) | eventos descartados e contados na lacuna (`ignoredEvents`) |

- Nova perda durante a suspensão funde com a lacuna aberta e reinicia as janelas (`reportLoss` devolve a mesma lacuna).
- A lacuna guarda quantas impressões e eventos ficaram sem contagem, para dimensionar o piso.
- Relatórios: `campaignDetail(...).report.auditability` (`auditable:false` + lacunas + nota "valores mínimos, não totais"), `mediaKitPage(...).deliveryIntegrity`, e item `periodo_nao_auditavel` em `studioDashboard(...).attention`. Sem lacuna, o campo vem vazio (estado honesto), não "100% auditado".
- A lacuna entra em `AdServer.snapshot()`/`load()` e em `snapshotState`/`loadState`: sobrevive a reinício do processo. O Backend deve persistir as lacunas (proposta: tabela `ad_delivery_gaps` espelhando `AuditGap`, ou JSON em `commercial_metrics`/configuração; o formato do snapshot já é estável).

### Como detectar (protocolo; implementado em `apps/workers/src/ad-redis-watch.ts`, ver `apps/web/app/api/README.md`)
Uma chave-marcador simples (`ln:ad:epoch`) **não detecta restauração de backup**: o valor restaurado pode ser igual ao que a instância já conhece. Use um **watermark monotônico** com espelho no PostgreSQL:

1. Uma chave `ln:ad:hb` (inteiro) é incrementada por `INCR` a cada minuto por quem estiver vivo; logo após o `INCR`, o valor lido é gravado no PostgreSQL com `GREATEST` (tabela `ad_redis_watermark(id, value, at)`, id `ln:ad:hb`), junto com o horário.
2. A cada batida (e na subida do processo), comparar o valor lido do Redis com o do PostgreSQL:
   - chave ausente, ou valor **menor** que o do PostgreSQL → o Redis perdeu ou voltou no tempo → `reportLoss({ detectedAtMs: agora, lastHealthyAtMs: em do PostgreSQL, reason: 'dedupe_perdido' | 'dedupe_regrediu' })`, e então reajustar o PostgreSQL para o valor atual do Redis;
   - valor maior ou igual → saudável; atualizar o PostgreSQL.
3. Se o Redis estiver inacessível: tratar como perda (servir sem contar, como a política de falha acima) e abrir a lacuna quando voltar, com `lastHealthyAt` = última batida registrada.
4. Enquanto a lacuna estiver aberta o `AdServer` já recusa a contagem; o adaptador não precisa tratar caso a caso.

Complementos (decisão do DevOps, não substituem a mitigação): AOF com `appendfsync everysec` reduz a janela de perda em reinício, e backup do Redis reduziria a chance de regressão. Mesmo com eles, a detecção por watermark continua necessária, porque uma restauração antiga ainda é possível.

### Cobertura de testes
`src/audit.test.ts` (18 testes): demonstra a inflação sem a mitigação; suspensão e retomada nos limites exatos de 30 min e 2 h; eventos descartados; antes da detecção nada muda; bots/internos fora; house ad sem criativo; rotação não congela; fusão de lacunas; ida e volta por JSON; snapshot antigo sem o campo; "não auditável" na campanha, painel e mídia kit; bordas do período; handlers públicos usando o instante do contexto.
A detecção em si está em `apps/workers/src/ad-redis-watch.test.ts` (ioredis-mock; com `LN_TEST_REDIS_URL`, Redis real). Ainda não verificado: um Redis reiniciado de propósito em staging. O protocolo acima é a especificação para o Backend implementar e para o QA verificar em staging com um Redis reiniciado de propósito.
