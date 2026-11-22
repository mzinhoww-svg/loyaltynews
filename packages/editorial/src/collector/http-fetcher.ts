import http from 'node:http';
import https from 'node:https';
import type { LookupFunction } from 'node:net';
import type { Fetcher, FetchOptions, HttpResponse } from './collector';
import { isPublicIp } from './net';

/**
 * Única peça deste pacote que abre socket. Conecta SOMENTE no IP já validado pelo coletor (`opts.address`):
 * o `lookup` do agente devolve o IP fixado e nunca consulta o DNS, o que elimina DNS rebinding entre a validação
 * e a conexão. TLS/SNI e o cabeçalho Host continuam sendo o hostname original. Não segue redirecionamentos
 * (o coletor revalida cada salto), não envia credenciais/cookies e limita tamanho e tempo.
 */

export function pinnedLookup(address: string, family: 4 | 6, allowPrivateForTests = false): LookupFunction {
  return (_hostname, options, callback) => {
    if (!allowPrivateForTests && !isPublicIp(address)) {
      callback(Object.assign(new Error(`endereço fixado não público: ${address}`), { code: 'EPRIVATE' }), '', family);
      return;
    }
    // Node pode pedir todas as famílias (autoSelectFamily): responde só com o IP fixado.
    if ((options as { all?: boolean }).all) (callback as unknown as (e: null, a: Array<{ address: string; family: number }>) => void)(null, [{ address, family }]);
    else callback(null, address, family);
  };
}

export interface NodeFetcherOptions {
  timeoutMs?: number;
  maxBytes?: number;
  /** SOMENTE para testes com servidor local. Nunca ligar em código de produção. */
  allowPrivateForTests?: boolean;
}

export function createNodeFetcher(o: NodeFetcherOptions = {}): Fetcher {
  const timeoutMs = o.timeoutMs ?? 15_000;
  const maxBytes = o.maxBytes ?? 2_000_000;
  return {
    get(url: string, opts: FetchOptions): Promise<HttpResponse> {
      return new Promise((resolve, reject) => {
        const u = new URL(url);
        const mod = u.protocol === 'https:' ? https : http;
        const req = mod.request(u, {
          method: 'GET',
          headers: { 'user-agent': opts.userAgent, accept: 'text/html,application/xhtml+xml,application/xml,application/rss+xml,application/atom+xml,text/plain;q=0.8', 'accept-encoding': 'identity' },
          lookup: pinnedLookup(opts.address, opts.family, o.allowPrivateForTests),
          timeout: timeoutMs,
          // Sem pool keep-alive: cada requisição abre socket novo e passa pelo lookup fixado (um socket reaproveitado pularia a validação).
          agent: false,
        }, (res) => {
          const chunks: Buffer[] = []; let size = 0;
          res.on('data', (c: Buffer) => {
            size += c.length;
            if (size > maxBytes) { req.destroy(new Error('corpo excede o limite')); return; }
            chunks.push(c);
          });
          res.on('end', () => {
            const headers: Record<string, string> = {};
            for (const [k, v] of Object.entries(res.headers)) if (typeof v === 'string') headers[k.toLowerCase()] = v;
            resolve({ status: res.statusCode ?? 0, headers, body: Buffer.concat(chunks).toString('utf8') });
          });
        });
        req.on('timeout', () => req.destroy(new Error('timeout')));
        req.on('error', reject);
        req.end();
      });
    },
  };
}
