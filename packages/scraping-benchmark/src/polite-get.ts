/**
 * GET direto dos scripts de medição (feeds, sitemaps, listagens), com a ADR-007: robots.txt conferido a cada salto (proíbe ou ilegível =
 * não baixa), no máximo 5 redirects e página de desafio/CAPTCHA descartada. `status` 0 + `err` = não baixado ou falha de rede.
 */
import { challengeReason, createRobotsGate, stripHtml, type RobotsGate } from '@ln/intelligence';

export interface PoliteResponse { status: number; body: Buffer; err?: string }

export async function politeGet(url: string, o: { userAgent: string; accept?: string; fetchImpl?: typeof fetch; robots?: RobotsGate; timeoutMs?: number }): Promise<PoliteResponse> {
  const fetchImpl = o.fetchImpl ?? fetch;
  const robots = o.robots ?? createRobotsGate(fetchImpl, o.userAgent);
  const refused = (err: string, status = 0): PoliteResponse => ({ status, body: Buffer.alloc(0), err });
  try {
    for (let hop = 0, cur = url; hop <= 5; hop++) {
      const v = await robots(cur);
      if (!v.allowed) return refused(v.unavailable ? 'robots_unavailable' : 'robots_disallow');
      const r = await fetchImpl(cur, { headers: { 'user-agent': o.userAgent, ...(o.accept ? { accept: o.accept } : {}) }, redirect: 'manual', signal: AbortSignal.timeout(o.timeoutMs ?? 30_000) });
      const location = r.headers.get('location');
      if (r.status >= 300 && r.status < 400 && location) { cur = new URL(location, cur).toString(); continue; }
      const body = Buffer.from(await r.arrayBuffer());
      const html = body.toString('utf8');
      if (challengeReason({ status: r.status, headers: Object.fromEntries(r.headers.entries()), html, text: stripHtml(html) })) return refused('captcha', r.status);
      return { status: r.status, body };
    }
    return refused('redirects_demais');
  } catch (e) {
    return refused(String((e as Error).message ?? e).slice(0, 120));
  }
}
