// Entity Intelligence no Studio: tipos do que as rotas /api/studio/intelligence/** devolvem e regras de exibição. Funções puras.
// Regra de exibição (a mesma do portal): fato + fonte + link + data; NUNCA o trecho da página; is_mock ⇒ escrever MOCK.

export interface EvidenciaRef {
  id: string;
  source_url: string;
  source_name: string;
  retrieved_at: string;
  is_mock: boolean;
}
export type Certeza = 'declared' | 'inferred';

export interface OrganizacaoLinha {
  id: string;
  legal_name: string;
  trade_name: string | null;
  kind: string;
}
export interface PessoaNoCargo {
  person_id: string;
  full_name: string;
  title: string;
  certainty: Certeza;
  evidence_id: string;
  validated_at: string;
}
export interface RelacaoLinha {
  id: string;
  type: string;
  direction: 'from' | 'to';
  other_org_id: string;
  other_org_name: string;
  valid_from: string;
  valid_to: string | null;
  certainty: Certeza;
  validated_at: string;
  evidence: EvidenciaRef;
}
export interface EmpresaDetalhe {
  organization: OrganizacaoLinha & { observed_at: string; evidence: EvidenciaRef };
  as_of: string;
  people: PessoaNoCargo[];
  relations: RelacaoLinha[];
  notice: string;
}
export interface CargoLinha {
  role_id: string;
  organization_id: string;
  organization: string;
  title: string;
  valid_from: string;
  valid_to: string | null;
  certainty: Certeza;
  validated_at: string;
  evidence: EvidenciaRef;
}
export interface LeituraDoCargo {
  role_id: string;
  organization: string;
  title: string;
  valid_from: string;
  valid_to: string | null;
  certainty: Certeza;
  validated_at: string;
  evidence: EvidenciaRef;
}
export interface MoveLinha {
  id: string;
  kind: 'appointment' | 'departure' | 'title_change' | 'org_change';
  basis: 'announcement' | 'observed_diff';
  status: 'detected' | 'confirmed' | 'rejected';
  person_id: string;
  person_name: string;
  from_organization: string | null;
  from_title: string | null;
  to_organization: string | null;
  to_title: string | null;
  effective_date: string | null;
  observed_on: string;
  evidence: EvidenciaRef;
  /** Presentes quando o Backend traz o modelo de duas leituras (ft/intelligence 5074064); senão só os atalhos from_/to_. */
  before?: LeituraDoCargo | null;
  after?: LeituraDoCargo | null;
}

/** Nível do cargo: leitura OFICIAL (declarado) ou SECUNDÁRIA (inferido: LinkedIn/The Org, "a confirmar"). */
export function nivelDoCargo(certeza: Certeza): { chave: 'oficial' | 'secundaria'; rotulo: string } {
  return certeza === 'declared' ? { chave: 'oficial', rotulo: 'Oficial' } : { chave: 'secundaria', rotulo: 'Secundária — a confirmar' };
}

/** Fonte + data (+ MOCK). O link é a source_url; o trecho nunca existe aqui. */
export function textoDaEvidencia(e: EvidenciaRef): string {
  return `${e.source_name} · ${e.retrieved_at.slice(0, 10)}${e.is_mock ? ' · MOCK' : ''}`;
}

export const ROTULO_MOVE: Record<MoveLinha['kind'], string> = {
  appointment: 'Nomeação',
  departure: 'Saída',
  title_change: 'Mudança de cargo',
  org_change: 'Mudança de empresa',
};
export const ROTULO_BASE: Record<MoveLinha['basis'], string> = {
  announcement: 'anunciado pela fonte',
  observed_diff: 'diferença entre duas leituras',
};

export interface LadoDoMove {
  rotulo: 'Antes' | 'Depois';
  /** null = não existe (nomeação não tem antes; saída não tem depois). */
  cargo: { organizacao: string; titulo: string } | null;
  evidencia: EvidenciaRef | null;
  validadoEm: string | null;
}

/**
 * Antes e depois do Move. Com before/after do Backend traz a evidência de cada leitura; sem eles, cai nos atalhos from_/to_ (sem evidência
 * por lado, e a de "depois" é a que detectou o Move). Nada é inventado: lado inexistente vira `cargo: null`.
 */
export function antesEDepois(m: MoveLinha): [LadoDoMove, LadoDoMove] {
  const antes: LadoDoMove = m.before
    ? { rotulo: 'Antes', cargo: { organizacao: m.before.organization, titulo: m.before.title }, evidencia: m.before.evidence, validadoEm: m.before.validated_at }
    : { rotulo: 'Antes', cargo: m.from_title || m.from_organization ? { organizacao: m.from_organization ?? '—', titulo: m.from_title ?? '—' } : null, evidencia: null, validadoEm: null };
  const depois: LadoDoMove = m.after
    ? { rotulo: 'Depois', cargo: { organizacao: m.after.organization, titulo: m.after.title }, evidencia: m.after.evidence, validadoEm: m.after.validated_at }
    : { rotulo: 'Depois', cargo: m.to_title || m.to_organization ? { organizacao: m.to_organization ?? '—', titulo: m.to_title ?? '—' } : null, evidencia: m.evidence, validadoEm: null };
  return [antes, depois];
}
