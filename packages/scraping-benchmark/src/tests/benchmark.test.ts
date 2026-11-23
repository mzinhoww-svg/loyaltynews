/** Testes de unidade e contrato do benchmark. Todas as respostas aqui são MOCK (simuladas) e marcadas como tal. */
import { describe, it, expect } from 'vitest';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ReaderPort, ReadResult, ReadRequest } from '@ln/intelligence';
import { createReader, ScrapflyReader } from '@ln/intelligence';
import { evaluate, titleSimilarity, sameDate, extractMeta, MIN_EDITORIAL_CHARS } from '../quality';
import { BudgetGuard } from '../budget';
import { AdaptiveRouter } from '../router';
import { computeMetrics, rank, percentile, projectMonthly } from '../metrics';
import { parseFeed, discoveryMetrics } from '../discovery';
import { ssrfCheck, isPrivateAddress, DirectReader, pinnedTransport, type Transport, type Resolver } from '../direct-reader';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { runBenchmark, loadDone, classify } from '../runner';
import { readFlags, isProviderDisabled } from '../flags';
import type { DatasetEntry } from '../types';

const LONG = 'Lorem ipsum dolor sit amet. '.repeat(60);
const article = (title: string, date = '2026-11-20T10:00:00Z') =>
  `<html lang="pt-BR"><head><meta property="og:title" content="${title}"><meta property="article:published_time" content="${date}"></head><body><h1>${title}</h1><p>${LONG}</p></body></html>`;

class MockReader implements ReaderPort {
  calls = 0;
  constructor(
    readonly provider: string,
    private readonly fn: (req: ReadRequest, n: number) => ReadResult,
  ) {}
  async read(req: ReadRequest) {
    return this.fn(req, ++this.calls);
  }
}
const ok = (provider: string, url: string, title = 'Azul anuncia nova rota para Lisboa', credits = 1): ReadResult => ({ ok: true, url, provider, creditsUsed: credits, httpStatus: 200, html: article(title), text: `${title}\n${LONG}` });

describe('flags', () => {
  it('todas desligadas por padrão; liga só com "true"', () => {
    expect(Object.values(readFlags({}))).toEqual([false, false, false, false]);
    expect(readFlags({ SCRAPING_SHADOW_MODE: '1' }).SCRAPING_SHADOW_MODE).toBe(false);
    expect(readFlags({ SCRAPING_SHADOW_MODE: 'true' }).SCRAPING_SHADOW_MODE).toBe(true);
    expect(isProviderDisabled('zyte-http', { SCRAPING_PROVIDER_ZYTE_HTTP_DISABLED: 'true' })).toBe(true);
  });
});

describe('qualidade editorial', () => {
  it('HTTP 200 com conteúdo curto NÃO é sucesso editorial', () => {
    const v = evaluate('Just a moment... checking your browser', '<html><title>Just a moment</title><div id="cf-chl">', 'Qualquer título', 200);
    expect(v.editorialSuccess).toBe(false);
    expect(v.reason).toBe('captcha');
  });
  it('paywall detectado pela guarda do Data', () => {
    const v = evaluate(`${LONG} Conteúdo exclusivo para assinantes`, undefined, 'x', 200);
    expect(v.reason).toBe('paywall');
  });
  it('artigo válido: título confere, metadados extraídos, só hash e trecho', () => {
    const v = evaluate(`Azul anuncia nova rota\n${LONG}`, article('Azul anuncia nova rota para Lisboa | Portal'), 'Azul anuncia nova rota para Lisboa', 200);
    expect(v.editorialSuccess).toBe(true);
    expect(v.meta.publishedAt).toBe('2026-11-20T10:00:00Z');
    expect(v.meta.language).toBe('pt-BR');
    expect(v.snippet!.length).toBeLessThanOrEqual(200);
    expect(v.contentHash).toMatch(/^[a-f0-9]{64}$/);
    expect(v.textLength).toBeGreaterThan(MIN_EDITORIAL_CHARS);
  });
  it('título de outra página = title_mismatch', () => {
    expect(evaluate(LONG, article('Página inicial do portal'), 'Azul anuncia nova rota para Lisboa').reason).toBe('title_mismatch');
  });
  it('similaridade, data e meta', () => {
    expect(titleSimilarity('Copom mantém Selic em 15%', 'Copom mantém a Selic em 15% - InfoMoney')).toBeGreaterThan(0.8);
    expect(sameDate('2026-11-20T23:00:00-03:00', 'Fri, 21 Nov 2026 01:00:00 GMT')).toBe(true);
    expect(sameDate(undefined, '2026-11-20')).toBeNull();
    expect(extractMeta('<script type="application/ld+json">{"headline":"H1 LD","datePublished":"2026-01-02"}</script>', undefined)).toMatchObject({ title: 'H1 LD', publishedAt: '2026-01-02' });
  });
});

describe('orçamento (corte automático)', () => {
  it('bloqueia sem confirmação e corta ao atingir o teto; persiste o livro', () => {
    const dir = mkdtempSync(join(tmpdir(), 'bench-'));
    const path = join(dir, 'ledger.json');
    const g = new BudgetGuard({ a: { provider: 'a', billing: 'free-confirmed', creditCap: 10, usdPerCredit: 0.001 }, b: { provider: 'b', billing: 'unconfirmed', creditCap: 10, usdPerCredit: 0 } }, path);
    expect(g.check('b', 1)).toEqual({ ok: false, reason: 'billing_unconfirmed' });
    expect(g.check('a', 5).ok).toBe(true);
    g.record('a', 8);
    expect(g.check('a', 5)).toEqual({ ok: false, reason: 'budget_blocked' });
    expect(new BudgetGuard({ a: { provider: 'a', billing: 'free-confirmed', creditCap: 10, usdPerCredit: 0 } }, path).used('a')).toBe(8);
    expect(g.estimateUsd('a', 8)).toBe(0.008);
  });
  it('saldo e teto por conta no livro (FinOps), com alerta', () => {
    const g = new BudgetGuard({ bd: { provider: 'bd', billing: 'free-confirmed', creditCap: 300, usdPerCredit: 0, account: 'conta-2', accountQuota: 5000, alertAt: 4 } });
    g.record('bd', 5);
    const s = g.snapshot();
    expect(s.limits!['bd|conta-2']).toMatchObject({ used: 5, benchCap: 300, benchRemaining: 295, accountQuota: 5000, accountRemainingKnownToBenchmark: 4995, alertAt: 4 });
    expect(s.alerts!.map((a) => a.key)).toEqual(['bd|conta-2']);
  });
});

describe('roteador com fallback', () => {
  const noSleep = { sleep: async () => {}, random: () => 0.5 };
  it('fallback em falha técnica e sucesso no próximo; cache e dedupe', async () => {
    const a = new MockReader('a', (r) => ({ ok: false, url: r.url, provider: 'a', failure: 'captcha_unsolved', creditsUsed: 1 }));
    const b = new MockReader('b', (r) => ok('b', r.url));
    const router = new AdaptiveRouter(
      [
        { name: 'a', reader: a, worstCaseCredits: 1, usdPerCredit: 0.0001 },
        { name: 'b', reader: b, worstCaseCredits: 1, usdPerCredit: 0.001 },
      ],
      { ...noSleep, env: {} },
    );
    const [r1, r2] = await Promise.all([router.route('https://x.com/n1'), router.route('https://x.com/n1')]);
    expect(r1.provider).toBe('b');
    expect(r2).toBe(r1); // mesma promessa: requisição duplicada evitada
    expect(r1.decisions.map((d) => d.step)).toEqual(['attempt', 'attempt', 'success']);
    const r3 = await router.route('https://x.com/n1');
    expect(r3.fromCache).toBe(true);
    expect(a.calls + b.calls).toBe(2);
  });
  it('login/paywall param sem fallback (DP-32)', async () => {
    const a = new MockReader('a', (r) => ({ ok: false, url: r.url, provider: 'a', failure: 'paywall' }));
    const b = new MockReader('b', (r) => ok('b', r.url));
    const router = new AdaptiveRouter([{ name: 'a', reader: a, worstCaseCredits: 0, usdPerCredit: 0 }, { name: 'b', reader: b, worstCaseCredits: 1, usdPerCredit: 1 }], { ...noSleep, env: {} });
    const r = await router.route('https://y.com/z');
    expect(r.decisions.at(-1)!.step).toBe('stop_restriction');
    expect(b.calls).toBe(0);
  });
  it('Retry-After curto é respeitado; longo pula para o próximo; provedor desligado é pulado', async () => {
    const waits: number[] = [];
    const a = new MockReader('a', (r, n) => (n === 1 ? { ok: false, url: r.url, provider: 'a', failure: 'rate_limited', retryAfterSeconds: 2 } : ok('a', r.url)));
    const off = new MockReader('off', (r) => ok('off', r.url));
    const router = new AdaptiveRouter([{ name: 'off', reader: off, worstCaseCredits: 0, usdPerCredit: 0 }, { name: 'a', reader: a, worstCaseCredits: 1, usdPerCredit: 0.001 }], {
      env: { SCRAPING_PROVIDER_OFF_DISABLED: 'true' },
      sleep: async (ms) => void waits.push(ms),
    });
    const r = await router.route('https://q.com/1');
    expect(r.provider).toBe('a');
    expect(waits).toEqual([2000]);
    expect(off.calls).toBe(0);
    const slow = new MockReader('s', (rq) => ({ ok: false, url: rq.url, provider: 's', failure: 'rate_limited', retryAfterSeconds: 3600 }));
    const r2 = await new AdaptiveRouter([{ name: 's', reader: slow, worstCaseCredits: 0, usdPerCredit: 0 }], { env: {}, sleep: async () => { throw new Error('não deveria esperar 1h'); } }).route('https://q.com/2');
    expect(r2.decisions.at(-1)!.step).toBe('exhausted');
  });
  it('circuit breaker abre após falhas seguidas e orçamento corta', async () => {
    let t = 0;
    const bad = new MockReader('bad', (r) => ({ ok: false, url: r.url, provider: 'bad', failure: 'provider_error' }));
    const router = new AdaptiveRouter([{ name: 'bad', reader: bad, worstCaseCredits: 0, usdPerCredit: 0 }], { env: {}, breakerThreshold: 2, now: () => t, sleep: async () => {} });
    await router.route('https://h.com/1');
    await router.route('https://h.com/2');
    const r = await router.route('https://h.com/3');
    expect(r.decisions.map((d) => d.step)).toContain('skip_circuit_open');
    expect(bad.calls).toBe(2);
    t += 11 * 60_000;
    await router.route('https://h.com/4');
    expect(bad.calls).toBe(3); // meio-aberto depois do cooldown
    const g = new BudgetGuard({ c: { provider: 'c', billing: 'free-confirmed', creditCap: 1, usdPerCredit: 0 } });
    g.record('c', 1);
    const c = new MockReader('c', (rq) => ok('c', rq.url));
    const r2 = await new AdaptiveRouter([{ name: 'c', reader: c, worstCaseCredits: 1, usdPerCredit: 0 }], { env: {}, budget: g }).route('https://h.com/5');
    expect(r2.decisions[0]!.step).toBe('skip_budget');
    expect(c.calls).toBe(0);
  });
  it('ordem segue o menor custo esperado por artigo válido, com estatística semeada', () => {
    const r = new AdaptiveRouter([
      { name: 'cheap-bad', reader: new MockReader('x', (q) => ok('x', q.url)), worstCaseCredits: 1, usdPerCredit: 0.0001 },
      { name: 'pricey-good', reader: new MockReader('y', (q) => ok('y', q.url)), worstCaseCredits: 1, usdPerCredit: 0.001 },
    ]);
    r.seed('d.com', 'cheap-bad', { attempts: 20, valid: 0, credits: 20 });
    r.seed('d.com', 'pricey-good', { attempts: 20, valid: 20, credits: 20 });
    expect(r.order('d.com')[0]!.name).toBe('pricey-good');
    expect(r.matrix(['d.com'])[0]!.order).toHaveLength(2);
  });
});

describe('descoberta', () => {
  it('RSS, Atom, sitemap e índice', () => {
    expect(parseFeed('<rss><channel><item><title><![CDATA[A &amp; B]]></title><link>https://a.com/1</link><pubDate>Fri, 21 Nov 2026 10:00:00 GMT</pubDate></item></channel></rss>').items[0]).toEqual({ url: 'https://a.com/1', title: 'A & B', publishedAt: '2026-11-21T10:00:00.000Z' });
    expect(parseFeed('<feed xmlns="http://www.w3.org/2005/Atom"><entry><title>T</title><link rel="alternate" href="https://b.com/x"/><updated>2026-11-01T00:00:00Z</updated></entry></feed>').kind).toBe('atom');
    expect(parseFeed('<urlset><url><loc>https://c.com/a</loc><news:news><news:title>N</news:title><news:publication_date>2026-11-02</news:publication_date></news:news></url></urlset>').items[0]!.title).toBe('N');
    expect(parseFeed('<sitemapindex><sitemap><loc>https://c.com/s1.xml</loc></sitemap></sitemapindex>').kind).toBe('sitemapindex');
  });
  it('métricas de descoberta contam duplicatas e frescor', () => {
    const m = discoveryMetrics('f', 'rss', [{ url: 'https://a.com/1?utm=x', title: 'a', publishedAt: '2026-11-22T00:00:00Z' }, { url: 'https://a.com/1/', title: 'a', publishedAt: '2026-01-01T00:00:00Z' }], 10, new Date('2026-11-23T00:00:00Z'));
    expect(m).toMatchObject({ items: 2, unique: 1, duplicates: 1, fresh7d: 1, costUsd: 0 });
  });
});

describe('leitor direto e SSRF', () => {
  it('recusa IP privado, protocolo, credencial e host interno', async () => {
    const pub = async () => ['93.184.216.34'];
    expect(await ssrfCheck('http://127.0.0.1/', pub)).toBe('ip_privado');
    expect(await ssrfCheck('http://169.254.169.254/latest/meta-data', pub)).toBe('ip_privado');
    expect(await ssrfCheck('file:///etc/passwd', pub)).toBe('protocolo');
    expect(await ssrfCheck('https://u:p@a.com/', pub)).toBe('credencial_na_url');
    expect(await ssrfCheck('http://localhost:3000/', pub)).toBe('host_interno');
    expect(await ssrfCheck('https://evil.com/', async () => ['10.0.0.5'])).toBe('ip_privado');
    expect(await ssrfCheck('https://ok.com/', pub)).toBeNull();
    expect(isPrivateAddress('::ffff:192.168.0.1')).toBe(true);
  });
  it('redirect para rede interna é bloqueado (MOCK de transporte)', async () => {
    const t: Transport = async (u) => (u.startsWith('https://pub.com') ? { status: 302, headers: { location: 'http://10.1.1.1/admin' } as Record<string, string>, body: Buffer.from('') } : { status: 200, headers: {} as Record<string, string>, body: Buffer.from('x') });
    const r = await new DirectReader(t, async (h) => (h === 'pub.com' ? ['8.8.8.8'] : ['10.1.1.1'])).read({ url: 'https://pub.com/a' });
    expect(r.ok).toBe(false);
    expect((r as { ssrf?: string }).ssrf).toBe('ip_privado');
  });
  it('DNS rebinding: resolve UMA vez por salto e conecta no IP validado, mesmo se o DNS mudar depois', async () => {
    let calls = 0;
    const rebinding: Resolver = async () => (++calls === 1 ? ['93.184.216.34'] : ['127.0.0.1']); // 2ª resposta seria interna
    const pinned: string[] = [];
    const t: Transport = async (_u, ip) => {
      pinned.push(ip);
      await rebinding('evil.com'); // um atacante "troca" o DNS durante a conexão: não pode afetar o IP usado
      return { status: 200, headers: {}, body: Buffer.from('<title>ok</title>') };
    };
    const r = await new DirectReader(t, rebinding).read({ url: 'https://evil.com/x' });
    expect(r.ok).toBe(true);
    expect(pinned).toEqual(['93.184.216.34']);
    expect(calls).toBe(2); // 1 da validação + 1 do "atacante"; o leitor não resolveu de novo
  });
  it('pinnedTransport conecta no IP fixado sem consultar o DNS (servidor local real)', async () => {
    const srv = createServer((_q, s) => s.end('pinned-ok'));
    await new Promise<void>((ok) => srv.listen(0, '127.0.0.1', () => ok()));
    const port = (srv.address() as AddressInfo).port;
    try {
      // host inexistente: só funciona se o socket usar o IP fixado em vez de resolver o nome
      const r = await pinnedTransport(`http://nao-existe.invalid:${port}/`, '127.0.0.1', 5000);
      expect(r.status).toBe(200);
      expect(r.body.toString()).toBe('pinned-ok');
    } finally {
      srv.close();
    }
  });
});

describe('contrato dos adaptadores do Data (via ReaderPort, MOCK de fetch)', () => {
  it('Scrapfly: custo real do cabeçalho vira creditsUsed; segredo nunca aparece no resultado', async () => {
    const f = (async () => new Response(JSON.stringify({ result: { content: article('Título X'), status_code: 200 } }), { status: 200, headers: { 'x-scrapfly-api-cost': '1' } })) as unknown as typeof fetch;
    const reader = createReader({ keyed: new ScrapflyReader('basic', f), keys: [{ label: 'conta-1', secretRef: 'K', monthlyCreditCap: 900 }], resolveSecret: () => 'SEGREDO-NAO-PODE-VAZAR' }, { enabled: true, pace: false });
    const r = await reader.read({ url: 'https://a.com/x' });
    expect(r).toMatchObject({ ok: true, creditsUsed: 1, keyLabel: 'conta-1' });
    expect(JSON.stringify({ ...r, text: undefined, html: undefined })).not.toContain('SEGREDO');
  });
});

describe('runner (respostas MOCK)', () => {
  const ds: DatasetEntry[] = [1, 2].map((i) => ({ id: `u00${i}`, url: `https://news${i}.com/a`, domain: `news${i}.com`, category: 'financeiro', recency: 'recente', country: 'BR', language: 'pt', publishedAt: '2026-11-20T10:00:00Z', contentType: 'noticia', difficulty: 'baixa', discoveryMethod: 'rss', discoverySource: 'f', accessCondition: 'publico', paywall: false, needsJs: null, errorHistory: null, referenceTitle: 'Azul anuncia nova rota para Lisboa' }));
  it('registra cada tentativa sem texto integral, marca mock, respeita orçamento e retoma do checkpoint', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'run-'));
    const out = join(dir, 'attempts.jsonl');
    const g = new BudgetGuard({ p: { provider: 'p', billing: 'free-confirmed', creditCap: 1, usdPerCredit: 0.002 } });
    const p = new MockReader('p', (r) => ok('p', r.url));
    const opts = { experimentId: 'e', runId: 'r', codeVersion: 'test', outPath: out, budget: g, minSecondsPerHost: 0 };
    const recs = await runBenchmark(ds, [{ name: 'p', reader: p, worstCaseCredits: 1, mock: true }], opts);
    expect(recs.map((r) => r.errorClass)).toEqual(['none', 'budget_blocked']);
    expect(recs[0]).toMatchObject({ mock: true, editorialSuccess: true, dateMatch: true, costEstimatedUsd: 0.002 });
    const line = readFileSync(out, 'utf8');
    expect(line).not.toContain('Lorem ipsum dolor sit amet. Lorem ipsum dolor sit amet. Lorem ipsum dolor sit amet. Lorem ipsum dolor sit amet. Lorem ipsum dolor sit amet. Lorem ipsum dolor sit amet. Lorem ipsum dolor sit amet. Lorem');
    expect(loadDone(out).size).toBe(1); // o bloqueado por orçamento será refeito
    await runBenchmark(ds, [{ name: 'p', reader: p, worstCaseCredits: 1, mock: true }], opts);
    expect(p.calls).toBe(1); // checkpoint: não repete a URL já feita
  });
  it('classificação de erros', () => {
    expect(classify({ ok: false, url: '', provider: 'x', failure: 'provider_error', httpStatus: 403 }, 'ok')).toBe('http_403');
    expect(classify({ ok: true, url: '', provider: 'x' }, 'empty_content')).toBe('empty_content');
  });
});

describe('métricas e ranking', () => {
  it('percentis, exclusão de mock, ranking e projeção', () => {
    expect(percentile([1, 2, 3, 4, 100], 50)).toBe(3);
    expect(percentile([1, 2, 3, 4, 100], 99)).toBe(100);
    const base = { experimentId: 'e', runId: 'r', correlationId: 'c', codeVersion: 'v', at: '2026-11-23T00:00:00Z', urlId: 'u', url: 'u', domain: 'd', retries: 0, cacheState: 'miss' as const, costEffectiveUsd: null, textLength: 2000, titleMatch: 1, sourceMatch: true, dateMatch: true, publishedAt: '2026-11-22T00:00:00Z' };
    const recs = [
      { ...base, provider: 'A', durationMs: 1000, technicalSuccess: true, editorialSuccess: true, errorClass: 'none' as const, creditsUsed: 1, costEstimatedUsd: 0.001, mock: false },
      { ...base, provider: 'B', durationMs: 4000, technicalSuccess: true, editorialSuccess: true, errorClass: 'none' as const, creditsUsed: 1, costEstimatedUsd: 0.01, mock: false },
      { ...base, provider: 'M', durationMs: 1, technicalSuccess: true, editorialSuccess: true, errorClass: 'none' as const, creditsUsed: 0, costEstimatedUsd: 0, mock: true },
    ];
    const ms = computeMetrics(recs);
    expect(ms.map((m) => m.provider).sort()).toEqual(['A', 'B']);
    const rk = rank(ms);
    expect(rk[0]!.provider).toBe('A');
    expect(rk[0]!.lowSample).toBe(true);
    expect(projectMonthly(0.002)).toEqual({ '1000': 2, '10000': 20, '50000': 100, '100000': 200 });
  });
});
