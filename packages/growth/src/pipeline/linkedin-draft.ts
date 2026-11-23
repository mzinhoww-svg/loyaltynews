import { EDITORIAS, ILLUSTRATION_CREDIT } from '@ln/contracts';
import { CopyRefusal } from '../copy/engine';
import { CreativeRefusal } from '../creative/post';
import type { SocialCardInput } from '../creative/social-cards';
import type { GrowthFlags } from '../flags';
import { linkedinDraftMapper, type UploadedMedia } from '../mlabs/create-post-draft';
import type { McpTransport } from '../mlabs/live';
import { LIVE_ACK } from '../mlabs/live';
import type { PublishReceipt } from '../mlabs/port';
import { buildLinkedInPackage, type LinkedInPackage } from '../package/linkedin';
import { createSocialPublisher, PUBLISHER_SOCIAL, PublishRefused } from '../publisher/publisher';
import type { Article, Fact } from '../types';
import type { PutBytes, RasterizerPort, UploadLedger } from './raster-upload';

// Pipeline de ponta a ponta: matéria APROVADA e PUBLICADA na Fábrica editorial → rascunho LinkedIn no mLabs.
// DESLIGADO por padrão: sem a flag `growth_linkedin_live` (ou sem a configuração `live`) é só um ensaio no adaptador simulado.
// Nunca agenda e nunca publica: o único efeito possível é `create_post` com `status: "draft"` (linkedinDraftMapper).
// O texto vem do motor determinístico (só fatos checados com fonte), não do texto livre do modelo.

/** Imagem da matéria como a Fábrica a decide (estrutural; compatível com `ImageDecision` de @ln/editorial). */
export type PipelineImage =
  | { mode: 'none'; reason: string }
  | { mode: 'source_image'; url: string; credit: string; creditLink: string; basis: unknown | null; alt?: string }
  | { mode: 'conceptual'; url: string; alt: string };

/** Matéria da Fábrica (estrutural; um `ArticleRecord` de @ln/editorial é atribuível a este tipo, o teste confere em tempo de compilação). */
export interface PipelineArticleRecord {
  articleId: string;
  status: string;
  draft?: {
    headline: string;
    resumo: string;
    subtitulo?: string;
    editoria: string;
    patrocinado: boolean;
    rotuloPublieditorial?: string;
    /** Tipo do conteúdo na Fábrica; `analise` é conteúdo autoral (card de análise com selo). Ausente = matéria comum. */
    tipoConteudo?: string;
    claims: { id: string; text: string; kind: string; evidenceIds: string[] }[];
    image: PipelineImage;
  };
  factcheck?: { verdicts: { claimId: string; verdict: 'pass' | 'fail' | 'inconclusive' }[] };
  publication?: { receiptId: string; url: string; contentSha256: string; isMock?: boolean };
}

/** Pacote social da Fábrica (`SocialPack`); estrutural. Serve de conferência cruzada, não de fonte do texto. */
export interface PipelineSocialPack {
  articleId: string;
  linkedin: { text: string; url: string };
  image: { mode: 'none' | 'source_image' | 'conceptual'; label?: string };
  mentions: string[];
  blockers: string[];
}

export type DraftBlocker =
  | 'materia_nao_publicada'
  | 'sem_recibo_de_publicacao'
  | 'sem_rascunho'
  | 'pacote_social_ausente'
  | 'pacote_social_bloqueado'
  | 'pacote_de_outra_materia'
  | 'url_divergente'
  | 'mencao_nao_verificada'
  | 'sem_imagem_aprovada'
  | 'sem_fatos_checados'
  | 'regra_de_copy'
  | 'regra_de_criativo'
  | 'mock_nao_vai_ao_mlabs'
  | 'midia_nao_enviada'
  | 'rascunho_recusado';

export interface DraftStore {
  get(key: string): Promise<PublishReceipt | null>;
  put(key: string, receipt: PublishReceipt): Promise<void>;
}

export class InMemoryDraftStore implements DraftStore {
  private readonly rows = new Map<string, PublishReceipt>();
  async get(key: string) {
    const r = this.rows.get(key);
    return r ? structuredClone(r) : null;
  }
  async put(key: string, receipt: PublishReceipt) {
    this.rows.set(key, structuredClone(receipt));
  }
}

export interface LiveDraftConfig {
  transport: McpTransport;
  /** Id opaco do perfil (`ext_…`, de list_profiles). */
  profileId: string;
  /** Rasterizador SVG→PNG (UI/UX). A mídia só sobe pelo publicador (`publisher.uploadMedia`): não há outro caminho. */
  rasterizer: RasterizerPort;
  /** PUT dos bytes: só testes injetam; o modo real usa `fetch`. */
  putBytes?: PutBytes;
  /** Registro durável dos envios de mídia (chave = hash do SVG): sem ele, reexecutar sem o registro local sobe a imagem de novo. */
  uploadLedger?: UploadLedger;
}

export interface DraftPipelineDeps {
  /** Flags lidas a cada execução. Sem `growth_linkedin_live`, ou sem `live`, é ensaio simulado. */
  flags: () => GrowthFlags;
  now: () => string;
  store: DraftStore;
  /** Só é usada com a flag ligada. */
  live?: LiveDraftConfig;
}

export interface DraftPipelineSummary {
  articleId: string;
  /** `simulated`: ensaio (nada sai do processo). `live`: create_post com status draft no transporte informado. */
  mode: 'simulated' | 'live';
  receipt: PublishReceipt;
  /** `true` quando o rascunho já existia (reenvio não duplica). */
  existing: boolean;
  idempotencyKey: string;
  creativeSha256: string;
  imageRef: string;
  /** Avisos que NÃO bloqueiam um rascunho (ex.: brandkit ainda é proposta). */
  warnings: string[];
}

export type DraftPipelineResult =
  | { ok: true; summary: DraftPipelineSummary }
  | { ok: false; blockers: DraftBlocker[]; detail: string[] };

const PUBLISHED = new Set(['publicado', 'corrigido']);

function stripUtm(url: string): string {
  try {
    const u = new URL(url);
    for (const k of [...u.searchParams.keys()]) if (k.startsWith('utm_')) u.searchParams.delete(k);
    return u.toString();
  } catch {
    return url;
  }
}

/** Fatos aprovados: afirmações `fact|number|date` com checagem `pass` e evidência. Citações literais ficam de fora. */
export function approvedFacts(rec: PipelineArticleRecord): Fact[] {
  const d = rec.draft;
  if (!d) return [];
  const verdict = new Map((rec.factcheck?.verdicts ?? []).map((v) => [v.claimId, v.verdict]));
  return d.claims
    .filter((c) => ['fact', 'number', 'date'].includes(c.kind) && c.evidenceIds.length > 0 && verdict.get(c.id) === 'pass')
    .map((c) => ({ text: c.text, source: `evidence:${c.evidenceIds.join(',')}` }));
}

/** Projeta a matéria publicada para a entrada do Growth. `null` e blockers explicam o que falta. */
export function toGrowthArticle(rec: PipelineArticleRecord, pack: PipelineSocialPack): { article: SocialCardInput } | { blockers: DraftBlocker[]; detail: string[] } {
  const blockers: DraftBlocker[] = [];
  const detail: string[] = [];
  const d = rec.draft;
  if (!PUBLISHED.has(rec.status)) {
    blockers.push('materia_nao_publicada');
    detail.push(`status "${rec.status}"`);
  }
  if (!rec.publication?.receiptId || !rec.publication.url) blockers.push('sem_recibo_de_publicacao');
  if (!d) blockers.push('sem_rascunho');
  if (pack.articleId !== rec.articleId) blockers.push('pacote_de_outra_materia');
  if (pack.blockers.length > 0) {
    blockers.push('pacote_social_bloqueado');
    detail.push(...pack.blockers);
  }
  if (pack.mentions.length > 0) blockers.push('mencao_nao_verificada');
  if (rec.publication?.url && stripUtm(pack.linkedin.url) !== stripUtm(rec.publication.url)) blockers.push('url_divergente');
  if (!d || !rec.publication || blockers.length) return { blockers: [...new Set(blockers)], detail };

  let approvedImage: Article['approvedImage'];
  if (d.image.mode === 'conceptual') approvedImage = { ref: d.image.url, credit: ILLUSTRATION_CREDIT };
  else if (d.image.mode === 'source_image' && d.image.basis) approvedImage = { ref: d.image.url, credit: d.image.credit, creditUrl: d.image.creditLink };
  if (!approvedImage) return { blockers: ['sem_imagem_aprovada'], detail: [d.image.mode === 'none' ? d.image.reason : 'imagem de terceiro sem base de direito'] };

  const facts = approvedFacts(rec);
  if (facts.length === 0) return { blockers: ['sem_fatos_checados'], detail: ['nenhuma afirmação com checagem aprovada e evidência'] };

  const editoria = EDITORIAS.find((e) => e.slug === d.editoria)?.nome ?? d.editoria;
  return {
    article: {
      id: rec.articleId,
      title: d.headline,
      deck: d.subtitulo ?? d.resumo,
      editoria,
      url: rec.publication.url,
      facts,
      approvedImage,
      gatesPassed: true, // aprovada (WF02) e publicada (WF03) pela Fábrica
      mock: rec.publication.isMock === true,
      sponsored: d.patrocinado ? { label: d.rotuloPublieditorial ?? '' } : undefined,
      ...(d.tipoConteudo === 'analise' ? { autoral: { formato: 'analise' as const } } : {}),
    },
  };
}

/** Roda o pipeline para UMA matéria. Idempotente por (matéria, hash do conteúdo publicado). */
export async function runLinkedInDraftPipeline(
  deps: DraftPipelineDeps,
  rec: PipelineArticleRecord,
  pack: PipelineSocialPack | undefined,
): Promise<DraftPipelineResult> {
  if (!pack) return { ok: false, blockers: ['pacote_social_ausente'], detail: [] };
  const mapped = toGrowthArticle(rec, pack);
  if ('blockers' in mapped) return { ok: false, blockers: mapped.blockers, detail: mapped.detail };
  const { article } = mapped;

  const flags = deps.flags();
  const live = flags.growth_linkedin_live === true && deps.live !== undefined ? deps.live : undefined;
  if (live && article.mock) return { ok: false, blockers: ['mock_nao_vai_ao_mlabs'], detail: ['matéria de demonstração (MOCK) nunca vai ao mLabs real'] };

  const key = `${rec.articleId}:linkedin:draft:${(rec.publication as NonNullable<PipelineArticleRecord['publication']>).contentSha256.slice(0, 16)}`;
  const prior = await deps.store.get(key);

  let pkg: LinkedInPackage;
  try {
    pkg = buildLinkedInPackage(article, { carousel: false });
  } catch (e) {
    if (e instanceof CopyRefusal) return { ok: false, blockers: ['regra_de_copy'], detail: e.violations.map((v) => v.rule) };
    if (e instanceof CreativeRefusal) return { ok: false, blockers: ['regra_de_criativo'], detail: [e.rule] };
    throw e;
  }
  const warnings = pkg.blockers.filter((b) => b.startsWith('brandkit_'));
  // Bloqueios do pacote que impedem até um rascunho (os de brandkit são só aviso: rascunho não é público).
  const hard = pkg.blockers.filter((b) => !b.startsWith('brandkit_') && b !== 'mock_nao_publicavel');
  if (hard.length) return { ok: false, blockers: ['pacote_social_bloqueado'], detail: hard };

  const base = { articleId: rec.articleId, idempotencyKey: key, creativeSha256: pkg.creativeSha256, imageRef: pkg.imageRef, warnings };
  if (prior) return { ok: true, summary: { ...base, mode: live ? 'live' : 'simulated', receipt: prior, existing: true } };

  // Mídia e publicador: só no modo real. No ensaio, o adaptador simulado do próprio publicador. A mídia sobe PELO publicador
  // (identidade, flag e capability dele; auditada): o mapeador lê `uploads` só na hora do create_post.
  const uploads: Record<string, UploadedMedia> = {};
  const publisher = live
    ? createSocialPublisher({
        mode: 'live',
        transport: live.transport,
        liveAck: LIVE_ACK,
        actor: PUBLISHER_SOCIAL,
        flags: deps.flags,
        payloadMapper: linkedinDraftMapper({ profileId: live.profileId, uploads, now: deps.now }),
        media: { rasterizer: live.rasterizer, putBytes: live.putBytes, ledger: live.uploadLedger },
        now: deps.now,
      })
    : createSocialPublisher({ mode: 'simulated', flags: deps.flags, now: deps.now });
  if (live) {
    try {
      uploads[pkg.imageRef] = await publisher.uploadMedia(PUBLISHER_SOCIAL, pkg.creative, pkg.imageRef);
    } catch (e) {
      return { ok: false, blockers: ['midia_nao_enviada'], detail: [e instanceof Error ? e.message : 'falha no envio da mídia'] };
    }
  }

  let receipt: PublishReceipt;
  try {
    receipt = await publisher.publish(PUBLISHER_SOCIAL, { ...pkg.publishRequest, idempotencyKey: key });
  } catch (e) {
    if (e instanceof PublishRefused) return { ok: false, blockers: ['rascunho_recusado'], detail: [e.reason] };
    throw e;
  }
  await deps.store.put(key, receipt);
  return { ok: true, summary: { ...base, mode: live ? 'live' : 'simulated', receipt, existing: false } };
}
