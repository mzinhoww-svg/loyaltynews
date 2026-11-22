import { describe, it, expect, beforeEach } from 'vitest';
import type { Db } from '../db';
import {
  DEFAULT_CONFIG, consumeArticle, extractRoleMentions, mentionsToBatches, newsletterMovesDigest, portalMovesPage, reviewMoveHandler, studioMoveQueue,
  type PublishedArticle, type RoleMention,
} from '../index';
import { CFG_ON, newDb } from './helpers';

let db: Db;
beforeEach(async () => { ({ db } = await newDb()); });

const article = (over: Partial<PublishedArticle> = {}): PublishedArticle => ({
  id: 'art-1', status: 'published', url: 'https://mock.invalid/materia/1', sourceName: 'MOCK Sala de Imprensa', fetchedAt: '2026-11-10T12:00:00Z',
  publishedAt: '2026-11-10T09:00:00Z', contentSha256: 'sha256:aaa', headline: 'MOCK manchete', isMock: true, ...over,
});
const mention = (over: Partial<RoleMention> = {}): RoleMention => ({
  personName: 'MOCK Ana Exemplo', orgName: 'MOCK Alfa Fidelidade S.A.', title: 'Diretora de Marketing', kind: 'present',
  excerpt: 'MOCK: Ana Exemplo é diretora de Marketing da MOCK Alfa.', ...over,
});
const count = async (t: string) => Number((await db.query<{ c: string }>(`SELECT count(*)::text c FROM intelligence.${t}`)).rows[0]!.c);

describe('extrator determinístico de menções de cargo (baixa cobertura de propósito)', () => {
  it('anúncio de nomeação e de saída', () => {
    const t = 'Ana Exemplo foi nomeada diretora de Marketing da Empresa Alfa Exemplo. A companhia cresceu. Bruno Exemplar deixa o cargo de presidente da Beta Cartões S.A. Nada mais.';
    const r = extractRoleMentions(t);
    expect(r).toHaveLength(2);
    expect(r[0]).toMatchObject({ personName: 'Ana Exemplo', title: 'Diretora de Marketing', orgName: 'Empresa Alfa Exemplo', kind: 'present', announced: true });
    expect(r[0]!.excerpt).toContain('foi nomeada');
    expect(r[1]).toMatchObject({ personName: 'Bruno Exemplar', title: 'Presidente', orgName: 'Beta Cartões S.A.', kind: 'left', announced: true });
  });

  it('não inventa vínculo: frases sem anúncio de cargo não geram menção', () => {
    const t = 'Carla Exemplo disse que a empresa vai crescer. A Empresa Alfa nomeia novos diretores. Segundo Diego Exemplo, o mercado muda. Maria falou com a Beta.';
    expect(extractRoleMentions(t)).toEqual([]);
  });

  it('não duplica a mesma menção', () => {
    const t = 'Ana Exemplo assume como diretora da Empresa Alfa. Ana Exemplo assume como diretora da Empresa Alfa.';
    expect(extractRoleMentions(t)).toHaveLength(1);
  });
});

describe('consumidor Editorial → Intelligence (ponta a ponta, fixtures MOCK)', () => {
  it('matéria não publicada, URL inválida e sem menções são ignoradas', async () => {
    expect(await consumeArticle(db, { article: article({ status: 'draft' }), mentions: [mention()] }, CFG_ON)).toEqual({ status: 'skipped', reason: 'not_published' });
    expect(await consumeArticle(db, { article: article({ url: 'ftp://x' }), mentions: [mention()] }, CFG_ON)).toMatchObject({ status: 'skipped', reason: 'invalid_article', issues: ['url'] });
    expect(await consumeArticle(db, { article: article(), mentions: [] }, CFG_ON)).toEqual({ status: 'skipped', reason: 'no_mentions' });
    expect(await count('person')).toBe(0);
  });

  it('flag intelligencePessoas desligada (padrão): só organizações; nenhuma pessoa, cargo ou Move', async () => {
    const r = await consumeArticle(db, { article: article(), mentions: [mention(), mention({ personName: 'MOCK Bruno Exemplo' })] }, DEFAULT_CONFIG);
    expect(r).toEqual({ status: 'organizations_only', reason: 'flag_intelligencePessoas_off', organizations: 1, persons_skipped: 2 });
    expect(await count('organization')).toBe(1);
    expect(await count('person')).toBe(0);
    expect(await count('role_assignment')).toBe(0);
    expect(await count('move')).toBe(0);
    const ev = await db.query<{ is_mock: boolean; source_class: string }>(`SELECT is_mock, source_class FROM intelligence.evidence`);
    expect(ev.rows).toEqual([{ is_mock: true, source_class: 'public' }]);
  });

  it('flag ligada: matéria 1 = linha de base; matéria 2 anuncia nomeação em outra empresa (sem identificador estável) = nomeação detectada, que só aparece no portal depois de revisada', async () => {
    const a1 = await consumeArticle(db, { article: article(), mentions: [mention()] }, CFG_ON);
    expect(a1).toMatchObject({ status: 'ingested', mentions: 1, processed: 1, rejected: 0, moves: 0 });
    expect(await count('person')).toBe(1);
    expect(await count('move')).toBe(0); // primeira vista não é Move

    const a2 = await consumeArticle(db, {
      article: article({ id: 'art-2', url: 'https://mock.invalid/materia/2', contentSha256: 'sha256:bbb', fetchedAt: '2026-11-20T12:00:00Z', publishedAt: '2026-11-20T09:00:00Z' }),
      mentions: [mention({ orgName: 'MOCK Beta Cartões Ltda', title: 'CMO', announced: true, effectiveDate: '2026-11-18', excerpt: 'MOCK: Ana Exemplo assume como CMO da MOCK Beta.' })],
    }, CFG_ON);
    expect(a2).toMatchObject({ status: 'ingested', moves: 1 });

    expect((await portalMovesPage(db)).total).toBe(0); // detectado ≠ confirmado
    const q = await studioMoveQueue(db);
    expect(q.count).toBe(1);
    // sem URL de perfil a pessoa em outra empresa NÃO é fundida com a anterior (homônimos): vira nomeação, nunca troca presumida
    expect(q.pending[0]).toMatchObject({ kind: 'appointment', basis: 'announcement', effective_date: '2026-11-18', from_title: null });
    expect(q.pending[0]!.evidence.source_url).toBe('https://mock.invalid/materia/2');

    await reviewMoveHandler(db, 'mock-editor', { id: q.pending[0]!.id, status: 'confirmed' });
    const page = await portalMovesPage(db);
    expect(page.total).toBe(1);
    expect(page.has_mock).toBe(true);
    expect(page.items[0]!.text).toBe('MOCK Ana Exemplo assume como CMO na MOCK Beta Cartões Ltda');
    expect(page.items[0]!.source_line).toBe('Fonte: MOCK Sala de Imprensa (consulta em 20/11/2026)');
    const digest = await newsletterMovesDigest(db, { since: '2026-11-01', until: '2026-11-30' });
    expect(digest.items).toHaveLength(1);
    expect(digest.text_plain).toContain('Anunciado pela fonte, com vigência em 18/11/2026.');
  });

  it('com URL pública de perfil a mesma pessoa é reconhecida em outra empresa: troca de empresa (org_change)', async () => {
    const url = 'https://mock.invalid/perfil/ana-exemplo';
    await consumeArticle(db, { article: article(), mentions: [mention({ publicProfileUrl: url })] }, CFG_ON);
    await consumeArticle(db, {
      article: article({ url: 'https://mock.invalid/materia/2', contentSha256: 'sha256:bbb', fetchedAt: '2026-11-20T12:00:00Z', publishedAt: '2026-11-20T09:00:00Z' }),
      mentions: [mention({ publicProfileUrl: url, orgName: 'MOCK Beta Cartões Ltda', title: 'CMO', announced: true })],
    }, CFG_ON);
    const q = await studioMoveQueue(db);
    expect(q.pending[0]).toMatchObject({ kind: 'org_change', from_organization: 'MOCK Alfa Fidelidade S.A.', to_organization: 'MOCK Beta Cartões Ltda' });
    expect(await count('person')).toBe(1);
  });

  it('só texto, sem menções: o extrator alimenta a ingestão; anúncio de pessoa nova gera nomeação', async () => {
    const r = await consumeArticle(db, {
      article: article({ text: 'Ana Exemplo foi nomeada diretora de Marketing da Empresa Alfa Exemplo. Outras notícias.' }),
    }, CFG_ON);
    expect(r).toMatchObject({ status: 'ingested', mentions: 1, moves: 1 });
    const m = await db.query<{ kind: string; basis: string }>(`SELECT kind, basis FROM intelligence.move`);
    expect(m.rows).toEqual([{ kind: 'appointment', basis: 'announcement' }]);
  });

  it('idempotente: mesma URL e hash não é ingerida duas vezes', async () => {
    await consumeArticle(db, { article: article(), mentions: [mention()] }, CFG_ON);
    const again = await consumeArticle(db, { article: article(), mentions: [mention()] }, CFG_ON);
    expect(again).toEqual({ status: 'skipped', reason: 'already_ingested' });
    expect(await count('evidence')).toBe(1);
  });

  it('matéria antiga processada depois não desfaz o cargo mais novo (observação defasada é ignorada)', async () => {
    await consumeArticle(db, { article: article({ publishedAt: '2026-11-20T09:00:00Z', fetchedAt: '2026-11-20T12:00:00Z' }), mentions: [mention({ title: 'CMO' })] }, CFG_ON);
    const old = await consumeArticle(db, {
      article: article({ url: 'https://mock.invalid/materia/antiga', contentSha256: 'sha256:old', publishedAt: '2026-01-05T09:00:00Z', fetchedAt: '2026-11-21T12:00:00Z' }),
      mentions: [mention({ title: 'Gerente' })],
    }, CFG_ON);
    expect(old).toMatchObject({ status: 'ingested', moves: 0 });
    const roles = await db.query<{ title: string; valid_to: string | null }>(`SELECT title, valid_to::text FROM intelligence.role_assignment`);
    expect(roles.rows).toEqual([{ title: 'CMO', valid_to: null }]);
  });

  it('dado além de nome/cargo/empresa não passa: o lote gerado só tem os campos do contrato role-observation/1', () => {
    const [b] = mentionsToBatches(article(), [mention({ announced: true, effectiveDate: '2026-11-01' })]);
    expect(Object.keys(b!.observations[0]!).sort()).toEqual(['announcement', 'kind', 'observedAt', 'orgName', 'personName', 'title']);
    expect(b!.evidence.excerpt!.length).toBeLessThanOrEqual(500);
  });
});
