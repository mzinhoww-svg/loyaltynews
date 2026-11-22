import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const MIGRATIONS_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'migrations');

/** Lista de migrações em ordem. Aplique com o executor de migrações do packages/db (dono: Chief Architect). */
export function migrationFiles(): { name: string; sql: string }[] {
  return readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort()
    .map((name) => ({ name, sql: readFileSync(join(MIGRATIONS_DIR, name), 'utf8') }));
}

/** Aplica todas as migrações com uma conexão que aceite múltiplos comandos (exec). Uso em teste/bootstrap. */
export async function applyMigrations(exec: (sql: string) => Promise<unknown>): Promise<void> {
  for (const m of migrationFiles()) await exec(m.sql);
}
