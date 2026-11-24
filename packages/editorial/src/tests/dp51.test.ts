import { test } from 'vitest';
import assert from 'node:assert/strict';
import { MOCK_SOURCE } from '../../fixtures/mock-web.mock';
import { SourceRegistry } from '../sources/registry';
import { InMemoryEditorialStore } from '../api/store';
import type { Actor, HandlerCtx } from '../api/handlers';
import { listSources, reviewSource, setSourceEnabled, type SourceView } from '../api/source-handlers';
import type { Source, SourceVerification } from '../types';

// DP-51 (proprietário): habilitar fonte da Fábrica com UM clique do administrador. Grava a revisão implícita (aprovada, URL e robots conferidos
// pelo admin), audita quem e quando, sem exigir revisão prévia dos termos. As recusas de segurança que não são de termos seguem; paywall/login
// e "inacessível" viram aviso que o administrador confirma.

const NOW = new Date('2026-11-24T12:00:00.000Z');
const VER: SourceVerification = { researchedBy: 'pesquisador-1', level: 'lido', robots: 'permitido', robotsNote: '', termsExcerpt: null, termsFetchedAt: null, consultedAt: null, imageRightsNote: '', notes: '' };
const LIMPA: Source = { ...MOCK_SOURCE, id: 'dp51-limpa', name: 'DP51 Limpa', host: 'limpa.dp51.example', listingUrl: 'https://limpa.dp51.example/', feedUrl: null, termsUrl: null, enabled: false, termsStatus: 'pending', urlVerified: false, paywall: 'unknown', verification: VER };
const LOGIN: Source = { ...LIMPA, id: 'dp51-login', name: 'DP51 Login', host: 'login.dp51.example', listingUrl: 'https://login.dp51.example/', paywall: 'login' };
const INACESSIVEL: Source = { ...LIMPA, id: 'dp51-inacessivel', name: 'DP51 Inacessível', host: 'inacessivel.dp51.example', listingUrl: 'https://inacessivel.dp51.example/', verification: { ...VER, level: 'inacessivel' } };
const SEM_ROBOTS: Source = { ...LIMPA, id: 'dp51-sem-robots', name: 'DP51 Sem robots', host: 'semrobots.dp51.example', listingUrl: 'https://semrobots.dp51.example/', robotsRespected: false as unknown as true }; // o tipo só admite true: o teste força o caso recusado
const COMPARTILHADA: Source = { ...LIMPA, id: 'dp51-gov', name: 'DP51 gov.br', host: 'www.gov.br', listingUrl: 'https://www.gov.br/', pathPrefix: undefined };

const admin: Actor = { userId: 'joao-admin', roles: ['admin'], mfa: true };
const chefe: Actor = { userId: 'maria-chefe', roles: ['editor_chefe'], mfa: true };
const revisor: Actor = { userId: 'rui-revisor', roles: ['revisor'], mfa: true };

function mk() {
  const store = new InMemoryEditorialStore();
  const reg = new SourceRegistry([LIMPA, LOGIN, INACESSIVEL, SEM_ROBOTS, COMPARTILHADA]);
  const ctx = (a: Actor | null): HandlerCtx => ({ actor: a, store, sources: reg, now: () => NOW, newId: () => 'id' });
  return { store, ctx };
}
const view = (r: { body: unknown }) => r.body as SourceView;

test('DP-51: o administrador habilita DIRETO com um clique, sem revisão prévia, e fica registrado quem e quando', async () => {
  const { store, ctx } = mk();
  const r = await setSourceEnabled(ctx(admin), { sourceId: 'dp51-limpa', enabled: true, direto: true });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const v = view(r);
  assert.equal(v.habilitada, true);
  assert.equal(v.elegivel, true);
  assert.equal(v.termsStatus, 'approved');
  assert.equal(v.revisao?.direta, true);
  assert.equal(v.revisao?.revisor, 'joao-admin');
  assert.equal(v.revisao?.vencida, false);
  const st = await store.getSourceState('dp51-limpa');
  assert.equal(st?.review?.urlVerified, true);
  assert.equal(st?.review?.robotsChecked, true);
  assert.equal(st?.review?.direta, true);
  const trilha = (await store.listAudit()).filter((a) => a.action === 'source.enable_direct');
  assert.equal(trilha.length, 1);
  assert.equal(trilha[0]?.userId, 'joao-admin');
  assert.equal(trilha[0]?.target, 'dp51-limpa');
  assert.equal(trilha[0]?.at, NOW.toISOString());
});

test('DP-51: a observação é OPCIONAL (sem mínimo) e, quando vem, fica na revisão e na trilha', async () => {
  const { store, ctx } = mk();
  const sem = await setSourceEnabled(ctx(admin), { sourceId: 'dp51-limpa', enabled: true, direto: true });
  assert.equal(sem.status, 200);
  assert.match(view(sem).revisao?.observacao ?? '', /Habilitação direta pelo administrador/);
  await setSourceEnabled(ctx(admin), { sourceId: 'dp51-limpa', enabled: false });
  const com = await setSourceEnabled(ctx(admin), { sourceId: 'dp51-limpa', enabled: true, direto: true, observacao: 'ok' }); // 2 caracteres: sem mínimo
  assert.equal(com.status, 200);
  assert.equal(view(com).revisao?.observacao, 'ok');
  assert.ok((await store.listAudit()).some((a) => a.action === 'source.enable_direct' && /observação: ok/.test(a.detail ?? '')));
});

test('DP-51: só o administrador habilita direto; editor-chefe e revisor não, e sem sessão ou sem MFA nada muda', async () => {
  const { store, ctx } = mk();
  assert.equal((await setSourceEnabled(ctx(chefe), { sourceId: 'dp51-limpa', enabled: true, direto: true })).status, 403);
  assert.equal((await setSourceEnabled(ctx(revisor), { sourceId: 'dp51-limpa', enabled: true, direto: true })).status, 403);
  assert.equal((await setSourceEnabled(ctx(null), { sourceId: 'dp51-limpa', enabled: true, direto: true })).status, 401);
  assert.equal((await setSourceEnabled(ctx({ ...admin, mfa: false }), { sourceId: 'dp51-limpa', enabled: true, direto: true })).status, 401);
  assert.equal(await store.getSourceState('dp51-limpa'), undefined);
});

test('DP-51: o caminho formal continua igual (sem "direto", habilitar sem revisão segue recusado)', async () => {
  const { ctx } = mk();
  const r = await setSourceEnabled(ctx(admin), { sourceId: 'dp51-limpa', enabled: true });
  assert.equal(r.status, 409);
  assert.match(JSON.stringify(r.body), /sem revisão registrada/);
  // revisão formal segue com mínimo de 20 caracteres e revisor diferente do pesquisador
  assert.equal((await reviewSource(ctx(revisor), { sourceId: 'dp51-limpa', termsStatus: 'approved', termsNote: 'curta', urlVerified: true, robotsChecked: true, paywall: 'none' })).status, 400);
});

test('DP-51: paywall/login e "inacessível" viram aviso: sem confirmação recusa listando o aviso; com confirmação o administrador decide e fica registrado', async () => {
  const { store, ctx } = mk();
  for (const id of ['dp51-login', 'dp51-inacessivel']) {
    const semConfirmar = await setSourceEnabled(ctx(admin), { sourceId: id, enabled: true, direto: true });
    assert.equal(semConfirmar.status, 409, id);
    const corpo = semConfirmar.body as { error: { details?: { riscos?: string[]; precisaConfirmar?: boolean } } };
    assert.equal(corpo.error.details?.precisaConfirmar, true);
    assert.ok((corpo.error.details?.riscos ?? []).length >= 1);
    assert.equal(await store.getSourceState(id), undefined, 'nada gravado sem a confirmação');
    const confirmado = await setSourceEnabled(ctx(admin), { sourceId: id, enabled: true, direto: true, confirmarRisco: true });
    assert.equal(confirmado.status, 200, id);
    assert.deepEqual(view(confirmado).revisao?.direta, true);
    const st = await store.getSourceState(id);
    assert.ok((st?.review?.riscoAceito ?? []).length >= 1, 'o aviso aceito fica na revisão');
  }
  assert.ok((await store.listAudit()).some((a) => a.action === 'source.enable_direct' && /risco aceito/.test(a.detail ?? '')));
});

test('DP-51: as recusas de segurança que não são de termos continuam (robots não respeitado; host compartilhado sem prefixo)', async () => {
  const { store, ctx } = mk();
  for (const id of ['dp51-sem-robots', 'dp51-gov']) {
    const r = await setSourceEnabled(ctx(admin), { sourceId: id, enabled: true, direto: true, confirmarRisco: true });
    assert.equal(r.status, 409, `${id}: ${JSON.stringify(r.body)}`);
    assert.match(JSON.stringify(r.body), /inelegível/);
    assert.equal(await store.getSourceState(id), undefined);
  }
});

test('DP-51: desabilitar continua direto, a lista traz os avisos de cada fonte e a revisão direta aparece como tal', async () => {
  const { ctx } = mk();
  await setSourceEnabled(ctx(admin), { sourceId: 'dp51-limpa', enabled: true, direto: true });
  const off = await setSourceEnabled(ctx(admin), { sourceId: 'dp51-limpa', enabled: false });
  assert.equal(off.status, 200);
  assert.equal(view(off).habilitada, false);
  const lista = (await listSources(ctx(admin), {})).body as { items: SourceView[] };
  const por = new Map(lista.items.map((i) => [i.id, i]));
  assert.deepEqual(por.get('dp51-login')?.riscos, ['exige login']);
  assert.deepEqual(por.get('dp51-inacessivel')?.riscos, ['inacessível na pesquisa']);
  assert.deepEqual(por.get('dp51-limpa')?.riscos, []);
  assert.equal(por.get('dp51-limpa')?.revisao?.direta, true);
});
