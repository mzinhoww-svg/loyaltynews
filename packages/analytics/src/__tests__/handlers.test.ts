import { beforeEach, describe, test } from 'vitest';
import assert from 'node:assert/strict';
import type { ApiError } from '@ln/contracts';
import { InMemoryAggregateStore, type AnalyticsReport } from '../aggregate';
import { ANALYTICS_PERMISSIONS, getAnalyticsReport, handleCollect, MAX_BODY_BYTES, type AnalyticsDeps, type AnalyticsFlags } from '../handlers';
import { buildCollectPayload, shouldSend } from '../client';

const isErr = (b: unknown): b is ApiError => typeof b === 'object' && b !== null && 'error' in b;
const code = (b: unknown) => (isErr(b) ? b.error.code : undefined);

let flags: AnalyticsFlags;
let version: string | null;
let store: InMemoryAggregateStore;
let deps: AnalyticsDeps;
const READER = { id: 'u', permissions: [ANALYTICS_PERMISSIONS.read] };

beforeEach(() => {
  flags = { analytics: true };
  version = '2026-11-v1';
  store = new InMemoryAggregateStore();
  deps = { store, flags: () => flags, policy: () => ({ currentVersion: version }), now: () => new Date('2026-11-23T15:00:00Z'), ownHosts: ['loyaltynews.com.br'] };
});

const collect = (obj: unknown, signals?: { gpc?: boolean; dnt?: boolean }) => handleCollect(deps, { body: typeof obj === 'string' ? obj : JSON.stringify(obj), signals });
const stored = () => store.rows('2000-01-01', '2100-01-01');

describe('coleta: desligada por padrão e falha fechada', () => {
  test('flag desligada: 404 e NENHUM efeito; o padrão de @ln/contracts é desligado', async () => {
    const { FLAG_DEFAULTS } = await import('@ln/contracts');
    assert.equal(FLAG_DEFAULTS.analytics, false);
    flags = { analytics: false };
    const r = await collect({ t: 'pageview', path: '/' });
    assert.equal(r.status, 404);
    assert.equal(code(r.body), 'ANALYTICS_OFF');
    assert.equal((await stored()).length, 0);
  });

  test('sem política de privacidade publicada: 503 e nenhum efeito', async () => {
    version = null;
    const r = await collect({ t: 'pageview', path: '/' });
    assert.equal(r.status, 503);
    assert.equal(code(r.body), 'POLICY_UNPUBLISHED');
    assert.equal((await stored()).length, 0);
  });

  test('GPC ou DNT: 204 "não contado" e nenhum efeito', async () => {
    for (const signals of [{ gpc: true }, { dnt: true }, { gpc: true, dnt: true }]) {
      const r = await collect({ t: 'pageview', path: '/materia/a' }, signals);
      assert.equal(r.status, 204);
      assert.deepEqual(r.body, { counted: false, reason: 'sinal_de_privacidade' });
    }
    assert.equal((await stored()).length, 0);
    assert.equal((await collect({ t: 'pageview', path: '/materia/a' }, { gpc: false, dnt: false })).status, 204);
    assert.equal((await stored()).length, 1);
  });
});

describe('coleta: o que entra e o que nunca entra', () => {
  test('conta uma visualização e guarda só dia, caminho normalizado, categoria de origem e classe de dispositivo', async () => {
    const r = await collect({ t: 'pageview', path: '/Materia/Regra-X?utm_source=linkedin&email=a@b.com#x', ref: 'https://www.linkedin.com/feed/update/urn:li:activity:123', w: 390 });
    assert.deepEqual([r.status, r.body], [204, { counted: true }]);
    const rows = await stored();
    assert.deepEqual(rows, [{ day: '2026-11-23', path: '/materia/regra-x', ref: 'social', device: 'mobile', views: 1 }]);
    const flat = JSON.stringify(rows);
    for (const leak of ['a@b.com', 'email', 'utm_source', 'linkedin', 'urn:li', '390', 'feed']) assert.equal(flat.includes(leak), false, leak);
  });

  test('e-mail, nome, token, IP, cookie e user agent no corpo: recusados com 400, sem ecoar o valor e sem efeito', async () => {
    const secrets = ['joao.silva@exemplo.com', 'Maria Souza', 'tok_live_ABC123SECRET', '200.100.50.25', 'session=abcdef', 'Mozilla/5.0 (X11)'];
    for (const [field, value] of [['email', secrets[0]], ['nome', secrets[1]], ['token', secrets[2]], ['ip', secrets[3]], ['cookie', secrets[4]], ['userAgent', secrets[5]]] as const) {
      const r = await collect({ t: 'pageview', path: '/', [field]: value });
      assert.equal(r.status, 400, field);
      assert.equal(code(r.body), 'VALIDATION_ERROR');
      const out = JSON.stringify(r.body);
      for (const s of secrets) assert.equal(out.includes(s), false, `${field}: a resposta ecoou ${s}`);
    }
    assert.equal((await stored()).length, 0);
  });

  test('PII dentro do caminho (e-mail, CPF, token) é neutralizada, não guardada', async () => {
    await collect({ t: 'pageview', path: '/perfil/joao@exemplo.com' });
    await collect({ t: 'pageview', path: '/cliente/12345678901/extrato' });
    await collect({ t: 'pageview', path: '/s/3f2504e0-4f89-11d3-9a0c-0305e82c3301' });
    const flat = JSON.stringify(await stored());
    for (const leak of ['joao', 'exemplo.com', '12345678901', '3f2504e0']) assert.equal(flat.includes(leak), false, leak);
    assert.ok(flat.includes(':id'));
  });

  test('corpo inválido: JSON quebrado 400; grande demais 413; caminho inutilizável 400; nada guardado', async () => {
    assert.equal((await collect('{nao json')).status, 400);
    const big = await collect(JSON.stringify({ t: 'pageview', path: '/', ref: 'x'.repeat(MAX_BODY_BYTES) }));
    assert.equal(big.status, 413);
    assert.equal((await collect({ t: 'pageview', path: '//evil.example/x' })).status, 400);
    assert.equal((await collect({ t: 'pageview', path: 'sem-barra' })).status, 400);
    assert.equal((await stored()).length, 0);
  });

  test('a assinatura da coleta não recebe IP, cabeçalhos nem cookies: só corpo e dois booleanos', () => {
    const src = handleCollect.toString();
    assert.ok(handleCollect.length <= 2);
    assert.doesNotMatch(src, /headers|cookie|remoteAddress|x-forwarded-for|user-agent/i);
  });

  test('o cliente monta o corpo mínimo: descarta query/hash do caminho, não lê cookie nem armazenamento, respeita GPC/DNT', () => {
    assert.deepEqual(buildCollectPayload({ pathname: '/materia/a?x=1#y', referrer: 'https://www.google.com/', innerWidth: 1280.4 }), { t: 'pageview', path: '/materia/a', ref: 'https://www.google.com/', w: 1280 });
    assert.deepEqual(buildCollectPayload({ pathname: '/' }), { t: 'pageview', path: '/' });
    assert.equal(shouldSend({ gpc: true }), false);
    assert.equal(shouldSend({ dnt: true }), false);
    assert.equal(shouldSend({}), true);
  });
});

describe('relatório', () => {
  const q = { from: '2026-11-01', to: '2026-11-30' };

  test('sem permissão: 403; consulta inválida, invertida ou longa: 400', async () => {
    assert.equal((await getAnalyticsReport(deps, { id: 'x', permissions: [] }, q)).status, 403);
    for (const bad of [{}, { from: '2026-11-01' }, { from: '01/11/2026', to: '2026-11-30' }, { from: '2026-11-30', to: '2026-11-01' }, { from: '2024-01-01', to: '2026-11-30' }]) {
      assert.equal((await getAnalyticsReport(deps, READER, bad)).status, 400, JSON.stringify(bad));
    }
  });

  test('sem nenhuma coleta: indisponível, total null (nunca zero)', async () => {
    const r = await getAnalyticsReport(deps, READER, q);
    const rep = r.body as AnalyticsReport;
    assert.deepEqual([r.status, rep.status, rep.totalViews], [200, 'unavailable', null]);
  });

  test('flag desligada: indisponível com o motivo, mesmo havendo agregados antigos', async () => {
    await collect({ t: 'pageview', path: '/materia/a' });
    flags = { analytics: false };
    const rep = (await getAnalyticsReport(deps, READER, q)).body as AnalyticsReport;
    assert.deepEqual([rep.status, rep.totalViews, rep.reason], ['unavailable', null, 'coleta desligada (flag)']);
  });

  test('fluxo completo: 7 visualizações e 3 de outra origem; células pequenas suprimidas, total exato, com período e horário', async () => {
    for (let i = 0; i < 7; i++) await collect({ t: 'pageview', path: '/materia/a', ref: 'https://www.google.com/', w: 1400 });
    for (let i = 0; i < 3; i++) await collect({ t: 'pageview', path: '/materia/b', ref: 'https://x.com/a/status/1', w: 390 });
    const r = await getAnalyticsReport(deps, READER, q);
    const rep = r.body as AnalyticsReport;
    assert.equal(rep.status, 'available');
    assert.equal(rep.totalViews, 10);
    assert.deepEqual(rep.topPaths, [{ key: '/materia/a', views: 7 }]);
    assert.deepEqual(rep.referrers, [{ key: 'busca', views: 7 }]);
    assert.equal(rep.suppressedViews, 3);
    assert.deepEqual([rep.period_start, rep.period_end, rep.fetched_at], ['2026-11-01', '2026-11-30', '2026-11-23T15:00:00.000Z']);
  });
});
