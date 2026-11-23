// PackageStore (porta do Social Dashboard, @ln/growth) sobre PostgreSQL. Registro inteiro em `record json`.
import { desc, eq } from 'drizzle-orm';
import { schema } from '@ln/db';
import type { Db } from '@ln/auth';
import type { PackageStore, SocialPackageRecord } from '@ln/growth/dashboard';

const plain = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

export class PgPackageStore implements PackageStore {
  constructor(private readonly db: Db) {}

  async get(id: string): Promise<SocialPackageRecord | null> {
    const [r] = await this.db.select({ record: schema.socialPackages.record }).from(schema.socialPackages).where(eq(schema.socialPackages.id, id));
    return r ? (r.record as SocialPackageRecord) : null;
  }

  async put(rec: SocialPackageRecord): Promise<void> {
    const row = { id: rec.id, articleId: rec.articleId, channel: rec.channel, status: rec.status, updatedAt: new Date(rec.updatedAt), record: plain(rec) };
    await this.db.insert(schema.socialPackages).values(row).onConflictDoUpdate({
      target: schema.socialPackages.id,
      set: { channel: row.channel, status: row.status, updatedAt: row.updatedAt, record: row.record },
    });
  }

  async all(): Promise<SocialPackageRecord[]> {
    return (await this.db.select({ record: schema.socialPackages.record }).from(schema.socialPackages).orderBy(desc(schema.socialPackages.updatedAt))).map(
      (r) => r.record as SocialPackageRecord,
    );
  }
}
