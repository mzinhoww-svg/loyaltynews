import { test } from 'vitest';
import assert from 'node:assert/strict';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { Collector } from '../collector/collector';
import { isPublicIp, resolvePublic } from '../collector/net';
import { createNodeFetcher, pinnedLookup } from '../collector/http-fetcher';
import { UrlRejected } from '../collector/ssrf';
import { FakeResolver, MOCK_PUBLIC_IP, MOCK_SOURCE, MockFetcher } from '../../fixtures/mock-web.mock';

const fixedNow = () => new Date('2026-11-23T12:00:00Z');
const HOST = 'ri.mock.example';
const ROBOTS = 'User-agent: *\nDisallow:';
const PAGE = '<html><body><article><h1>MOCK</h1><p>Texto fictício de teste da coleta.</p></article></body></html>';

test('isPublicIp: públicos passam; privados, loopback, link-local, metadata, mapeados e embutidos não', () => {
  for (const ip of ['8.8.8.8', '1.1.1.1', '93.184.216.34', '2606:4700:4700::1111', '2001:4860:4860::8888', '::ffff:8.8.8.8']) assert.equal(isPublicIp(ip), true, ip);
  const non = [
    '0.0.0.0', '127.0.0.1', '127.255.255.255', '10.0.0.1', '172.16.0.1', '172.31.255.255', '192.168.0.1', '169.254.169.254', '169.254.0.1',
    '100.64.0.1', '192.0.0.1', '192.0.2.1', '198.18.0.1', '198.51.100.1', '203.0.113.9', '224.0.0.1', '240.0.0.1', '255.255.255.255',
    '::', '::1', 'fc00::1', 'fd12:3456::1', 'fe80::1', 'fec0::1', 'ff02::1', '2001:db8::1', '2001:0:4136:e378:8000:63bf:3fff:fdd2',
    '::ffff:127.0.0.1', '::ffff:7f00:1', '::ffff:169.254.169.254', '::ffff:a9fe:a9fe', '::ffff:10.0.0.1',
    '64:ff9b::7f00:1', '64:ff9b::a9fe:a9fe', '2002:7f00:1::', '2002:a9fe:a9fe::1', '::127.0.0.1',
    'not-an-ip', '', '999.1.1.1', '1.2.3', '2130706433', '0x7f.0.0.1',
  ];
  for (const ip of non) assert.equal(isPublicIp(ip), false, ip);
});

test('resolvePublic: todos os IPs precisam ser públicos; misto, vazio e erro de DNS são recusados', async () => {
  const r = new FakeResolver({ ok: [['8.8.8.8', '2606:4700:4700::1111']], mix: [['8.8.8.8', '10.0.0.5']], empty: [[]] });
  const okRes = await resolvePublic('ok', r);
  assert.equal(okRes.pinned.address, '8.8.8.8');
  assert.equal(okRes.all.length, 2);
  await assert.rejects(resolvePublic('mix', r), (e: unknown) => e instanceof UrlRejected && e.code === 'private_resolved_ip');
  await assert.rejects(resolvePublic('empty', r), (e: unknown) => e instanceof UrlRejected && e.code === 'dns_failure');
  await assert.rejects(resolvePublic('naoexiste', r), (e: unknown) => e instanceof UrlRejected && e.code === 'dns_failure');
});

test('DNS rebinding: público na 1ª consulta, privado na 2ª => a 2ª requisição é recusada e nunca é enviada', async () => {
  const resolver = new FakeResolver({ [HOST]: [[MOCK_PUBLIC_IP], ['169.254.169.254']] });
  const f = new MockFetcher({
    [`https://${HOST}/robots.txt`]: ROBOTS,
    [`https://${HOST}/noticias/a`]: PAGE,
  });
  const r = await new Collector(f, { now: fixedNow, resolver }).collectUrl(MOCK_SOURCE, `https://${HOST}/noticias/a`);
  assert.equal(r.skip?.code, 'url_rejected');
  assert.match(r.skip!.detail, /não público|169\.254\.169\.254/);
  assert.deepEqual(f.calls, [`https://${HOST}/robots.txt`], 'a página nunca foi requisitada');
  assert.equal(resolver.calls.length, 2);
});

test('pinning: cada requisição conecta no IP validado e há exatamente uma resolução por requisição enviada', async () => {
  // Se o Fetcher re-resolvesse, receberia outro conjunto. O coletor entrega o IP já validado e não resolve de novo.
  const resolver = new FakeResolver({ [HOST]: [[MOCK_PUBLIC_IP]] });
  const f = new MockFetcher({ [`https://${HOST}/robots.txt`]: ROBOTS, [`https://${HOST}/noticias/a`]: PAGE });
  const r = await new Collector(f, { now: fixedNow, resolver }).collectUrl(MOCK_SOURCE, `https://${HOST}/noticias/a`);
  assert.ok(r.evidence);
  assert.equal(f.connects.length, 2);
  assert.ok(f.connects.every((c) => c.address === MOCK_PUBLIC_IP));
  assert.equal(resolver.calls.length, f.calls.length);
});

test('redirecionamento revalida o destino: salto que passa a resolver para IP privado é recusado', async () => {
  const resolver = new FakeResolver({ [HOST]: [[MOCK_PUBLIC_IP], [MOCK_PUBLIC_IP], ['127.0.0.1']] });
  const f = new MockFetcher({
    [`https://${HOST}/robots.txt`]: ROBOTS,
    [`https://${HOST}/noticias/r`]: { status: 302, headers: { location: '/noticias/destino' }, body: '' },
    [`https://${HOST}/noticias/destino`]: PAGE,
  });
  const r = await new Collector(f, { now: fixedNow, resolver }).collectUrl(MOCK_SOURCE, `https://${HOST}/noticias/r`);
  assert.equal(r.skip?.code, 'url_rejected');
  assert.ok(!f.calls.includes(`https://${HOST}/noticias/destino`), 'destino do redirecionamento não foi requisitado');
});

test('resolvedor devolvendo IPv6 equivalentes a privado/loopback/metadata é recusado', async () => {
  for (const ip of ['::1', '::ffff:127.0.0.1', '::ffff:a9fe:a9fe', 'fd00::1', 'fe80::1']) {
    const f = new MockFetcher({ [`https://${HOST}/robots.txt`]: ROBOTS, [`https://${HOST}/noticias/a`]: PAGE });
    const r = await new Collector(f, { resolver: new FakeResolver({ [HOST]: [[ip]] }) }).collectUrl(MOCK_SOURCE, `https://${HOST}/noticias/a`);
    assert.ok(r.skip, ip);
    assert.equal(f.calls.length, 0, `${ip}: nenhuma requisição enviada`);
  }
});

test('pinnedLookup: devolve sempre o IP fixado, ignora o hostname e recusa IP não público', async () => {
  const run = (look: ReturnType<typeof pinnedLookup>, all: boolean) => new Promise<unknown>((resolve) => {
    (look as unknown as (h: string, o: object, cb: (...a: unknown[]) => void) => void)('qualquer.example', all ? { all: true } : {}, (...args) => resolve(args));
  });
  assert.deepEqual(await run(pinnedLookup('8.8.8.8', 4), false), [null, '8.8.8.8', 4]);
  assert.deepEqual(await run(pinnedLookup('8.8.8.8', 4), true), [null, [{ address: '8.8.8.8', family: 4 }]]);
  const bad = (await run(pinnedLookup('169.254.169.254', 4), false)) as [Error];
  assert.equal((bad[0] as Error & { code?: string }).code, 'EPRIVATE');
});

test('fetcher real: conecta no IP fixado mesmo com hostname que o DNS não resolve; sem o IP validado, não conecta', async () => {
  const seen: Array<string | undefined> = [];
  const server = http.createServer((req, res) => { seen.push(req.headers.host); res.writeHead(200, { 'content-type': 'text/plain' }); res.end('ok-mock'); });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const port = (server.address() as AddressInfo).port;
  try {
    const url = `http://rebind-mock.invalid:${port}/x`; // .invalid nunca resolve no DNS
    const testFetcher = createNodeFetcher({ allowPrivateForTests: true });
    const r = await testFetcher.get(url, { userAgent: 'test', address: '127.0.0.1', family: 4 });
    assert.equal(r.status, 200);
    assert.equal(r.body, 'ok-mock');
    assert.equal(seen[0], `rebind-mock.invalid:${port}`, 'Host original preservado');
    // produção (sem a opção de teste): IP privado fixado é recusado antes de abrir o socket
    await assert.rejects(createNodeFetcher().get(url, { userAgent: 'test', address: '127.0.0.1', family: 4 }));
    assert.equal(seen.length, 1, 'o servidor local não recebeu a 2ª requisição');
  } finally {
    await new Promise<void>((r) => server.close(() => r()));
  }
});
