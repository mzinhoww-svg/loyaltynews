// Tipos do domínio editorial. Contratos compartilhados definitivos ficam em packages/contracts (Chief Architect);
// estes tipos são locais à Frente 06 e devem ser migrados quando o contrato existir.

import { ASSINATURA, EDITORIAS as EDITORIAS_CONTRATO } from '@ln/contracts';
import type { ContentType, DataClass, EditoriaSlug } from '@ln/contracts';

/** Slugs das dez editorias: fonte única em @ln/contracts (D13). */
export const EDITORIAS: readonly EditoriaSlug[] = EDITORIAS_CONTRATO.map((e) => e.slug);
export type Editoria = EditoriaSlug;

/** Assinatura institucional única (D09), definida em @ln/contracts. */
export const SIGNATURE = ASSINATURA;

export type SourceKind = 'investor_relations' | 'regulator' | 'press_room' | 'association' | 'government'
  // DP-29: blogs especializados e imprensa de nicho. São fonte de PAUTA e contexto; fatos precisam de âncora em fonte primária.
  | 'blog' | 'trade_media' | 'company_blog'
  // DP-51: site oficial do programa de fidelidade (emissor primário dos próprios fatos: regras, regulamentos, campanhas). Só páginas públicas.
  | 'loyalty_program';
/** primary = emissor oficial do fato (RI, regulador, governo, associação, sala de imprensa); secondary = blog/imprensa de nicho (relata o que outros disseram). */
export type AccessMode = 'padrao' | 'via-provedor';
export const ACESSO_VIA_PROVEDOR: AccessMode = 'via-provedor';
export type SourceTier = 'primary' | 'secondary';
export const SECONDARY_KINDS: readonly SourceKind[] = ['blog', 'trade_media', 'company_blog'];
export const sourceTier = (k: SourceKind): SourceTier => (SECONDARY_KINDS.includes(k) ? 'secondary' : 'primary');
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
  /** Sitemap declarado no robots.txt da fonte (alternativa ao feed; coleta espaçada). null/ausente = não usado. */
  sitemapUrl?: string | null;
  /** Só URLs do sitemap cujo caminho começa por este prefixo (ex.: '/noticias/'). */
  sitemapPathPrefix?: string | null;
  /**
   * Caminhos que o prefixo não consegue excluir (páginas de listagem, a própria seção): expressões regulares testadas contra o CAMINHO da URL
   * (sem host nem query), cada uma ancorada por quem cadastra. Casou, a URL não entra na coleta e é contada como "excluída". Máximo 10 padrões de até 120 caracteres.
   */
  sitemapPathExclude?: string[] | null;
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
  /**
   * DP-31/DP-32 (risco aceito pelo proprietário): fonte lida VIA PROVEDOR de leitura/desbloqueio (ReaderPort: Tavily, Bright Data,
   * Firecrawl e similares), em vez do coletor direto; ignora robots.txt e a recusa por UA/403 em página PÚBLICA, e o provedor pode resolver
   * CAPTCHA e usar proxies próprios. Ausente = acesso padrão do coletor direto, com todas as guardas.
   * Continua proibido: login e paywall, carga pesada, nada pago sem o proprietário. Só guarda trecho curto + link + data.   */
  acesso?: AccessMode;
  notes?: string;
  verification?: SourceVerification;
}

/** Resultado da pesquisa somente-leitura da fonte (não aprova uso; a aprovação é do QA/responsável). */
export interface SourceVerification {
  /** Identidade de quem pesquisou; o revisor que habilita a fonte NÃO pode ser a mesma. */
  researchedBy?: string;
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
  /** Nível da fonte no momento da coleta (ausente = primary, como nas evidências anteriores à DP-29). */
  sourceTier?: SourceTier;
  /** Links http(s) do corpo da página (até 25): usados para ANCORAR fatos de blog em fonte primária habilitada. */
  outboundLinks?: string[];
  /** 'via-provedor' quando lida por provedor de leitura (DP-31/DP-32); o texto guardado é só um trecho curto. */
  acesso?: AccessMode;
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
  /** Campos publicáveis (ADR-017 §4): exatamente os de PublishableContent. */
  slug: string;                 // gerado na 1ª redação a partir da manchete; único; imutável depois da 1ª publicação
  resumo: string;               // ≤ 300; obrigatório no gate de aprovação (WF02)
  subtitulo?: string;
  tipoConteudo: ContentType;    // padrão 'noticia'
  classeDeDado: DataClass;      // padrão 'public'
  patrocinado: boolean;         // o pipeline editorial nunca produz conteúdo patrocinado
  rotuloPublieditorial?: string;
  claims: Claim[];
  evidenceIds: string[];
  signature: string;
  image: ImageDecision;
  modelProvider: string;   // provedor que redigiu
  promptVersion: string;
  /** Conteúdo AUTORAL (DP-29): pauta própria da redação, ancorada em fontes primárias. Ausente = matéria de reescrita. */
  autoral?: { formato: AutoralFormat; pautaId: string };
}
export type AutoralFormat = 'analise' | 'explicador' | 'comparativo';
export const AUTORAL_FORMATS: readonly AutoralFormat[] = ['analise', 'explicador', 'comparativo'];

export type ImageDecision =
  | { mode: 'none'; reason: string }
  | { mode: 'source_image'; sourceId: string; url: string; credit: string; creditLink: string; basis: ImageRightsBasis | null; /** texto alternativo (acessibilidade) */ alt?: string }
  /**
   * Ilustração conceitual gerada (ADR-018). `generatedBy`, `promptVersion` e `promptSha256` são REGISTRO INTERNO (Blueprint §6):
   * nunca saem em ImageRights, API pública, EXIF/XMP, nome de arquivo ou texto alternativo. `humanReview` = revisão humana dos
   * limites de uso (sem detector automático de pessoa/marca/cena documental, o gate exige confirmação humana).
   */
  | { mode: 'conceptual'; url: string; alt: string; generatedBy: string; promptVersion: string; promptSha256: string; humanReview?: { reviewedBy: string; at: string; limitsConfirmed: true } };

export interface Finding { code: string; message: string; claimId?: string }
export interface CheckResult { verdict: Verdict; findings: Finding[] }
