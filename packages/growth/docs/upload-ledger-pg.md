# Registro durável dos envios de mídia (UploadLedger) — pedido ao Backend
Estado: **contrato e suíte de conformidade prontos no Growth; tabela, migração e `PgUploadLedger` são do Backend (dono de `packages/db` e de `apps/workers`).** Até a migração existir, o registro segue **em memória** e o envio de mídia segue **desligado** (flag `linkedinPublicacao`). Decisão do PM (23/11/2026): o registro tem de ser durável antes de qualquer uso real.

## Por que existe
`publisher.uploadMedia` sobe o PNG do criativo ao mLabs (`prepare_media_upload` → PUT → `get_media_upload`). A chave de idempotência é o hash do SVG de origem. Em memória, qualquer reinício ou segunda execução sobe a mesma imagem de novo (e cada subida é uma escrita no mLabs). Com o registro durável, o mesmo criativo reaproveita o `imageId` enquanto a entrada for recente.

## Contrato (`UploadLedger`, em `packages/growth/src/pipeline/raster-upload.ts`)
```ts
interface UploadLedgerEntry { imageId: string; at: string /* ISO 8601 UTC */ }
interface UploadLedger {
  get(key: string): Promise<UploadLedgerEntry | null>;
  putIfAbsent(key: string, entry: UploadLedgerEntry): Promise<UploadLedgerEntry>; // a primeira gravação vence; devolve a que FICOU
  delete(key: string): Promise<void>;                                              // remover o que não existe não é erro
}
```
- **Chave:** `svg:<sha256 hex do SVG>:<canais>` (ex.: `svg:3f…a9:linkedin`); formato aceito `^[A-Za-z0-9:_,.-]{1,200}$`. `imageId`: 1–200 caracteres. `at`: instante válido. Violação → `RangeError` (na tabela: CHECK).
- **Idade máxima:** o uploader descarta (e apaga) entradas com mais de 24 h (`ledgerMaxAgeMs`, padrão conservador: a validade do `imageId` no mLabs **não foi verificada**). A tabela guarda `created_at`; o uploader compara com o `at` da entrada.
- **Sem dado pessoal e sem conteúdo:** só hash, id opaco do mLabs e instante.

## Proposta de tabela e migração reversível (numeração a combinar; hoje a última é 0023)
Segue o padrão do repositório (`drizzle/NNNN_*.sql` + `drizzle/down/NNNN_*.down.sql`).
```sql
-- 0024_growth_media_uploads.sql
CREATE TABLE "growth_media_uploads" (
	"key" text PRIMARY KEY NOT NULL,
	"image_id" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "growth_media_uploads_key" CHECK ("growth_media_uploads"."key" ~ '^[A-Za-z0-9:_,.-]{1,200}$'),
	CONSTRAINT "growth_media_uploads_image" CHECK (char_length("growth_media_uploads"."image_id") BETWEEN 1 AND 200)
);
--> statement-breakpoint
CREATE INDEX "growth_media_uploads_created_idx" ON "growth_media_uploads" ("created_at");
```
```sql
-- drizzle/down/0024_growth_media_uploads.down.sql
-- Reverte 0024: remove o registro dos envios de mídia. Efeito: o próximo envio sobe a imagem de novo (idempotência pelo mLabs NÃO verificada); nenhum outro dado é perdido.
DROP TABLE IF EXISTS "growth_media_uploads";
DELETE FROM drizzle.__drizzle_migrations WHERE created_at = <timestamp da migração>;
```
Retenção sugerida: apagar linhas com mais de 7 dias (a entrada vale 24 h); pode ser um job de limpeza ou `DELETE` no próprio `get` de entrada vencida (já feito pelo uploader via `delete`).

## `PgUploadLedger` (sugestão: `apps/workers/src/upload-ledger-pg.ts`, ao lado de `openbot-pg.ts`)
- `get`: `SELECT image_id, created_at FROM growth_media_uploads WHERE key = $1` → `{ imageId, at: created_at.toISOString() }` (**preservar milissegundos**: o conformance confere `at` idêntico).
- `putIfAbsent`: `INSERT … ON CONFLICT (key) DO NOTHING`, depois `SELECT` da linha que ficou (não use `DO UPDATE`: a primeira gravação vence). Tem de ser seguro para execuções paralelas.
- `delete`: `DELETE … WHERE key = $1`.
- Validar entradas antes (`assertLedgerEntry` e `LEDGER_KEY_RE` estão exportados por `@ln/growth`) e deixar o CHECK como segunda barreira.

## Como provar (como foi feito com a fila do OpenBot)
```ts
import { uploadLedgerConformanceCases } from '@ln/growth/testing'; // entrada nova, só a suíte de conformidade
for (const c of uploadLedgerConformanceCases(() => new PgUploadLedger(db))) it(c.name, c.run);
```
Os 7 casos cobrem: chave inexistente, gravar e ler sem arredondar o instante, primeira gravação vence, gravações paralelas convergem, remover e regravar, entradas inválidas recusadas sem gravar, chave no tamanho máximo. Limpe a tabela entre os casos.

## Ligação (depois que o Backend entregar)
`media: { rasterizer, ledger: new PgUploadLedger(db) }` na criação do publicador (ou `live.uploadLedger` no pipeline do LinkedIn). Nada muda no Growth além disso. **Não ligar o envio real de mídia sem a aprovação do proprietário no go-live.**
