// TLS do Redis (web e workers). A Vertra exige TLS com certificado de cliente também no Redis: `REDIS_URL=rediss://usuario:senha@host:porta`.
//   REDIS_SSL_CA_PEM, REDIS_SSL_CERT_PEM, REDIS_SSL_KEY_PEM: PEM em variável, multilinha ou numa linha com `\n` escapado.
//   `servername` = host da URL (SNI e verificação do nome do servidor; omitido se o host for um IP); `rejectUnauthorized` sempre verdadeiro.
//   REDIS_SSL_MODE=disable só com CI=true (Redis efêmero do CI). `redis://` sem TLS em NODE_ENV=production é erro (falha fechada).
// Nunca devolve nem registra o conteúdo dos PEM nem a senha da URL em mensagens de erro.
import { isIP } from 'node:net';
import { anyPemSet, requirePemSet } from '@ln/db/tls';

export interface RedisTls {
  ca: string;
  cert: string;
  key: string;
  /** Ausente quando o host da URL é um IP: o Node recusa SNI com IP (a verificação usa o IP no certificado). */
  servername?: string;
  rejectUnauthorized: true;
}

/** Opção `tls` do ioredis a partir do ambiente, ou `undefined` para conexão sem TLS (só fora de produção ou no CI). */
export function redisTlsFromEnv(env: Record<string, string | undefined> = process.env): RedisTls | undefined {
  const raw = env.REDIS_URL;
  if (!raw) return undefined;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error('REDIS_URL inválida');
  }
  const mode = env.REDIS_SSL_MODE;
  if (mode === 'disable') {
    if (env.CI !== 'true') throw new Error('REDIS_SSL_MODE=disable só é permitido com CI=true');
    return undefined;
  }
  if (mode !== undefined && mode !== 'verify-full') throw new Error(`REDIS_SSL_MODE inválido: ${mode} (use verify-full ou, só no CI, disable)`);
  const wantsTls = url.protocol === 'rediss:' || anyPemSet(env, 'REDIS_SSL') || mode === 'verify-full';
  if (!wantsTls) {
    if (env.NODE_ENV === 'production') throw new Error('REDIS_URL deve ser rediss:// (TLS com certificado de cliente) em produção');
    return undefined;
  }
  if (url.protocol !== 'rediss:' && url.protocol !== 'redis:') throw new Error('REDIS_URL deve começar com rediss:// ou redis://');
  const host = url.hostname.replace(/^\[|\]$/g, ''); // IPv6 vem entre colchetes
  return { ...requirePemSet(env, 'REDIS_SSL'), ...(isIP(host) ? {} : { servername: host }), rejectUnauthorized: true };
}

/** Opções extras do ioredis: `{ tls }` quando há TLS, `{}` quando não há. */
export function redisTlsOptions(env: Record<string, string | undefined> = process.env): { tls?: RedisTls } {
  const tls = redisTlsFromEnv(env);
  return tls ? { tls } : {};
}
