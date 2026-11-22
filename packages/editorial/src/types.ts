// Tipos do domínio editorial. Contratos compartilhados definitivos ficam em packages/contracts (Chief Architect);
// estes tipos são locais à Frente 06 e devem ser migrados quando o contrato existir.

import { ASSINATURA, EDITORIAS as EDITORIAS_CONTRATO } from '@ln/contracts';
import type { EditoriaSlug } from '@ln/contracts';

/** Slugs das dez editorias: fonte única em @ln/contracts (D13). */
export const EDITORIAS: readonly EditoriaSlug[] = EDITORIAS_CONTRATO.map((e) => e.slug);
export type Editoria = EditoriaSlug;

/** Assinatura institucional única (D09), definida em @ln/contracts. */
export const SIGNATURE = ASSINATURA;

export type SourceKind = 'investor_relations' | 'regulator' | 'press_room' | 'association' | 'government';
/** Estado da revisão dos termos de uso (J-14 do Blueprint: termos de cada fonte não verificados). */
export type TermsStatus = 'pending' | 'approved' | 'denied';

export interface Source {
  id: string;
  name: string;
  kind: SourceKind;
  editorias: Editoria[];
  /** Host exato permitido para coleta (sem curinga). */
  host: string;
  /** Para hosts compartilhados (ex.: www.gov.br): prefixo de caminho do órgão, ex.: '/anpd'. null = host inteiro. */
  pathPrefix?: string | null;
  /** URL de listagem pública (página de notícias/comunicados). null = não identificada. */
  listingUrl: string | null;
  /** URL de feed RSS/Atom. null = não identificado (nunca inventar). */
  feedUrl: string | null;
  termsUrl: string | null;
  termsStatus: TermsStatus;
  /** URL/host conferidos manualmente por humano/QA? Seed inicial = false. */
  urlVerified: boolean;
  robotsRespected: true;
  paywall: 'none' | 'login' | 'metered' | 'unknown';
  /** Coleta só ocorre se enabled && termsStatus==='approved' && urlVerified. */
  enabled: boolean;
  /** Direito de uso de imagem da fonte: base registrada (licença, autorização, domínio público, exceção validada). */
  imageRights: ImageRightsBasis | null;
  maxRequestsPerHour: number;
  notes?: string;
  verification?: SourceVerification;
}

/** Resultado da pesquisa somente-leitura da fonte (não aprova uso; a aprovação é do QA/responsável). */
export interface SourceVerification {
  level: 'lido' | 'parcial' | 'inacessivel';
  robots: 'permitido' | 'bloqueado' | 'indisponivel';
  robotsNote: string;
  /** Trecho literal curto dos termos; null = não encontrado. */
  termsExcerpt: string | null;
  termsFetchedAt: string | null;
  consultedAt: string | null;
  imageRightsNote: string;
  notes: string;
}

export type RightsBasisKind = 'license' | 'authorization' | 'public_domain' | 'validated_exception';
export interface ImageRightsBasis {
  kind: RightsBasisKind;
  reference: string;       // id do documento/licença/autorização
  registeredAt: string;    // ISO
  validatedBy: string;     // identidade que registrou (não agente de redação)
}

export interface Evidence {
  id: string;
  sourceId: string;
  url: string;
  canonicalUrl: string;
  fetchedAt: string;       // ISO
  contentSha256: string;
  title: string;
  text: string;            // texto saneado (sem HTML/script)
  publishedAt: string | null;
  suspicious: boolean;     // instrução embutida detectada
  suspiciousReasons: string[];
}

export type Verdict = 'pass' | 'fail' | 'inconclusive';

export interface Claim {
  id: string;
  text: string;
  kind: 'fact' | 'number' | 'quote' | 'date';
  evidenceIds: string[];
  /** Para kind='quote': texto literal e atribuição; só vale se aparece verbatim na evidência. */
  quote?: { text: string; speaker: string };
}

export interface Draft {
  id: string;
  editoria: Editoria;
  headline: string;
  body: string;
  claims: Claim[];
  evidenceIds: string[];
  signature: string;
  image: ImageDecision;
  modelProvider: string;   // provedor que redigiu
  promptVersion: string;
}

export type ImageDecision =
  | { mode: 'none'; reason: string }
  | { mode: 'source_image'; sourceId: string; url: string; credit: string; creditLink: string; basis: ImageRightsBasis | null }
  | { mode: 'conceptual'; label: string; generatedBy: string };

export interface Finding { code: string; message: string; claimId?: string }
export interface CheckResult { verdict: Verdict; findings: Finding[] }
