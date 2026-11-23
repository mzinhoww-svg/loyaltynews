# Contrato da porta `EditorialStore` (para o Backend implementar em PostgreSQL)

Porta: `packages/editorial/src/api/store.ts`. Implementação de referência: `InMemoryEditorialStore`.
Os handlers do Studio (`src/api/*`) e o worker do pipeline (`applyOutcome`) só falam com esta porta.

## Como validar a sua implementação
```ts
// packages/<backend>/src/editorial-store.postgres.test.ts
import { runEditorialStoreContract } from '@ln/editorial/testing';
import { makePgliteStore } from './editorial-store.postgres';

runEditorialStoreContract('PostgresEditorialStore', async () => {
  const { store, close } = await makePgliteStore();   // banco/schema LIMPO por teste (PGlite novo ou transação revertida)
  return { store, teardown: close };
});
```
- A fábrica roda **antes de cada teste** e deve devolver uma loja **vazia**.
- Passar a suíte (19 casos) é condição para a loja ser aceita pelo QA. A suíte também é testada contra implementações erradas (aliasing, upsert que mescla, auditoria fora de ordem, appends perdidos): `src/tests/store-contract.test.ts`.
- Os casos "handlers sobre a loja" exigem apenas as tabelas desta porta; não dependem de Next.js.

## Métodos
| Método | Semântica |
|---|---|
| `getArticle(id)` / `getCorrection(id)` / `getSourceState(id)` | Registro ou `undefined` se não existe. Nunca lança por ausência. |
| `putArticle(r)` / `putCorrection(r)` / `putSourceState(s)` | **UPSERT atômico** pela chave (`articleId`, `case.id`, `sourceId`): substitui o registro **inteiro** (campos que sumiram do novo registro somem do armazenado). Resolve só depois de durável. |
| `listArticles()` / `listCorrections()` / `listSourceStates()` | Todos os registros, sem duplicatas. **Ordem não garantida** (os handlers ordenam). Paginação é feita pelos handlers em memória hoje; se o volume exigir, evoluir a porta (ver "Evolução"). |
| `commitPublication(c)` | **Uma transação**: upsert de `c.article` (status `publicado`, com `publication`/recibo), `INSERT` de `c.audit` e `INSERT` de `c.outbox`. Qualquer falha ⇒ rejeita e NADA fica gravado. **Idempotente pela `outbox.idempotencyKey`**: chave já existente ⇒ devolve `{ outbox: 'duplicate' }` sem efeito algum (nem sobrescreve a matéria nem duplica auditoria); senão `'enqueued'`. Entrada inválida (matéria não `publicado`, sem `publication`, campos vazios) ⇒ rejeita sem efeito. |
| `listOutbox()` | Itens `{ queue, refId, idempotencyKey }` gravados por `commitPublication`. |
| `appendAudit(a)` | Somente-acréscimo. Nunca altera nem apaga entradas anteriores. |
| `listAudit()` | Todas as entradas **na ordem em que os `appendAudit` foram resolvidos** (para chamadas sequenciais, a ordem de chamada). |

## Regras de dados
1. **JSON puro.** Datas são strings ISO-8601; sem `Date`, `Map`, `Set`, funções. `undefined` pode ser descartado; `null` é preservado (ex.: `userId: null` na auditoria de intake público).
2. **Sem aliasing.** O objeto devolvido por `get*/list*` e o objeto entregue a `put*/appendAudit` não podem compartilhar estado com o armazenado (em PostgreSQL isso é natural; em caches, copie).
3. **Fidelidade.** Texto multibyte (acentos, emoji, CJK) e payloads grandes (≥ 300 mil caracteres, ex.: corpo de matéria) voltam idênticos, sem truncar.
4. **Atomicidade.** `put*` concorrente na mesma chave deixa **um** registro inteiro (last-writer-wins), nunca mistura de campos. `put*` em chaves distintas e `appendAudit` paralelos não perdem dados.
5. **Falhas.** Erro de conexão/constraint ⇒ a promessa **rejeita**; nunca resolve com escrita parcial.

## Sugestão de mapeamento PostgreSQL (decisão do Backend/Arquiteto)
| Porta | Tabela sugerida | Chave | Observações |
|---|---|---|---|
| `ArticleRecord` | `editorial_article` | `article_id text PK` | colunas indexáveis `status`, `editoria`, `updated_at`; `record jsonb` com o restante (draft, evidences, factcheck, reviews). |
| `CorrectionRecord` | `editorial_correction` | `id text PK` (= `case.id`) | `state`, `kind`, `article_id`, `received_at` indexáveis; `record jsonb`. **Contém dados pessoais** (`contact`, `replyText`, nome do requerente): classe `personal`, acesso restrito, retenção definida pelo Trust (J-01/R0-10), e `contact` nunca sai em API. |
| `SourceState` | `editorial_source_state` | `source_id text PK` | `enabled`, `terms_status`; `review jsonb`. |
| `AuditItem` | `editorial_audit` | `id bigserial PK` | `INSERT` apenas; `listAudit` = `ORDER BY id`. Revogar `UPDATE/DELETE` do papel da aplicação. |

Se o schema final ficar em `packages/db`, a migração é do Chief Architect (regra de ownership).

## `commitPublication` em PostgreSQL (roteiro)
```ts
async commitPublication(c) {
  validar(c);                                                       // rejeita antes de abrir a transação
  return this.db.transaction(async (tx) => {
    const ins = await tx.insert(schema.outbox).values({ id: newId(), queue: c.outbox.queue, refId: c.outbox.refId, idempotencyKey: c.outbox.idempotencyKey })
      .onConflictDoNothing({ target: schema.outbox.idempotencyKey }).returning({ id: schema.outbox.id });
    if (ins.length === 0) return { outbox: 'duplicate' as const };   // já commitado: nada mais a fazer (a tx não escreveu nada)
    await upsertArticle(tx, c.article);                             // mesmo upsert de putArticle
    await tx.insert(schema.editorialAudit).values({ at: c.audit.at, record: plain(c.audit) });
    return { outbox: 'enqueued' as const };                         // qualquer erro acima ⇒ rollback de tudo, inclusive o outbox
  });
}
async listOutbox() { /* SELECT queue, ref_id, idempotency_key FROM outbox ORDER BY created_at, id → OutboxItem[] */ }
```
A tabela `outbox` de `packages/db` já tem a unicidade em `idempotency_key`. Para a suíte provar a atomicidade, a fábrica pode devolver `armFault(step)`
(`'after_article' | 'after_audit' | 'after_outbox'`): faz a próxima `commitPublication` lançar nesse ponto DENTRO da transação (ex.: flag lida pelo wrapper que
chama `throw` depois de cada comando). Sem `armFault` esse caso é pulado — recomendado implementar.

## Concorrência além do contrato (recomendação)
O contrato exige last-writer-wins atômico. Para evitar sobrescrita silenciosa entre dois revisores, o Backend pode acrescentar uma coluna `version` e rejeitar `put` com versão defasada — isso **muda a porta** (precisaria de `expectedVersion` e de erro `Conflict`) e deve ser pedido ao dono do pacote (Frente 06) com novo caso de contrato.

## O que a porta NÃO faz
- Não decide permissão, não valida regra editorial e não chama modelo: isso é dos handlers/pipeline.
- Não publica nem despublica (WF03) e não fala com mLabs.
- Não cria dados de exemplo. Dados de teste vivem em `fixtures/` e nos testes (`sampleArticle`, `sampleCorrection`, `sampleSourceState` exportados por `@ln/editorial/testing`).

## Evolução prevista
Paginação/filtros no servidor (`listArticles({status, editoria, limit, offset})`) quando a fila passar de alguns milhares de matérias; `expectedVersion` para concorrência otimista. Ambas exigem novos casos na suíte de contrato.

## Id da matéria e hash do recibo (ADR-017)
- **Um id só.** `articleId` é gerado na criação do rascunho (primeiro `putArticle`/`applyOutcome` do job) e **nunca muda**: é a chave do registro, `editorial_article.article_id`, e é o mesmo `articles.id` do portal (sem chave estrangeira). A porta não tem operação de renomear; `commitPublication` grava sempre sob `article.articleId`. O recibo emitido para outro `articleId` deve ser recusado pelo Backend (teste dele).
- **Hash do recibo = `publishedContentSha256`** de `@ln/contracts/hash`, calculado sobre o **rascunho editorial aprovado** com `toPublishableContent(draft)` / `draftContentSha256(draft)` (exportados por `@ln/editorial`; o Backend deve usá-los, não reimplementar). Cobre título, editoria, corpo (com "Fontes:"), imagem e base de direito, classe, patrocínio e fontes. O mesmo valor vai a `PublicationReceipt.conteudoSha256`, à chave de outbox `article.published:{id}:{sha}` e a `publication.contentSha256`.
- `applyPublication(store, { ..., expectedContentSha256 })`: o Backend passa o hash do recibo; se o rascunho mudou depois da aprovação (manchete, imagem, fontes...), a publicação é recusada com `receipt_stale`.

## Campos publicáveis do Draft (ADR-017 §4) e `toPublishableContent(rec)`
`articles` é a projeção do conteúdo **aprovado**; nunca guarda rascunho. O `Draft` traz os campos de `PublishableContent`:
`slug` (gerado na 1ª redação a partir da manchete, único via `deps.slugExists`; **imutável depois da 1ª publicação** — `applyPublication` recusa com `slug_immutable`, e `slug_taken` se outra matéria publicada já o usa; a unicidade definitiva é o índice único do banco), `resumo` (≤ 300, **obrigatório no gate de aprovação**: sem ele o WF02 bloqueia; passa pelos mesmos gates de número, aspas, entrevista e cópia do corpo), `subtitulo?` (≤ 300), `tipoConteudo` (padrão `noticia`), `classeDeDado` (padrão `public`; só `public` passa), `patrocinado`/`rotuloPublieditorial` (o pipeline editorial nunca gera conteúdo patrocinado: é do Comercial; `sponsored_not_editorial` no gate). Tipo, classe e patrocínio são do sistema; o modelo não os define.

`toPublishableContent(rec | draft)` (de `@ln/editorial`): `headline→titulo`, `subtitulo`, `resumo`, `tipoConteudo`, `editoria`, `body→corpo` (com "Fontes:"), `image→imagem` (`ImageRights` de `@ln/contracts`: `origem 'fonte_terceiro'`, `baseDeDireito` mapeada de licença/autorização/domínio público/exceção validada, ou `pendente` sem base; `textoAlternativo` = `alt` do candidato ou "Imagem da matéria: <manchete>"), `classeDeDado`, `patrocinado`, `rotuloPublieditorial`, `evidenceIds→fontes`. Imagem conceptual não tem equivalente em `ImageRights`: sai crua (coberta pelo hash) e **não é publicável** até o Chief Architect definir; o pipeline hoje não a produz. O `slug` não faz parte de `PublishableContent` (a imutabilidade é regra própria acima).

Para o upsert em `articles` na emissão do recibo (Backend): `id = rec.articleId`, `versao` = versão do rascunho, `slug = rec.draft.slug`, demais campos de `toPublishableContent(rec)`, `status = 'aprovado'`; recibo com `conteudoSha256 = draftContentSha256(rec)`. Rascunho que não está `aprovado` → 409 sem efeito. O estado `publicado` só vem de `applyPublication`.
