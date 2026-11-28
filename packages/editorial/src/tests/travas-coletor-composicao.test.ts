// Junção da ADR-007 (robots.txt antes da leitura via serviço) com as travas do coletor (DP-69): as duas valem nesse caminho.
import { test } from 'vitest';
import assert from 'node:assert/strict';
import { Collector } from '../collector/collector';
import { SEED_SOURCES } from '../sources/seed';
import { ACESSO_VIA_PROVEDOR, type Source } from '../types';
import { FakeResolver, MockFetcher, MOCK_PUBLIC_IP } from '../../fixtures/mock-web.mock';

const HOST = 'www.camara.leg.br';
const URL_ITEM = `https://${HOST}/noticias/1-materia-mock`;
const fonte: Source = { ...SEED_SOURCES.find((s) => s.id === 'camara-noticias')!, enabled: true, termsStatus: 'approved', urlVerified: true, paywall: 'none', acesso: ACESSO_VIA_PROVEDOR };

function montar(over: Record<string, unknown>) {
  const fetcher = new MockFetcher({ [`https://${HOST}/robots.txt`]: { status: 200, headers: { 'content-type': 'text/plain' }, body: 'User-agent: *\nAllow: /\n' } });
  let leituras = 0;
  const reader = { read: async () => { leituras += 1; throw new Error('o serviço não podia ser chamado'); } };
  const c = new Collector(fetcher, { sleep: async () => {}, minSpacingMs: 0, resolver: new FakeResolver({ [HOST]: [[MOCK_PUBLIC_IP]] }), flags: { editorialCollector: true }, reader: reader as never, ...over });
  return { c, fetcher, leituras: () => leituras };
}

test('teto por hora esgotado: a leitura via serviço vira motivo rate_limited, sem erro solto, sem robots e sem chamar o serviço', async () => {
  const m = montar({ hostBudget: { reserve: async () => ({ allowed: false, used: 1, waitMs: 0 }) } });
  const r = await m.c.collectUrl(fonte, URL_ITEM);
  assert.equal(r.skip?.code, 'rate_limited', JSON.stringify(r));
  assert.deepEqual([m.fetcher.calls.length, m.leituras()], [0, 0]);
});

test('fonte fora da lista permitida: a leitura via serviço é recusada antes de qualquer requisição', async () => {
  const m = montar({ allowlist: { decisionId: 'DP-69', decidedOn: '2026-11-28', sources: [] } });
  const r = await m.c.collectUrl(fonte, URL_ITEM);
  assert.equal(r.skip?.code, 'source_not_allowed', JSON.stringify(r));
  assert.deepEqual([m.fetcher.calls.length, m.leituras()], [0, 0]);
});
