import { ILLUSTRATION_CREDIT } from '@ln/contracts';
import { publishedContentSha256 } from '@ln/contracts/hash';
import type { PublishableContent } from '@ln/contracts';
import type { Draft, RightsBasisKind } from './types';
import { sha256 } from './dedupe/dedupe';
import type { ArticleRecord } from './api/store';

/**
 * Campos publicáveis do Draft e a derivação ÚNICA Draft → PublishableContent (ADR-017 §3 e §4).
 * O Backend usa `toPublishableContent(rec)` para o upsert em `articles` e para o hash do recibo; não reimplementa.
 */

export const RESUMO_MAX = 300;
export const SLUG_MAX = 120;
export const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** Padrões do rascunho editorial: notícia pública, não patrocinada (conteúdo pago é do módulo Comercial). */
export const PUBLISHABLE_DEFAULTS = { tipoConteudo: 'noticia', classeDeDado: 'public', patrocinado: false } as const;

/** Slug a partir da manchete: minúsculas, sem acento, hífens, até SLUG_MAX sem cortar palavra no meio. */
export function slugify(headline: string): string {
  const base = headline.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  let s = base.slice(0, 80);
  if (base.length > 80) s = s.replace(/-[^-]*$/, '') || s;
  s = s.replace(/^-+|-+$/g, '');
  return s || 'materia';
}

/** Slug único: acrescenta -2, -3... enquanto `exists` disser que está ocupado (a unicidade final é do banco). */
export async function uniqueSlug(headline: string, exists?: (slug: string) => Promise<boolean>): Promise<string> {
  const base = slugify(headline);
  if (!exists) return base;
  for (let i = 1; i <= 99; i++) {
    const cand = i === 1 ? base : `${base}-${i}`;
    if (!(await exists(cand))) return cand;
  }
  return `${base}-${Date.now().toString(36)}`;
}

export const ALT_PREFIX = 'Ilustração conceitual: ';

const BASIS: Record<RightsBasisKind, 'licenca' | 'autorizacao' | 'dominio_publico' | 'excecao_validada'> = {
  license: 'licenca', authorization: 'autorizacao', public_domain: 'dominio_publico', validated_exception: 'excecao_validada',
};

/**
 * Draft.image → `ImageRights` de @ln/contracts (ou null sem imagem). Sem base de direito registrada, `baseDeDireito: 'pendente'`
 * (não publicável, D08). Ilustração conceitual gerada (ADR-018) → origem 'ilustracao_gerada' + base 'gerada_ia', crédito institucional
 * fixo e SEM nenhum dado interno (generatedBy, promptVersion, promptSha256 ficam só no registro editorial).
 */
export function imageToRights(d: Draft): unknown {
  const img = d.image;
  if (img.mode === 'none') return null;
  if (img.mode === 'conceptual') {
    const alt = img.alt.trim();
    return {
      url: img.url, origem: 'ilustracao_gerada', credito: ILLUSTRATION_CREDIT, baseDeDireito: 'gerada_ia', edicoes: [],
      textoAlternativo: alt.startsWith(ALT_PREFIX) ? alt : `${ALT_PREFIX}${alt}`,
    };
  }
  return {
    url: img.url, origem: 'fonte_terceiro', credito: img.credit, link: img.creditLink,
    baseDeDireito: img.basis ? BASIS[img.basis.kind] : 'pendente', edicoes: [],
    textoAlternativo: img.alt?.trim() || `Imagem da matéria: ${d.headline}`,
  };
}

/** Conteúdo publicável do rascunho editorial (a entrada de `publishedContentSha256`). Aceita o Draft ou o registro da matéria. */
export function toPublishableContent(x: Draft | Pick<ArticleRecord, 'draft'>): PublishableContent {
  const d = 'headline' in x ? x : x.draft;
  if (!d) throw new Error('toPublishableContent: matéria sem rascunho');
  return {
    titulo: d.headline, subtitulo: d.subtitulo ?? null, resumo: d.resumo, tipoConteudo: d.tipoConteudo, editoria: d.editoria, corpo: d.body,
    imagem: imageToRights(d), classeDeDado: d.classeDeDado, patrocinado: d.patrocinado, rotuloPublieditorial: d.rotuloPublieditorial ?? null,
    fontes: d.evidenceIds,
  };
}

/** Hash do recibo (`publishedContentSha256`, ln-published-content/1) sobre o rascunho aprovado. Mesmo valor: recibo, outbox, publication. */
export const draftContentSha256 = (x: Draft | Pick<ArticleRecord, 'draft'>): string => publishedContentSha256(toPublishableContent(x));

/**
 * Monta a decisão de ilustração a partir do resultado do gerador (a geração está DESLIGADA: `modelosHabilitados`). O hash do
 * prompt vai ao registro interno; o prompt em si não é guardado aqui. Nasce SEM revisão humana: o gate bloqueia até alguém
 * confirmar os limites de uso (`confirmIllustrationLimits`).
 */
export function makeIllustration(input: { url: string; alt: string; generatedBy: string; promptVersion: string; prompt: string }): Extract<Draft['image'], { mode: 'conceptual' }> {
  return { mode: 'conceptual', url: input.url, alt: input.alt, generatedBy: input.generatedBy, promptVersion: input.promptVersion, promptSha256: sha256(input.prompt) };
}
