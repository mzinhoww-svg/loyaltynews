// Registro DURÁVEL dos envios de mídia do mLabs (UploadLedger de @ln/growth) sobre o PostgreSQL. Dono: Frente 02 — LN Backend Engineer.
// A primeira gravação vence: `putIfAbsent` = INSERT … ON CONFLICT DO NOTHING e depois lê a linha que FICOU (nunca DO UPDATE), então execuções
// paralelas, em qualquer processo, convergem no mesmo `imageId`. O instante preserva os milissegundos (timestamptz tem microssegundos).
// Só hash, id opaco do mLabs e instante: nenhum dado pessoal nem conteúdo. Validação do pacote antes do SQL; os CHECKs da tabela são a segunda barreira.
import { eq } from 'drizzle-orm';
import { schema } from '@ln/db';
import type { Db } from '@ln/auth';
import { assertLedgerEntry, type UploadLedger, type UploadLedgerEntry } from '@ln/growth';

export class PgUploadLedger implements UploadLedger {
  constructor(private readonly db: Db) {}

  async get(key: string): Promise<UploadLedgerEntry | null> {
    assertLedgerEntry(key);
    return this.read(key);
  }

  async putIfAbsent(key: string, entry: UploadLedgerEntry): Promise<UploadLedgerEntry> {
    assertLedgerEntry(key, entry);
    await this.db
      .insert(schema.growthMediaUploads)
      .values({ key, imageId: entry.imageId, createdAt: new Date(entry.at) })
      .onConflictDoNothing({ target: schema.growthMediaUploads.key });
    const kept = await this.read(key);
    if (!kept) throw new Error('registro de envios de mídia: a linha sumiu entre a gravação e a leitura'); // só se alguém apagou no meio
    return kept;
  }

  async delete(key: string): Promise<void> {
    assertLedgerEntry(key);
    await this.db.delete(schema.growthMediaUploads).where(eq(schema.growthMediaUploads.key, key));
  }

  private async read(key: string): Promise<UploadLedgerEntry | null> {
    const [r] = await this.db.select().from(schema.growthMediaUploads).where(eq(schema.growthMediaUploads.key, key)).limit(1);
    return r ? { imageId: r.imageId, at: r.createdAt.toISOString() } : null;
  }
}
