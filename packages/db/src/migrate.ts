// Aplica as migrações de packages/db/drizzle num PostgreSQL real (node-postgres).
// Uso: DATABASE_URL=... npm run migrate -w @ln/db
// TLS: obrigatório com verificação do servidor e certificado de cliente (a Vertra exige TLS + certificado de cliente, R0-07).
//   DB_SSL_CA_PEM, DB_SSL_CERT_PEM, DB_SSL_KEY_PEM: conteúdo PEM em variável (nunca arquivo no repositório).
//   DB_SSL_MODE=disable só é aceito com CI=true (Postgres efêmero do CI).
// Arquivo autocontido (sem imports relativos) para rodar direto no Node com remoção de tipos.
import { fileURLToPath, pathToFileURL } from 'node:url';
import pg from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';

export type SslConfig = false | { ca: string; cert: string; key: string; rejectUnauthorized: true };

export function sslConfigFromEnv(env: Record<string, string | undefined>): SslConfig {
  if (env.DB_SSL_MODE === 'disable') {
    if (env.CI !== 'true') throw new Error('DB_SSL_MODE=disable só é permitido com CI=true');
    return false;
  }
  if (env.DB_SSL_MODE !== undefined && env.DB_SSL_MODE !== 'verify-full') {
    throw new Error(`DB_SSL_MODE inválido: ${env.DB_SSL_MODE} (use verify-full ou, só no CI, disable)`);
  }
  const ca = env.DB_SSL_CA_PEM;
  const cert = env.DB_SSL_CERT_PEM;
  const key = env.DB_SSL_KEY_PEM;
  if (!ca || !cert || !key) throw new Error('TLS exige DB_SSL_CA_PEM, DB_SSL_CERT_PEM e DB_SSL_KEY_PEM');
  for (const [nome, v] of [['DB_SSL_CA_PEM', ca], ['DB_SSL_CERT_PEM', cert], ['DB_SSL_KEY_PEM', key]] as const) {
    if (!v.includes('-----BEGIN ')) throw new Error(`${nome} não parece PEM`);
  }
  return { ca, cert, key, rejectUnauthorized: true };
}

export const MIGRATIONS_DIR = fileURLToPath(new URL('../drizzle', import.meta.url));

export async function runMigrations(env: Record<string, string | undefined> = process.env): Promise<void> {
  const url = env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL ausente');
  const pool = new pg.Pool({ connectionString: url, ssl: sslConfigFromEnv(env), max: 1 });
  try {
    await migrate(drizzle(pool), { migrationsFolder: MIGRATIONS_DIR });
  } finally {
    await pool.end();
  }
}

const invokedDirectly = process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) {
  runMigrations().then(
    () => console.log('migrações aplicadas'),
    (e: unknown) => {
      // Nunca imprime a URL nem os PEM: só a mensagem.
      console.error(`falha na migração: ${e instanceof Error ? e.message : String(e)}`);
      process.exit(1);
    },
  );
}
