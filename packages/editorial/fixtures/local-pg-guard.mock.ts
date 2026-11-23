/**
 * Guarda do banco de ensaio: a rodada local DERRUBA e recria o banco apontado por LN_LOCAL_PG_URL.
 * Só aceita destino local e descartável; qualquer outro é recusado ANTES de abrir conexão.
 *  - protocolo postgres:// ou postgresql://;
 *  - host localhost, 127.0.0.1 ou ::1 (nada de host por parâmetro de URL: ?host=... é recusado);
 *  - nome do banco com prefixo de teste (test_, ln_test_ ou ln_editorial_local) e só [a-z0-9_] (vai para um comando SQL sem aspas);
 *  - nunca postgres/template0/template1 (não têm o prefixo).
 */
export const LOCAL_PG_HOSTS = ['localhost', '127.0.0.1', '[::1]'] as const;
export const LOCAL_PG_DB_PREFIXES = ['test_', 'ln_test_', 'ln_editorial_local'] as const;
const DB_NAME = /^[a-z0-9_]{1,63}$/;

export interface LocalPgTarget { url: string; host: string; port: string; dbName: string }

export function assertLocalDisposablePg(raw: string | undefined): LocalPgTarget {
  if (!raw) throw new Error('LN_LOCAL_PG_URL ausente');
  let u: URL;
  try { u = new URL(raw); } catch { throw new Error('LN_LOCAL_PG_URL inválida: recusada'); }
  if (u.protocol !== 'postgres:' && u.protocol !== 'postgresql:') throw new Error(`protocolo recusado: ${u.protocol}`);
  if (!(LOCAL_PG_HOSTS as readonly string[]).includes(u.hostname.toLowerCase())) throw new Error(`host recusado (só localhost/127.0.0.1/::1): ${u.hostname || '(vazio)'}`);
  if ([...u.searchParams.keys()].length > 0) throw new Error('parâmetros de URL recusados (host/options poderiam redirecionar a conexão)');
  const dbName = decodeURIComponent(u.pathname.replace(/^\//, ''));
  if (!DB_NAME.test(dbName)) throw new Error(`nome de banco recusado (só [a-z0-9_]): ${dbName || '(vazio)'}`);
  if (!LOCAL_PG_DB_PREFIXES.some((p) => dbName.startsWith(p))) throw new Error(`banco recusado: o nome precisa começar por ${LOCAL_PG_DB_PREFIXES.join(', ')} (era "${dbName}")`);
  return { url: raw, host: u.hostname, port: u.port || '5432', dbName };
}
