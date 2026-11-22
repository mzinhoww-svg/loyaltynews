import { describe, expect, it } from 'vitest';
import { AlertView, GraphNeighborsQuery, GraphPathResponse, OrgChartEdgeView, ReviewMoveInput, WatchlistSummary } from './index';

const u = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

describe('Intelligence — watchlists, alertas, organograma e grafo', () => {
  it('watchlist e alerta', () => {
    expect(WatchlistSummary.safeParse({ id: u(1), name: 'Bancos', owner_ref: 'editor', items: 3, pending_alerts: 1 }).success).toBe(true);
    const a = { id: u(2), watchlist_id: u(1), status: 'pending_review', kind: 'appointment', person_name: 'Ana', basis: 'announcement', evidence_id: u(3), observed_on: '2026-11-20', reviewed_by: null };
    expect(AlertView.safeParse(a).success).toBe(true);
    expect(AlertView.safeParse({ ...a, status: 'publicado' }).success).toBe(false);
    expect(ReviewMoveInput.safeParse({ id: u(4), status: 'detected' }).success).toBe(false);
  });
  it('organograma: inferida não pode ser rotulada como fato', () => {
    const e = { superior_name: 'A', superior_title: 'CEO', subordinate_name: 'B', subordinate_title: 'CFO', certainty: 'inferred', display_label: 'inferido — não confirmado', evidence_id: u(5), observed_at: '2026-11-20T10:00:00.000Z', validated_at: '2026-11-20T10:00:00.000Z' };
    expect(OrgChartEdgeView.safeParse(e).success).toBe(true);
    expect(OrgChartEdgeView.safeParse({ ...e, display_label: 'fato (fonte declara)' }).success).toBe(false);
  });
  it('grafo: até 3 saltos e caminho coerente', () => {
    expect(GraphNeighborsQuery.parse({ type: 'person', id: u(1) }).maxHops).toBe(3);
    expect(GraphNeighborsQuery.safeParse({ type: 'person', id: u(1), maxHops: 4 }).success).toBe(false);
    const path = { node_type: 'organization', node_id: u(2), depth: 1, path: [`person:${u(1)}`, `organization:${u(2)}`], edge_ids: [u(9)], all_declared: true };
    expect(GraphPathResponse.safeParse({ path, max_hops: 3 }).success).toBe(true);
    expect(GraphPathResponse.safeParse({ path: { ...path, edge_ids: [] }, max_hops: 3 }).success).toBe(false);
    expect(GraphPathResponse.safeParse({ path: null, max_hops: 3 }).success).toBe(true);
  });
});
