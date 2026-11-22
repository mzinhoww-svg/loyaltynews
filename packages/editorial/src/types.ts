// Tipos do domínio editorial. Contratos compartilhados definitivos ficam em packages/contracts (Chief Architect);
// estes tipos são locais à Frente 06 e devem ser migrados quando o contrato existir.

export const EDITORIAS = [
  'mercado-negocios', 'programas-fidelidade', 'pontos-milhas', 'bancos-cartoes', 'varejo-cashback',
  'travel-hospitality', 'loyaltytech-ia', 'crm-cx', 'global-loyalty', 'regulacao-dados',
] as const;
export type Editoria = (typeof EDITORIAS)[number];

export const SIGNATURE = 'Redação Loyalty News';

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
