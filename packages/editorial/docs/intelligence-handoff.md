# Ligação Editorial → Intelligence (`PublishedArticle` + `RoleMention`)

Consumidor: `consumeArticle(db, { article, mentions }, config)` em `packages/intelligence/src/editorial-consumer.ts`
(ft/intelligence 8bba2d9; contrato `role-observation/1` em `INGESTION_CONTRACT.md`). Interface **estrutural**: nenhum import entre pacotes;
os tipos espelhados estão em `src/intelligence/types.ts` e a réplica de contrato usada nos testes em `fixtures/mock-intelligence-consumer.mock.ts` (MOCK).

## Fluxo
1. **Backend publica** (WF03, identidade de publicação) e recebe o recibo.
2. `applyPublication(store, { articleId, receiptId, url, publishedAt })` registra `publicado` **só se** a matéria está `aprovado`
   e o gate refeito passa (adulteração depois da aprovação ⇒ `gate_failed`). Grava `publication` (recibo, URL, hash do corpo) e
   e, NA MESMA OPERAÇÃO ATÔMICA (`store.commitPublication`: matéria + recibo + auditoria + outbox, ou nada), enfileira na outbox `{ queue: 'intelligence-ingest', refId: articleId, idempotencyKey: article.published:<id>:<sha256> }`
   (mesmo formato de `packages/db` outbox: por referência; PostgreSQL é a verdade). Idempotente pelo recibo.
3. O **worker** relê a matéria por `refId` (`store.getArticle`), monta o job com `jobFromRecord(rec)` e roda o estágio `roles`:
   `runStage(deps, { stage: 'roles', jobId, data: job }, { url, publishedAt, contentSha256 })` → `outcome.handoff`.
4. O worker chama `consumeArticle(db, { article: handoff.article, mentions: handoff.mentions }, config)`.

## Estágio `roles` (WF06)
- **Nunca de rascunho**: exige `approved` do job (só verdadeiro para matéria publicada com recibo), URL pública e hash igual ao do corpo
  aprovado (`stale_approval` se diferir). Evidência suspeita ⇒ bloqueia.
- **Determinístico primeiro**: padrões de nomeação, saída e (sem anúncio) cargo atual; `effectiveDate` só se a frase traz UMA data inequívoca;
  `announced` só com marca de anúncio na frase.
- **Modelo só pelo gateway** (`taskClass: 'roles'`, workflow `WF06`, dado público) e **só com a flag `intelligencePessoas` ligada**. O modelo
  apenas propõe; cada proposta passa por `validateMention`: trecho **literal** da matéria (≤ 500), nome/empresa/cargo **dentro do trecho**
  e nas **fontes primárias** coletadas, `announced`/`effectiveDate` só com base no trecho, chaves desconhecidas removidas, `publicProfileUrl`
  só se for URL pública que aparece no texto. O que falha vai para `handoff.dropped` (auditoria) com o motivo.
- **Flag desligada (padrão)**: sem chamada de modelo; pacote só de organizações — `personName` vazio, nome da pessoa substituído por
  `[pessoa omitida]` nos trechos (inclusive nomes de outras pessoas do mesmo lote), sem `headline`/`text`. O consumidor registra só `orgName`.
  Limite conhecido: a omissão cobre os nomes das menções extraídas; um nome citado no trecho que não virou menção não é detectado
  (por isso o pacote sem a flag também não leva título nem texto da matéria).
- Dado: só nome, cargo e empresa (DP-11 P4). Nada de e-mail/telefone/etc.

## Limites
- Os testes usam réplica MOCK do consumidor; a integração com o `consumeArticle` real depende de `ft/intelligence` estar mesclado.
- Os gates de matéria não fundamentam NOMES (só números e aspas); por isso `validateMention` exige o nome também na fonte primária.
