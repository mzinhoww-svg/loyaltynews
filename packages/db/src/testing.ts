import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import * as schema from './schema';

export const MIGRATIONS_FOLDER = fileURLToPath(new URL('../drizzle', import.meta.url));

/**
 * Banco-modelo em disco. Aplicar todas as migrações em WASM custa segundos por teste e, com vários workers e a máquina carregada,
 * estourava o tempo (falhas transitórias na suíte paralela). As migrações agora são aplicadas UMA vez por conteúdo de migração:
 * o diretório de dados (dump) fica em `os.tmpdir()` com o hash das migrações no nome, e cada `createTestDb` só carrega esse dump
 * num PGlite novo e ISOLADO (nada é compartilhado em memória entre testes). Gravação atômica (arquivo temporário + rename), então
 * workers concorrentes não leem arquivo pela metade; dump ausente, velho ou corrompido ⇒ reconstrói. Só para testes.
 */
function templateKey(): string {
  const h = createHash('sha256');
  const files = readdirSync(MIGRATIONS_FOLDER).filter((f) => f.endsWith('.sql')).sort();
  for (const f of files) h.update(f).update(readFileSync(join(MIGRATIONS_FOLDER, f)));
  const journal = join(MIGRATIONS_FOLDER, 'meta', '_journal.json');
  if (existsSync(journal)) h.update(readFileSync(journal));
  return h.digest('hex').slice(0, 24);
}

async function buildTemplate(path: string): Promise<void> {
  const seed = new PGlite();
  await migrate(drizzle(seed, { schema }), { migrationsFolder: MIGRATIONS_FOLDER });
  const dump = await seed.dumpDataDir('none');
  await seed.close();
  const tmp = `${path}.${process.pid}.${Date.now()}.tmp`;
  writeFileSync(tmp, Buffer.from(await dump.arrayBuffer()));
  try {
    renameSync(tmp, path);
  } catch {
    rmSync(tmp, { force: true }); // outro worker publicou o mesmo modelo primeiro: vale o dele
  }
}

async function open(path: string): Promise<PGlite> {
  const client = new PGlite({ loadDataDir: new Blob([readFileSync(path)]) });
  await client.waitReady;
  return client;
}

/** Banco PostgreSQL em memória (PGlite) com todas as migrações aplicadas. Só para testes. */
export async function createTestDb() {
  const path = join(tmpdir(), `ln-pglite-template-${templateKey()}.tar`);
  let client: PGlite | null = null;
  if (existsSync(path)) client = await open(path).catch(() => null);
  if (!client) {
    rmSync(path, { force: true });
    await buildTemplate(path);
    client = await open(path);
  }
  return { db: drizzle(client, { schema }), client, close: () => client!.close() };
}
