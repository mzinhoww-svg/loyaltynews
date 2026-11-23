/* eslint-disable @typescript-eslint/no-explicit-any -- linhas de resultado do SQL e corpos JSON de resposta são tipados na borda */
import { describe, it, expect, beforeEach } from 'vitest';
import type { Db } from '../db';
import { INGEST_SCHEMA_VERSION, ROLE_OBSERVATION_BATCH_JSON_SCHEMA, listMoves, validateBatch, validateObservation, type RoleObservationBatch } from '../index';
import { MOCK_ORGS, MOCK_PEOPLE } from '../../fixtures/mock-entities';
import { newDb, ib } from './helpers';

let db: Db;
beforeEach(async () => { ({ db } = await newDb()); });

const batch = (over: Partial<RoleObservationBatch> = {}, obs: Partial<RoleObservationBatch['observations'][number]>[] = [{}]): RoleObservationBatch => ({
  schemaVersion: INGEST_SCHEMA_VERSION,
  evidence: { sourceUrl: 'https://mock.invalid/comunicado', sourceName: 'MOCK fonte', retrievedAt: '2026-11-22T10:00:00Z', excerpt: 'MOCK trecho', isMock: true },
  observations: obs.map((o) => ({
    personName: MOCK_PEOPLE.ana.name, publicProfileUrl: MOCK_PEOPLE.ana.profile, orgName: MOCK_ORGS.alfa, title: 'Diretora de Marketing',
    kind: 'present' as const, observedAt: '2026-11-22T10:00:00Z', ...o,
  })),
  ...over,
});

describe('contrato role-observation/1 — validação', () => {
  it('lote válido não tem problemas', () => {
    expect(validateBatch(batch())).toEqual([]);
    expect(validateObservation(batch().observations[0])).toEqual([]);
  });

  it.each([
    ['schemaVersion errada', { schemaVersion: 'role-observation/2' }, 'schemaVersion'],
    ['fonte não http', { evidence: { sourceUrl: 'file:///x', sourceName: 'n', retrievedAt: '2026-11-22T10:00:00Z' } }, 'evidence.sourceUrl'],
    ['coleta sem fuso', { evidence: { sourceUrl: 'https://a.invalid/x', sourceName: 'n', retrievedAt: '2026-11-22T10:00:00' } }, 'evidence.retrievedAt'],
    ['trecho longo demais', { evidence: { sourceUrl: 'https://a.invalid/x', sourceName: 'n', retrievedAt: '2026-11-22T10:00:00Z', excerpt: 'x'.repeat(501) } }, 'evidence.excerpt'],
    ['lote vazio', { observations: [] }, 'observations'],
  ])('recusa lote: %s', (_n, over, path) => {
    expect(validateBatch({ ...batch(), ...over }).map((i) => i.path)).toContain(path);
  });

  it('recusa chaves desconhecidas (nenhum campo livre)', () => {
    const b = { ...batch(), extraTop: 1 } as unknown;
    expect(validateBatch(b).map((i) => i.path)).toContain('extraTop');
    const issues = validateObservation({ ...batch().observations[0], email: 'a@b.invalid', cpf: '1' });
    expect(issues.map((i) => i.path).sort()).toEqual(['cpf', 'email']);
  });

  it.each([
    ['nome vazio', { personName: ' ' }, 'personName'],
    ['kind inválido', { kind: 'maybe' }, 'kind'],
    ['data sem fuso', { observedAt: '2026-11-22' }, 'observedAt'],
    ['perfil não http', { publicProfileUrl: 'javascript:alert(1)' }, 'publicProfileUrl'],
    ['data efetiva inválida', { announcement: { effectiveDate: '22/11/2026' } }, 'announcement.effectiveDate'],
    ['cargo enorme', { title: 'x'.repeat(201) }, 'title'],
  ])('recusa observação: %s', (_n, over, path) => {
    expect(validateObservation({ ...batch().observations[0], ...over }).map((i) => i.path)).toContain(path);
  });

  it('JSON Schema exportado espelha as chaves do contrato', () => {
    const s = ROLE_OBSERVATION_BATCH_JSON_SCHEMA;
    expect(Object.keys(s.properties).sort()).toEqual(['evidence', 'observations', 'schemaVersion']);
    expect(Object.keys(s.properties.observations.items.properties).sort()).toEqual(
      ['announcement', 'extra', 'kind', 'observedAt', 'orgName', 'personName', 'publicProfileUrl', 'sourceLevel', 'title'],
    );
    expect(s.properties.observations.items.additionalProperties).toBe(false);
    expect(s.properties.schemaVersion.const).toBe('role-observation/1');
  });
});

describe('contrato role-observation/1 — ingestão', () => {
  it('lote inválido é recusado inteiro e não grava nada', async () => {
    const rep = await ib(db, { ...batch(), schemaVersion: 'x' });
    expect(rep.accepted).toBe(false);
    expect(rep.evidenceId).toBeNull();
    const n = await db.query<{ c: string }>(`SELECT count(*)::text c FROM intelligence.evidence`);
    expect(n.rows[0]!.c).toBe('0');
  });

  it('item inválido não bloqueia os demais; relatório por índice', async () => {
    const rep = await ib(db, batch({}, [
      {}, { personName: '' }, { personName: MOCK_PEOPLE.bruno.name, publicProfileUrl: MOCK_PEOPLE.bruno.profile }, { extra: { telefone: '0' } as any },
    ]));
    expect(rep.accepted).toBe(true);
    expect(rep.items.map((i) => [i.index, i.status])).toEqual([[0, 'processed'], [1, 'rejected'], [2, 'processed'], [3, 'rejected']]);
    const bad = rep.items[3]!;
    expect(bad.status === 'rejected' && bad.code).toBe('extended_personal_data_disabled');
    expect(rep.counts).toEqual({ processed: 2, rejected: 2, moves: 0 });
  });

  it('primeira ingestão = baseline; mudança num segundo lote = Move com evidência; reenvio é idempotente', async () => {
    const r1 = await ib(db, batch());
    expect(r1.items[0]).toMatchObject({ status: 'processed', result: { outcome: 'baseline' } });

    const second = batch({ evidence: { sourceUrl: 'https://mock.invalid/novo', sourceName: 'MOCK fonte 2', retrievedAt: '2026-12-01T10:00:00Z', isMock: true } },
      [{ title: 'Diretora de CRM', observedAt: '2026-12-01T10:00:00Z' }]);
    const r2 = await ib(db, second);
    expect(r2.counts.moves).toBe(1);
    const moves = await listMoves(db);
    expect(moves).toHaveLength(1);
    expect(moves[0]!.kind).toBe('title_change');
    expect(moves[0]!.evidence_id).toBe(r2.evidenceId);
    expect(moves[0]!.effective_date).toBeNull();

    const r3 = await ib(db, second); // reenvio
    expect(r3.counts.moves).toBe(0);
    expect(r3.items[0]).toMatchObject({ status: 'processed', result: { outcome: 'unchanged' } });
    expect(await listMoves(db)).toHaveLength(1);
    const roles = await db.query<{ c: string }>(`SELECT count(*)::text c FROM intelligence.role_assignment`);
    expect(roles.rows[0]!.c).toBe('2');
  });

  it('anúncio com data efetiva vira Move declarado; sem anúncio não há data efetiva', async () => {
    await ib(db, batch());
    const r = await ib(db, batch({}, [{ orgName: MOCK_ORGS.beta, title: 'CMO', observedAt: '2026-12-02T09:00:00Z', announcement: { effectiveDate: '2026-12-01' } }]));
    const m = await listMoves(db);
    expect(r.counts.moves).toBe(1);
    expect(m[0]).toMatchObject({ kind: 'org_change', basis: 'announcement', effective_date: '2026-12-01' });
  });

  it('pessoa suprimida: observação é ignorada, sem recriar o registro', async () => {
    const first = await ib(db, batch());
    const pid = (first.items[0] as any).result.personId as string;
    await db.query(`UPDATE intelligence.person SET suppressed_at = now() WHERE id = $1`, [pid]);
    const r = await ib(db, batch({}, [{ observedAt: '2026-12-05T10:00:00Z' }]));
    expect(r.items[0]).toMatchObject({ status: 'processed', result: { outcome: 'ignored', reason: 'subject_suppressed' } });
    const n = await db.query<{ c: string }>(`SELECT count(*)::text c FROM intelligence.person`);
    expect(n.rows[0]!.c).toBe('1');
  });

  it('com a flag ligada o campo extra passa pela validação (mas a flag nasce desligada)', async () => {
    const rep = await ib(db, batch({}, [{ extra: { nota: 'x' } as any }]), { personIngestion: true, extendedPersonalData: true });
    expect(rep.items[0]!.status).toBe('processed');
  });
});
