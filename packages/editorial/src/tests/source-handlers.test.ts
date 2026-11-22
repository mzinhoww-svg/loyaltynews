import { test } from 'vitest';
import assert from 'node:assert/strict';
import { SourceRegistry } from '../sources/registry';
import { SEED_SOURCES } from '../sources/seed';
import { effectiveSource, resolveEffectiveSources, sourceFingerprint } from '../sources/state';
import { InMemoryEditorialStore } from '../api/store';
import type { Actor, HandlerCtx } from '../api/handlers';
import { listSources, reviewSource, setSourceEnabled } from '../api/source-handlers';
import type { SourceView } from '../api/source-handlers';
import { MOCK_SOURCE } from '../../fixtures/mock-web.mock';

const NOW = new Date('2026-11-25T10:00:00Z');
const user = (id: string, roles: string[], mfa = true): Actor => ({ userId: id, roles, mfa });
const chefe = user('maria-chefe', ['editor_chefe']); const admin = user('joao-admin', ['admin']); const revisor = user('ana-revisora', ['revisor']);
const researcher = user('ln-editorial-engineer', ['admin']); // mesma identidade que pesquisou a fonte
const mk = (actor: Actor | null, store: InMemoryEditorialStore, sources = new SourceRegistry(SEED_SOURCES)): HandlerCtx =>
  ({ actor, store, sources, now: () => NOW, newId: () => 'id' });
const REVIEW = { sourceId: 'bcb', termsStatus: 'approved', termsNote: 'Termos oficiais lidos na página do BC; reuso editorial por citação e link.', urlVerified: true, robotsChecked: true, paywall: 'none' } as const;
const body = (r: { body: unknown }) => r.body as SourceView;

test('cadastro nasce 100% desabilitado; sem revisão nada é elegível (nunca automático)', async () => {
  const store = new InMemoryEditorialStore();
  const r = await listSources(mk(chefe, store), {});
  assert.equal(r.status, 200);
  const items = (r.body as { items: SourceView[] }).items;
  assert.ok(items.length >= 30);
  assert.ok(items.every((i) => !i.habilitada && !i.elegivel && i.revisao === null));
  assert.ok(items.every((i) => i.pesquisa.pesquisadoPor === 'ln-editorial-engineer'));
  const reg = new SourceRegistry(SEED_SOURCES);
  assert.equal((await resolveEffectiveSources(reg, store)).filter((s) => s.enabled).length, 0);
  // mesmo que o cadastro diga enabled=true, sem revisão registrada a fonte efetiva é desabilitada
  assert.equal(effectiveSource(MOCK_SOURCE, undefined).enabled, false);
  assert.equal(effectiveSource(MOCK_SOURCE, undefined).termsStatus, 'pending');
});

test('RBAC das fontes: sem sessão/MFA negado; leitor e comercial sem acesso; revisor revisa mas não habilita', async () => {
  const store = new InMemoryEditorialStore();
  assert.equal((await listSources(mk(null, store), {})).status, 401);
  assert.equal((await listSources(mk(user('x', ['editor'], false), store), {})).status, 401);
  assert.equal((await listSources(mk(user('x', ['leitor']), store), {})).status, 403);
  assert.equal((await reviewSource(mk(user('x', ['editor']), store), REVIEW)).status, 403);
  assert.equal((await reviewSource(mk(revisor, store), REVIEW)).status, 200);
  assert.equal((await setSourceEnabled(mk(revisor, store), { sourceId: 'bcb', enabled: true })).status, 403);
});

test('revisão: pesquisador não revisa a própria fonte; inacessível, paywall e checagens incompletas são recusados', async () => {
  const store = new InMemoryEditorialStore();
  const c = mk(chefe, store);
  assert.equal((await reviewSource(mk(researcher, store), REVIEW)).status, 409); // revisor = pesquisador
  assert.equal((await reviewSource(c, { ...REVIEW, urlVerified: false })).status, 409);
  assert.equal((await reviewSource(c, { ...REVIEW, robotsChecked: false })).status, 409);
  assert.equal((await reviewSource(c, { ...REVIEW, paywall: 'login' })).status, 409);
  assert.equal((await reviewSource(c, { ...REVIEW, sourceId: 'magalu-ri' })).status, 409); // inacessível na pesquisa
  assert.equal((await reviewSource(c, { ...REVIEW, termsNote: 'ok' })).status, 400);
  assert.equal((await reviewSource(c, { ...REVIEW, sourceId: 'nao-existe' })).status, 404);
  // fonte sem pesquisador registrado: não há como garantir independência
  const reg = new SourceRegistry([MOCK_SOURCE]);
  assert.equal((await reviewSource(mk(chefe, store, reg), { ...REVIEW, sourceId: 'mock-ri' })).status, 409);
  assert.equal((await store.listSourceStates()).length, 0, 'nenhuma revisão recusada foi gravada');
});

test('habilitação: só com revisão aprovada e atual; revisão não habilita sozinha; desabilitar sempre pode', async () => {
  const store = new InMemoryEditorialStore();
  const c = mk(chefe, store);
  assert.equal((await setSourceEnabled(mk(admin, store), { sourceId: 'bcb', enabled: true })).status, 409); // sem revisão
  const rev = await reviewSource(c, REVIEW);
  assert.equal(rev.status, 200);
  assert.equal(body(rev).habilitada, false, 'revisar não habilita');
  assert.equal(body(rev).revisao?.revisor, 'maria-chefe');
  const en = await setSourceEnabled(mk(admin, store), { sourceId: 'bcb', enabled: true });
  assert.equal(en.status, 200);
  assert.equal(body(en).habilitada, true);
  assert.equal(body(en).elegivel, true);
  const eff = await resolveEffectiveSources(new SourceRegistry(SEED_SOURCES), store);
  assert.deepEqual(eff.filter((s) => s.enabled).map((s) => s.id), ['bcb']);
  assert.deepEqual(new SourceRegistry(eff).collectable().map((s) => s.id), ['bcb']);
  // nova revisão desliga: habilitar volta a ser ato explícito
  await reviewSource(c, REVIEW);
  assert.equal((await resolveEffectiveSources(new SourceRegistry(SEED_SOURCES), store)).filter((s) => s.enabled).length, 0);
  // revisão negada nunca habilita
  await reviewSource(c, { ...REVIEW, termsStatus: 'denied', termsNote: 'Termos proíbem reprodução e raspagem automatizada.' });
  assert.equal((await setSourceEnabled(mk(admin, store), { sourceId: 'bcb', enabled: true })).status, 409);
  // desabilitar: revisor pode (fail-safe), mesmo sem estado
  assert.equal((await setSourceEnabled(mk(revisor, store), { sourceId: 'cvm', enabled: false })).status, 200);
  assert.equal((await setSourceEnabled(mk(user('x', ['leitor']), store), { sourceId: 'cvm', enabled: false })).status, 403);
});

test('revisão vencida: mudar a definição da fonte (URL/termos/prefixo) invalida a habilitação', async () => {
  const store = new InMemoryEditorialStore();
  await reviewSource(mk(chefe, store), REVIEW);
  await setSourceEnabled(mk(admin, store), { sourceId: 'bcb', enabled: true });
  const changed = SEED_SOURCES.map((s) => (s.id === 'bcb' ? { ...s, listingUrl: 'https://www.bcb.gov.br/outra-pagina' } : s));
  const reg2 = new SourceRegistry(changed);
  assert.notEqual(sourceFingerprint(reg2.get('bcb')!), sourceFingerprint(new SourceRegistry(SEED_SOURCES).get('bcb')!));
  const eff = await resolveEffectiveSources(reg2, store);
  assert.equal(eff.find((s) => s.id === 'bcb')?.enabled, false);
  assert.equal(eff.find((s) => s.id === 'bcb')?.termsStatus, 'pending');
  const list = (await listSources(mk(chefe, store, reg2), { editoria: 'bancos' })).body as { items: SourceView[] };
  assert.equal(list.items.find((i) => i.id === 'bcb')?.revisao?.vencida, true);
  assert.equal((await setSourceEnabled(mk(admin, store, reg2), { sourceId: 'bcb', enabled: true })).status, 409);
});

test('host compartilhado: gov.br só habilita com prefixo; trilha de auditoria registra revisão e habilitação', async () => {
  const store = new InMemoryEditorialStore();
  const c = mk(chefe, store);
  await reviewSource(c, { ...REVIEW, sourceId: 'anpd' });
  const en = await setSourceEnabled(mk(admin, store), { sourceId: 'anpd', enabled: true });
  assert.equal(en.status, 200);
  assert.equal(body(en).pathPrefix, '/anpd');
  const noPrefix = SEED_SOURCES.map((s) => (s.id === 'anpd' ? { ...s, pathPrefix: null } : s));
  const eff = await resolveEffectiveSources(new SourceRegistry(noPrefix), store);
  assert.equal(new SourceRegistry(eff).collectable().length, 0);
  const actions = (await store.listAudit()).map((a) => `${a.action}:${a.userId}`);
  assert.deepEqual(actions, ['source.review:maria-chefe', 'source.enable:joao-admin']);
  assert.equal((await store.listAudit())[1]?.detail, 'revisão de maria-chefe');
});
