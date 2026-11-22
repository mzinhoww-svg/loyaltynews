import type { PgDatabase } from 'drizzle-orm/pg-core';
import type { schema } from '@ln/db';

/** Banco Drizzle PostgreSQL: node-postgres em produção, PGlite nos testes. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Db = PgDatabase<any, typeof schema>;
