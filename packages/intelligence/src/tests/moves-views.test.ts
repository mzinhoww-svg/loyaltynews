import { describe, it, expect, beforeEach } from 'vitest';
import type { Db } from '../db';
import {
  consumeArticle, createWatchlist, describeMove, generateAlerts, listAlerts, newsletterMovesDigest, portalMovesPage, reviewAlertHandler, reviewMoveHandler,
  studioApprovedAlertsFeed, studioMoveQueue, upsertOrganization, watch, type PublishedArticle, type RoleMention,
} from '../index';
import { CFG_ON, ev, newDb } from './helpers';

let db: Db;
beforeEach(async () => { ({ db } = await newDb()); });

const art = (n: number, day: string): PublishedArticle => ({
  id: `a${n}`, status: 'published', url: `https://mock.invalid/m/${n}`, sourceName: 'MOCK Fonte', fetchedAt: `${day}T12:00:00Z`, publishedAt: `${day}T09:00:00Z`,
  contentSha256: `sha256:${n}`, isMock: true,
});
const ment = (name: string, org: string, title: string, over: Partial<RoleMention> = {}): RoleMention => ({
  personName: name, orgName: org, title, kind: 'present', announced: true, excerpt: `MOCK ${name}`, ...over,
});

/** Três nomeações anunciadas em meses diferentes, todas detectadas. */
async function seedMoves() {
  await consumeArticle(db, { article: art(1, '2026-09-10'), mentions: [ment('MOCK Ana', 'MOCK Alfa', 'Diretora')] }, CFG_ON);
  await consumeArticle(db, { article: art(2, '2026-10-12'), mentions: [ment('MOCK Bruno', 'MOCK Alfa', 'CFO', { effectiveDate: '2026-10-01' })] }, CFG_ON);
  await consumeArticle(db, { article: art(3, '2026-10-20'), mentions: [ment('MOCK Carla', 'MOCK Beta', 'CMO')] }, CFG_ON);
  return (await studioMoveQueue(db)).pending;
}

describe('describeMove: texto determinístico', () => {
  const base = { person_name: 'Ana', from_organization: 'Alfa', from_title: 'Gerente', to_organization: 'Beta', to_title: 'CMO' };
  it('quatro tipos', () => {
    expect(describeMove({ ...base, kind: 'appointment', from_organization: null, from_title: null })).toBe('Ana assume como CMO na Beta');
    expect(describeMove({ ...base, kind: 'departure', to_organization: null, to_title: null })).toBe('Ana deixa o cargo de Gerente na Alfa');
    expect(describeMove({ ...base, kind: 'title_change', from_organization: 'Beta' })).toBe('Ana muda de Gerente para CMO na Beta');
    expect(describeMove({ ...base, kind: 'org_change' })).toBe('Ana deixa Alfa (Gerente) e assume CMO na Beta');
  });
});

describe('/moves do portal: só confirmados, com evidência, paginados', () => {
  it('detectado e rejeitado nunca aparecem; confirmado traz fonte, data de consulta e ressalva', async () => {
    const pend = await seedMoves();
    expect(pend).toHaveLength(3);
    expect(await portalMovesPage(db)).toMatchObject({ total: 0, empty: true, items: [] });

    await reviewMoveHandler(db, 'mock-editor', { id: pend.find((m) => m.person_name === 'MOCK Ana')!.id, status: 'confirmed' });
    await reviewMoveHandler(db, 'mock-editor', { id: pend.find((m) => m.person_name === 'MOCK Bruno')!.id, status: 'confirmed' });
    await reviewMoveHandler(db, 'mock-editor', { id: pend.find((m) => m.person_name === 'MOCK Carla')!.id, status: 'rejected' });

    const p = await portalMovesPage(db);
    expect(p.total).toBe(2);
    expect(p.empty).toBe(false);
    expect(p.items.map((i) => i.person_name)).toEqual(['MOCK Bruno', 'MOCK Ana']); // mais recente primeiro
    for (const i of p.items) {
      expect(i.source.url).toMatch(/^https:\/\/mock\.invalid\/m\//);
      expect(i.source.retrieved_at).toMatch(/Z$/);
      expect(i.source.is_mock).toBe(true);
      expect(i.source_line).toMatch(/^Fonte: MOCK Fonte \(consulta em \d\d\/\d\d\/2026\)$/);
    }
    expect(p.items[0]!.qualifier).toBe('Anunciado pela fonte, com vigência em 01/10/2026.');
    expect(p.items[1]!.qualifier).toBe('Anunciado pela fonte.');
    expect(p.months.map((m) => m.month)).toEqual(['2026-10', '2026-09']);
    expect(p.has_mock).toBe(true);
  });

  it('paginação, filtro por tipo e por período', async () => {
    const pend = await seedMoves();
    for (const m of pend) await reviewMoveHandler(db, 'mock-editor', { id: m.id, status: 'confirmed' });
    const p1 = await portalMovesPage(db, { pageSize: 2, page: 1 });
    const p2 = await portalMovesPage(db, { pageSize: 2, page: 2 });
    expect([p1.items.length, p2.items.length, p1.total, p1.pages]).toEqual([2, 1, 3, 2]);
    expect(new Set([...p1.items, ...p2.items].map((i) => i.id)).size).toBe(3);
    expect((await portalMovesPage(db, { kind: 'departure' })).empty).toBe(true);
    expect((await portalMovesPage(db, { kind: 'appointment' })).total).toBe(3);
    const oct = await portalMovesPage(db, { since: '2026-10-01', until: '2026-10-31' });
    expect(oct.items.map((i) => i.person_name).sort()).toEqual(['MOCK Bruno', 'MOCK Carla']);
    expect((await portalMovesPage(db, { pageSize: 999 })).page_size).toBe(50);
  });

  it('Move de pessoa suprimida some da página e do resumo', async () => {
    const pend = await seedMoves();
    for (const m of pend) await reviewMoveHandler(db, 'mock-editor', { id: m.id, status: 'confirmed' });
    await db.query(`UPDATE intelligence.person SET suppressed_at = now() WHERE normalized_name = 'mock ana'`);
    expect((await portalMovesPage(db)).items.map((i) => i.person_name)).not.toContain('MOCK Ana');
    expect((await portalMovesPage(db)).total).toBe(2);
    expect((await newsletterMovesDigest(db, { since: '2026-01-01', until: '2026-12-31' })).text_plain).not.toContain('MOCK Ana');
  });
});

describe('newsletter e alertas', () => {
  it('resumo da newsletter: só confirmados do período, texto plano com ressalva e fonte', async () => {
    const pend = await seedMoves();
    await reviewMoveHandler(db, 'mock-editor', { id: pend.find((m) => m.person_name === 'MOCK Bruno')!.id, status: 'confirmed' });
    await reviewMoveHandler(db, 'mock-editor', { id: pend.find((m) => m.person_name === 'MOCK Ana')!.id, status: 'confirmed' });
    const d = await newsletterMovesDigest(db, { since: '2026-10-01', until: '2026-10-31' });
    expect(d.items).toHaveLength(1);
    expect(d.text_plain).toBe('• MOCK Bruno assume como CFO na MOCK Alfa. Anunciado pela fonte, com vigência em 01/10/2026. Fonte: MOCK Fonte (consulta em 12/10/2026)');
    expect((await newsletterMovesDigest(db, { since: '2027-01-01', until: '2027-01-31' })).empty).toBe(true);
  });

  it('Move sem data anunciada diz que a data efetiva não foi informada', async () => {
    await consumeArticle(db, { article: art(1, '2026-09-10'), mentions: [ment('MOCK Ana', 'MOCK Alfa', 'Diretora', { announced: false })] }, CFG_ON);
    await consumeArticle(db, { article: art(2, '2026-10-12'), mentions: [ment('MOCK Ana', 'MOCK Alfa', 'CFO', { announced: false })] }, CFG_ON);
    const [m] = (await studioMoveQueue(db)).pending;
    await reviewMoveHandler(db, 'mock-editor', { id: m!.id, status: 'confirmed' });
    const d = await newsletterMovesDigest(db, { since: '2026-01-01', until: '2026-12-31' });
    expect(d.items[0]!.basis).toBe('observed_diff');
    expect(d.items[0]!.qualifier).toContain('a data efetiva não foi informada pela fonte');
    expect(d.items[0]!.text).toBe('MOCK Ana muda de Diretora para CFO na MOCK Alfa');
  });

  it('feed de alertas: só aprovados entram; pendente e rejeitado não', async () => {
    const pend = await seedMoves();
    const e = await ev(db, 'wl');
    const alfa = await upsertOrganization(db, { legalName: 'MOCK Alfa', evidenceId: e, observedAt: '2026-11-01T00:00:00Z' });
    const beta = await upsertOrganization(db, { legalName: 'MOCK Beta', evidenceId: e, observedAt: '2026-11-01T00:00:00Z' });
    const wl = await createWatchlist(db, 'MOCK', 'mock-editor');
    await watch(db, wl, 'organization', alfa);
    await watch(db, wl, 'organization', beta);
    await generateAlerts(db);
    const alerts = await listAlerts(db);
    expect(alerts).toHaveLength(pend.length);
    expect((await studioApprovedAlertsFeed(db)).empty).toBe(true);

    await reviewAlertHandler(db, 'mock-reviewer', { id: alerts[0]!.id, status: 'approved' });
    await reviewAlertHandler(db, 'mock-reviewer', { id: alerts[1]!.id, status: 'rejected' });
    const feed = await studioApprovedAlertsFeed(db, { watchlistId: wl });
    expect(feed.items).toHaveLength(1);
    expect(feed.items[0]).toMatchObject({ alert_id: alerts[0]!.id, reviewed_by: 'mock-reviewer', move_status: 'detected' });
    expect(feed.items[0]!.move.source.url).toMatch(/^https:\/\/mock\.invalid\/m\//);
    expect(feed.has_mock).toBe(true);
  });
});
