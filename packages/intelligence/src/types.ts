export type Certainty = 'declared' | 'inferred';
export type Uuid = string;

export interface EvidenceInput {
  sourceUrl: string;
  sourceName: string;
  retrievedAt: string; // ISO
  contentHash?: string;
  excerpt?: string; // ≤ 500 caracteres
  isMock?: boolean;
}

export interface Provenance {
  evidenceId: Uuid;
  observedAt: string; // ISO
}

export interface RoleObservation {
  personName: string;
  publicProfileUrl?: string;
  orgName: string;
  title: string;
  evidenceId: Uuid;
  observedAt: string; // ISO
  /** 'present' = a fonte mostra a pessoa neste cargo; 'left' = a fonte diz que saiu. */
  kind: 'present' | 'left';
  /** Preencha só se a própria fonte anuncia a mudança (comunicado/nota). Sem isso, primeira observação é linha de base, não Move. */
  announcement?: { effectiveDate?: string };
  /** Campos além de nome/cargo/empresa: recusados com a flag desligada. */
  extra?: Record<string, unknown>;
}

export type MoveKind = 'appointment' | 'departure' | 'title_change' | 'org_change';
export interface MoveRow {
  id: Uuid;
  person_id: Uuid;
  kind: MoveKind;
  basis: 'announcement' | 'observed_diff';
  from_role_id: Uuid | null;
  to_role_id: Uuid | null;
  effective_date: string | null;
  observed_on: string;
  evidence_id: Uuid;
  status: 'detected' | 'confirmed' | 'rejected';
}
