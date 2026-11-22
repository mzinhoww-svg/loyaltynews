import { test } from 'vitest';
import assert from 'node:assert/strict';
import { SEED_SOURCES } from '../sources/seed';
import { SHARED_HOSTS, SourceRegistry, eligibility } from '../sources/registry';
import { assertAllowedUrl } from '../collector/ssrf';
import { EDITORIAS } from '../types';

const reg = new SourceRegistry(SEED_SOURCES);
const usable = (id: string) => reg.get(id)!.verification?.level !== 'inacessivel';

test('seed: nenhuma fonte habilitada; pesquisa não aprova uso (todas inelegíveis até revisão QA)', () => {
  assert.ok(SEED_SOURCES.length >= 30);
  for (const s of SEED_SOURCES) {
    assert.equal(s.enabled, false, s.id);
    assert.equal(s.termsStatus, 'pending', s.id);
    assert.equal(s.urlVerified, false, s.id);
    assert.equal(s.imageRights, null, `${s.id}: nenhuma base de direito de imagem registrada`);
    assert.equal(eligibility(s).ok, false, s.id);
  }
  assert.equal(reg.collectable().length, 0);
});

test('seed: pelo menos 3 fontes utilizáveis (lidas/parciais, não inacessíveis) por editoria', () => {
  for (const e of EDITORIAS) {
    const n = reg.byEditoria(e).filter((s) => usable(s.id)).length;
    assert.ok(n >= 3, `${e}: apenas ${n}`);
  }
});

test('seed: toda fonte tem verificação registrada, ids únicos e hosts compartilhados com prefixo', () => {
  const ids = new Set<string>();
  for (const s of SEED_SOURCES) {
    assert.ok(!ids.has(s.id), `id duplicado ${s.id}`); ids.add(s.id);
    assert.ok(s.verification, `${s.id} sem verification`);
    assert.ok(['lido', 'parcial', 'inacessivel'].includes(s.verification.level));
    if (SHARED_HOSTS.includes(s.host)) assert.ok(s.pathPrefix, `${s.id}: host compartilhado sem prefixo`);
    if (s.verification.level === 'inacessivel') assert.equal(s.feedUrl, null, `${s.id}: inacessível não pode ter feed`);
  }
});

test('seed: listingUrl e feedUrl (quando existem) passam no mesmo validador do coletor (host + prefixo)', () => {
  for (const s of SEED_SOURCES) {
    for (const u of [s.listingUrl, s.feedUrl]) {
      if (u) assert.doesNotThrow(() => assertAllowedUrl(u, [s.host], s.pathPrefix), `${s.id}: ${u}`);
    }
  }
});

test('seed: correções registradas da pesquisa (LATAM host real; GOL sem feed 404; Senacon sob /mj)', () => {
  assert.equal(reg.get('latam-ir')?.host, 'ir.latam.com');
  assert.equal(reg.get('gol-ri')?.feedUrl, null);
  assert.equal(reg.get('senacon')?.pathPrefix, '/mj');
  assert.equal(reg.get('anpd')?.pathPrefix, '/anpd');
  assert.equal(reg.get('cvm')?.pathPrefix, '/cvm');
  for (const id of ['magalu-ri', 'itau-ri', 'santander-ri', 'livelo-imprensa', 'star-alliance', 'ico-uk']) assert.equal(reg.get(id)?.verification?.level, 'inacessivel', id);
});
