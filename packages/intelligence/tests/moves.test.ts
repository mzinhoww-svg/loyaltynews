import { describe, it, expect, beforeEach } from 'vitest';
import type { Db } from '../src/db.ts';
import {
  createWatchlist, generateAlerts, getRoleHistory, listAlerts, listMoves, processObservation, reviewAlert, reviewMove,
  upsertOrganization, watch, ExtendedPersonalDataDisabledError, type RoleObservation,
} from '../src/index.ts';
import { MOCK_ORGS, MOCK_PEOPLE } from '../fixtures/mock-entities.ts';
import { ev, newDb } from './helpers.ts';

let db: Db;
beforeEach(async () => { ({ db } = await newDb()); });

async function obs(over: Partial<RoleObservation> & { slug: string; at: string }): Promise<RoleObservation> {
  const { slug, at, ...rest } = over;
  return {
    personName: MOCK_PEOPLE.ana.name, publicProfileUrl: MOCK_PEOPLE.ana.profile, orgName: MOCK_ORGS.alfa, title: 'Diretora de Marketing',
    kind: 'present', evidenceId: await ev(db, slug, at), observedAt: at, ...rest,
  };
}

describe('Loyalty Moves — detecção de mudança de cargo', () => {
  it('primeira observação é linha de base, não Move', async () => {
    const r = await processObservation(db, await obs({ slug: 's1', at: '2026-10-01T00:00:00Z' }));
    expect(r.outcome).toBe('baseline');
    expect(await listMoves(db)).toHaveLength(0);
  });

  it('mesma pessoa, mesmo cargo: só revalida (sem Move)', async () => {
    await processObservation(db, await obs({ slug: 's1', at: '2026-10-01T00:00:00Z' }));
    const r = await processObservation(db, await obs({ slug: 's2', at: '2026-11-01T00:00:00Z' }));
    expect(r.outcome).toBe('unchanged');
    const h = await getRoleHistory(db, r.outcome === 'unchanged' ? r.personId : '');
    expect(h).toHaveLength(1);
    expect(new Date(h[0]!.validated_at).toISOString()).toBe('2026-11-01T00:00:00.000Z');
  });

  it('cargo diferente na mesma empresa: title_change, fecha o antigo e abre o novo', async () => {
    await processObservation(db, await obs({ slug: 's1', at: '2026-10-01T00:00:00Z' }));
    const r = await processObservation(db, await obs({ slug: 's2', at: '2026-11-05T00:00:00Z', title: 'Diretora de CRM' }));
    expect(r.outcome).toBe('move');
    if (r.outcome !== 'move') return;
    expect(r.move.kind).toBe('title_change');
    expect(r.move.basis).toBe('observed_diff');
    expect(r.move.effective_date).toBeNull(); // data efetiva só se a fonte declara
    expect(r.move.status).toBe('detected');
    const h = await getRoleHistory(db, r.personId);
    expect(h.map((x) => [x.title, x.valid_to])).toEqual([['Diretora de Marketing', '2026-11-05'], ['Diretora de CRM', null]]);
  });

  it('empresa diferente: org_change com evidência', async () => {
    await processObservation(db, await obs({ slug: 's1', at: '2026-10-01T00:00:00Z' }));
    const r = await processObservation(db, await obs({ slug: 's2', at: '2026-11-05T00:00:00Z', orgName: MOCK_ORGS.beta, title: 'CMO', announcement: { effectiveDate: '2026-11-03' } }));
    if (r.outcome !== 'move') throw new Error('esperado move');
    expect(r.move.kind).toBe('org_change');
    expect(r.move.basis).toBe('announcement');
    expect(r.move.effective_date).toBe('2026-11-03');
    expect(r.move.evidence_id).toBeTruthy();
    expect(r.move.from_role_id).not.toBeNull();
    expect(r.move.to_role_id).not.toBeNull();
  });

  it('saída explícita: departure', async () => {
    await processObservation(db, await obs({ slug: 's1', at: '2026-10-01T00:00:00Z' }));
    const r = await processObservation(db, await obs({ slug: 's2', at: '2026-11-10T00:00:00Z', kind: 'left', announcement: { effectiveDate: '2026-11-09' } }));
    if (r.outcome !== 'move') throw new Error('esperado move');
    expect(r.move.kind).toBe('departure');
    const h = await getRoleHistory(db, r.personId);
    expect(h[0]!.valid_to).toBe('2026-11-09');
  });

  it('anúncio de nomeação de pessoa nova gera appointment; saída sem cargo aberto é ignorada', async () => {
    const r = await processObservation(db, await obs({
      slug: 's1', at: '2026-11-02T00:00:00Z', personName: MOCK_PEOPLE.diego.name, publicProfileUrl: MOCK_PEOPLE.diego.profile,
      title: 'VP', announcement: { effectiveDate: '2026-11-01' },
    }));
    if (r.outcome !== 'move') throw new Error('esperado move');
    expect(r.move.kind).toBe('appointment');
    const g = await processObservation(db, await obs({ slug: 's2', at: '2026-11-03T00:00:00Z', personName: MOCK_PEOPLE.carla.name, publicProfileUrl: MOCK_PEOPLE.carla.profile, kind: 'left' }));
    expect(g).toEqual({ outcome: 'ignored', reason: 'no_open_role_to_close' });
  });

  it('observação mais antiga que o cargo aberto é ignorada', async () => {
    await processObservation(db, await obs({ slug: 's1', at: '2026-11-01T00:00:00Z' }));
    const r = await processObservation(db, await obs({ slug: 's0', at: '2026-09-01T00:00:00Z', title: 'Analista' }));
    expect(r).toEqual({ outcome: 'ignored', reason: 'stale_observation' });
  });

  it('observação com campo além de nome/cargo/empresa é recusada (flag desligada)', async () => {
    await expect(processObservation(db, await obs({ slug: 's1', at: '2026-10-01T00:00:00Z', extra: { telefone: '000' } }))).rejects.toBeInstanceOf(
      ExtendedPersonalDataDisabledError,
    );
  });

  it('reprocessar a mesma observação não duplica Move', async () => {
    await processObservation(db, await obs({ slug: 's1', at: '2026-10-01T00:00:00Z' }));
    const o2 = await obs({ slug: 's2', at: '2026-11-05T00:00:00Z', title: 'Diretora de CRM' });
    await processObservation(db, o2);
    const again = await processObservation(db, o2);
    expect(again.outcome).toBe('unchanged');
    expect(await listMoves(db)).toHaveLength(1);
  });
});

describe('watchlists e alertas', () => {
  async function scenario() {
    const e = await ev(db, 'wl');
    const alfa = await upsertOrganization(db, { legalName: MOCK_ORGS.alfa, evidenceId: e, observedAt: '2026-10-01T00:00:00Z' });
    const gama = await upsertOrganization(db, { legalName: MOCK_ORGS.gama, evidenceId: e, observedAt: '2026-10-01T00:00:00Z' });
    await processObservation(db, await obs({ slug: 's1', at: '2026-10-01T00:00:00Z' }));
    const r = await processObservation(db, await obs({ slug: 's2', at: '2026-11-05T00:00:00Z', orgName: MOCK_ORGS.beta, title: 'CMO' }));
    if (r.outcome !== 'move') throw new Error('esperado move');
    return { alfa, gama, move: r.move, personId: r.personId };
  }

  it('Move que toca organização observada gera alerta pending_review; outra organização não', async () => {
    const { alfa, gama, move } = await scenario();
    const wlAlfa = await createWatchlist(db, 'MOCK Alfa', 'mock-owner');
    const wlGama = await createWatchlist(db, 'MOCK Gama', 'mock-owner');
    await watch(db, wlAlfa, 'organization', alfa);
    await watch(db, wlGama, 'organization', gama);
    const created = await generateAlerts(db);
    expect(created).toHaveLength(1);
    expect(created[0]!.watchlist_id).toBe(wlAlfa);
    expect(created[0]!.move_id).toBe(move.id);
    const list = await listAlerts(db);
    expect(list[0]!.status).toBe('pending_review');
    expect(list[0]!.evidence_id).toBeTruthy();
    expect(await generateAlerts(db)).toHaveLength(0); // idempotente
  });

  it('watchlist de pessoa; destino também dispara (organização nova)', async () => {
    const { personId } = await scenario();
    const e = await ev(db, 'beta');
    const beta = await upsertOrganization(db, { legalName: MOCK_ORGS.beta, evidenceId: e, observedAt: '2026-11-01T00:00:00Z' });
    const w1 = await createWatchlist(db, 'MOCK pessoas', 'mock-owner');
    const w2 = await createWatchlist(db, 'MOCK Beta', 'mock-owner');
    await watch(db, w1, 'person', personId);
    await watch(db, w2, 'organization', beta);
    expect((await generateAlerts(db)).map((a) => a.watchlist_id).sort()).toEqual([w1, w2].sort());
  });

  it('alerta exige revisão com revisor; revisar só vale uma vez; Move rejeitado não gera alerta', async () => {
    const { alfa, move } = await scenario();
    const wl = await createWatchlist(db, 'MOCK', 'mock-owner');
    await watch(db, wl, 'organization', alfa);
    const [a] = await generateAlerts(db);
    await expect(reviewAlert(db, a!.id, 'approved', '  ')).rejects.toThrow(/reviewer_required/);
    await expect(db.query(`UPDATE intelligence.alert SET status='approved' WHERE id=$1`, [a!.id])).rejects.toThrow(); // banco exige revisor
    await reviewAlert(db, a!.id, 'approved', 'mock-reviewer');
    await reviewAlert(db, a!.id, 'rejected', 'outro'); // já revisado: sem efeito
    const l = await listAlerts(db, { status: 'approved' });
    expect(l).toHaveLength(1);
    expect(l[0]!.reviewed_by).toBe('mock-reviewer');

    await reviewMove(db, move.id, 'rejected');
    const wl2 = await createWatchlist(db, 'MOCK 2', 'mock-owner');
    await watch(db, wl2, 'organization', alfa);
    expect(await generateAlerts(db)).toHaveLength(0);
  });
});
