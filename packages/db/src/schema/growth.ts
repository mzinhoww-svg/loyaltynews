// Registro DURÁVEL dos envios de mídia do mLabs (UploadLedger do @ln/growth). Chave = `svg:<sha256 do SVG>:<canais>`; só hash, id opaco do mLabs e instante:
// nenhum dado pessoal nem conteúdo. A primeira gravação vence (PK). Implementação: `apps/workers/src/upload-ledger-pg.ts`.
// Migração reversível: `drizzle/down/0024_growth_media_uploads.down.sql`.
import { sql } from 'drizzle-orm';
import { check, index, pgTable, text, timestamp } from 'drizzle-orm/pg-core';

export const growthMediaUploads = pgTable(
  'growth_media_uploads',
  {
    key: text('key').primaryKey(),
    imageId: text('image_id').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
  },
  (t) => [
    check('growth_media_uploads_key', sql`${t.key} ~ '^[A-Za-z0-9:_,.-]{1,200}$'`),
    check('growth_media_uploads_image', sql`char_length(${t.imageId}) BETWEEN 1 AND 200`),
    index('growth_media_uploads_created_idx').on(t.createdAt),
  ],
);
