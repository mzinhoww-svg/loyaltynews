// Interface mínima compatível com `pg` (Pool/Client) e PGlite: query(sql, params) -> { rows }.
export interface Db {
  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<{ rows: T[] }>;
}

export async function one<T>(db: Db, sql: string, params: unknown[] = []): Promise<T> {
  const r = await db.query<T>(sql, params);
  if (r.rows.length !== 1) throw new Error(`expected 1 row, got ${r.rows.length}`);
  return r.rows[0]!;
}
