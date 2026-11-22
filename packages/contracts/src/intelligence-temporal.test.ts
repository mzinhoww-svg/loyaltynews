import { describe, expect, it } from 'vitest';
import { MoveView, PersonRoleView, PersonView, RoleObservation } from './index';

const ev = { id: '2b8f1c1e-9b1a-4d7e-8a8a-3f4c5d6e7f80', source_url: 'https://example.org/n', source_name: 'Fonte', retrieved_at: '2026-11-20T10:00:00.000Z', is_mock: false };
const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

describe('Intelligence — modelo temporal', () => {
  it('pessoa: só nome e perfil público, com evidência (P4)', () => {
    expect(PersonView.safeParse({ id: uuid(1), full_name: 'Ana', evidence: ev }).success).toBe(true);
    expect(PersonView.safeParse({ id: uuid(1), full_name: 'Ana', evidence: ev, email: 'a@b.com' }).success).toBe(false);
  });
  it('cargo traz vigência, certeza, validação e evidência', () => {
    const r = { role_id: uuid(2), organization_id: uuid(3), organization: 'Alfa', title: 'CEO', valid_from: '2026-01-01', valid_to: null, certainty: 'declared', validated_at: '2026-11-20T10:00:00.000Z', evidence: ev };
    expect(PersonRoleView.safeParse(r).success).toBe(true);
    expect(PersonRoleView.safeParse({ ...r, certainty: 'provavel' }).success).toBe(false);
    expect(PersonRoleView.safeParse({ ...r, valid_to: '2025-12-31' }).success).toBe(false);
    expect(PersonRoleView.safeParse({ ...r, validated_at: undefined }).success).toBe(false);
  });
  it('Move: estado de revisão e data efetiva só quando declarada', () => {
    const m = { id: uuid(4), kind: 'appointment', basis: 'announcement', status: 'detected', person_id: uuid(1), person_name: 'Ana', from_organization: null, from_title: null, to_organization: 'Alfa', to_title: 'CEO', effective_date: null, observed_on: '2026-11-20', evidence: ev };
    expect(MoveView.safeParse(m).success).toBe(true);
    expect(MoveView.safeParse({ ...m, status: 'publicado' }).success).toBe(false);
  });
  it('observação de ingestão role-observation/1', () => {
    expect(RoleObservation.safeParse({ personName: 'Ana', orgName: 'Alfa', title: 'CEO', evidenceId: uuid(5), observedAt: '2026-11-20T10:00:00Z', kind: 'present' }).success).toBe(true);
    expect(RoleObservation.safeParse({ personName: 'Ana', orgName: 'Alfa', title: 'CEO', evidenceId: uuid(5), observedAt: '2026-11-20T10:00:00Z', kind: 'talvez' }).success).toBe(false);
  });
});
