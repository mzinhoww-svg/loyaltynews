// Creative Studio (/api/studio/creative/**): cards sociais por código (renderSocialCard do @ln/growth) a partir de matérias, com revisão.
// Contrato: fast-track/contratos/creative-studio-api.md (Studio 2 e Studio 3). NADA aqui publica, agenda ou chama o mLabs:
// "aprovado" só significa pronto para o pacote da Integration. RBAC pelo recurso `social`: read lê, create cria e manda para revisão,
// publish aprova/rejeita; quem criou não revisa o próprio card (409 SAME_REVIEWER). Toda transição vai à auditoria (ator, de→para, motivo).
import { createHash } from 'node:crypto';
import { and, count, desc, eq, type SQL } from 'drizzle-orm';
import { z } from 'zod';
import { schema } from '@ln/db';
import { safeErr } from '@ln/db/safe-log';
import { audit, can } from '@ln/auth';
import { CreativeRefusal, renderSocialCard, type CreativeAsset, type SocialCardInput } from '@ln/growth';
import { PgArticleSource } from './social/articles';
import { HttpError, json, newId, parse, Paging, queryObject, readBody, type RouteCtx, type RouteFn } from './http';

type Card = typeof schema.creativeCards.$inferSelect;
export type CardEstado = 'rascunho' | 'em_revisao' | 'aprovado' | 'rejeitado';

const Kind = z.enum(['materia', 'analise']);
const Format = z.enum(['linkedin_landscape', 'square']);
const Estado = z.enum(['rascunho', 'em_revisao', 'aprovado', 'rejeitado']);
export const CardInput = z.strictObject({
  articleId: z.string().min(1).max(200),
  kind: Kind,
  format: Format,
  /** Só vale para matéria do tipo `analise` (conteúdo autoral); padrão `analise`. */
  autoralFormato: z.enum(['analise', 'explicador', 'comparativo']).optional(),
});
const Transicao = z.strictObject({ para: Estado, motivo: z.string().trim().max(500).optional() });
const CardsQuery = z.object({ estado: Estado.optional(), articleId: z.string().min(1).max(200).optional() }).extend(Paging.shape);

/** Quem pode ir de cada estado para cada estado, e com qual ação do RBAC. `aprovado` é final (para mudar, gere outro card). */
const TRANSICOES: Record<CardEstado, Partial<Record<CardEstado, 'create' | 'publish'>>> = {
  rascunho: { em_revisao: 'create' },
  em_revisao: { aprovado: 'publish', rejeitado: 'publish', rascunho: 'create' },
  rejeitado: { rascunho: 'create' },
  aprovado: {},
};

const sha256 = (s: string) => createHash('sha256').update(s, 'utf8').digest('hex');
const unesc = (s: string) => s.replace(/&quot;/g, '"').replace(/&gt;/g, '>').replace(/&lt;/g, '<').replace(/&amp;/g, '&');
/** Mesmo texto alternativo que o rasterizador do Growth usa (<desc>, senão <title>). */
export const altOf = (svg: string) => unesc(/<desc>([\s\S]*?)<\/desc>/.exec(svg)?.[1] ?? /<title>([\s\S]*?)<\/title>/.exec(svg)?.[1] ?? '').trim();

interface Rendered { asset: CreativeAsset; svgSha256: string; altText: string; articleTitulo: string }

async function render(c: RouteCtx, input: z.output<typeof CardInput>): Promise<Rendered> {
  const [row] = await c.deps.db.select({ titulo: schema.articles.titulo, tipo: schema.articles.tipoConteudo }).from(schema.articles).where(eq(schema.articles.id, input.articleId));
  if (!row) throw new HttpError(404, 'NOT_FOUND', 'Matéria não encontrada.');
  const art = await new PgArticleSource(c.deps.db, process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000').get(input.articleId);
  if (!art) throw new HttpError(404, 'NOT_FOUND', 'Matéria não encontrada.');
  // Conteúdo autoral = matéria do tipo `analise` (DP-29). O Growth recusa card de análise sem autoral e card de matéria com autoral.
  const card: SocialCardInput = row.tipo === 'analise' ? { ...art, autoral: { formato: input.autoralFormato ?? 'analise' } } : art;
  let asset: CreativeAsset;
  try {
    asset = renderSocialCard(card, { format: input.format, kind: input.kind });
  } catch (e) {
    if (e instanceof CreativeRefusal) throw new HttpError(422, 'CREATIVE_REFUSED', e.message, { motivo: e.rule });
    throw e;
  }
  return { asset, svgSha256: sha256(asset.svg), altText: altOf(asset.svg), articleTitulo: row.titulo };
}

const cardView = (k: Card, articleTitulo: string | null) => ({
  id: k.id,
  articleId: k.articleId,
  articleTitulo,
  kind: k.kind,
  format: k.format,
  autoralFormato: k.autoralFormato,
  estado: k.estado,
  svgSha256: k.svgSha256,
  altText: k.altText,
  width: k.width,
  height: k.height,
  mock: k.mock,
  brandStatus: k.brandStatus,
  criadoPor: k.criadoPor,
  criadoEm: k.criadoEm.toISOString(),
  revisadoPor: k.revisadoPor,
  revisadoEm: k.revisadoEm?.toISOString() ?? null,
  motivo: k.motivo,
});

async function loadCard(c: RouteCtx, id: string): Promise<{ card: Card; titulo: string | null }> {
  const [r] = await c.deps.db
    .select({ card: schema.creativeCards, titulo: schema.articles.titulo })
    .from(schema.creativeCards)
    .leftJoin(schema.articles, eq(schema.articles.id, schema.creativeCards.articleId))
    .where(eq(schema.creativeCards.id, id));
  if (!r) throw new HttpError(404, 'NOT_FOUND', 'Card não encontrado.');
  return { card: r.card, titulo: r.titulo };
}

export const listTemplates: RouteFn = async () =>
  json({
    items: [
      { kind: 'materia', formats: Format.options, descricao: 'Card de matéria: editoria, manchete, apoio opcional, ilustração de contexto e logo. Nunca leva o selo de autoral.' },
      { kind: 'analise', formats: Format.options, descricao: 'Card de análise: só para conteúdo autoral (matéria do tipo analise), com selo CONTEÚDO AUTORAL, formato e assinatura da redação.' },
    ],
  });

/** Prévia: não grava nada. O SVG vai como texto (a tela o mostra como imagem data:). */
export const previewCard: RouteFn = async (req, c) => {
  const r = await render(c, await readBody(req, CardInput));
  return json({ svg: r.asset.svg, altText: r.altText, width: r.asset.width, height: r.asset.height, svgSha256: r.svgSha256, mock: r.asset.mock, brandStatus: r.asset.brandStatus, refusal: null });
};

/** Cria o card em rascunho. Idempotente: mesma matéria + formato + SVG devolve o existente (200). */
export const createCard: RouteFn = async (req, c) => {
  const input = await readBody(req, CardInput);
  const r = await render(c, input);
  const id = newId();
  const now = c.deps.now();
  const inserted = await c.deps.db
    .insert(schema.creativeCards)
    .values({
      id, articleId: input.articleId, kind: input.kind, format: input.format, autoralFormato: input.kind === 'analise' ? (input.autoralFormato ?? 'analise') : null,
      estado: 'rascunho', svg: r.asset.svg, svgSha256: r.svgSha256, altText: r.altText, width: r.asset.width, height: r.asset.height,
      mock: r.asset.mock, brandStatus: r.asset.brandStatus, criadoPor: c.session!.userId, criadoEm: now,
    })
    .onConflictDoNothing()
    .returning({ id: schema.creativeCards.id });
  if (inserted.length === 0) {
    const [old] = await c.deps.db
      .select()
      .from(schema.creativeCards)
      .where(and(eq(schema.creativeCards.articleId, input.articleId), eq(schema.creativeCards.format, input.format), eq(schema.creativeCards.svgSha256, r.svgSha256)));
    return json({ card: cardView(old!, r.articleTitulo), existente: true }, 200);
  }
  await audit(c.deps.db, { actorId: c.session!.userId, actorRole: c.session!.role, action: 'creative.card_criado', resource: 'social', resourceId: id, ip: c.ip, detalhe: { requestId: c.requestId, articleId: input.articleId, kind: input.kind, format: input.format, svgSha256: r.svgSha256 }, at: now });
  const { card, titulo } = await loadCard(c, id);
  return json({ card: cardView(card, titulo), existente: false }, 201);
};

export const listCards: RouteFn = async (_req, c) => {
  const q = parse(CardsQuery, queryObject(c.url));
  const conds: (SQL | undefined)[] = [q.estado ? eq(schema.creativeCards.estado, q.estado) : undefined, q.articleId ? eq(schema.creativeCards.articleId, q.articleId) : undefined];
  const where = and(...conds);
  const rows = await c.deps.db
    .select({ card: schema.creativeCards, titulo: schema.articles.titulo })
    .from(schema.creativeCards)
    .leftJoin(schema.articles, eq(schema.articles.id, schema.creativeCards.articleId))
    .where(where)
    .orderBy(desc(schema.creativeCards.criadoEm), schema.creativeCards.id)
    .limit(q.limit)
    .offset(q.offset);
  const [total] = await c.deps.db.select({ n: count() }).from(schema.creativeCards).where(where);
  return json({ data: rows.map((r) => cardView(r.card, r.titulo)), total: total?.n ?? 0, limit: q.limit, offset: q.offset });
};

export const getCard: RouteFn = async (_req, c) => {
  const { card, titulo } = await loadCard(c, c.params.id ?? '');
  return json({ card: cardView(card, titulo) });
};

export const transitionCard: RouteFn = async (req, c) => {
  const body = await readBody(req, Transicao);
  const { card } = await loadCard(c, c.params.id ?? '');
  const de = card.estado as CardEstado;
  const acao = TRANSICOES[de][body.para];
  if (!acao) throw new HttpError(409, 'INVALID_TRANSITION', `Transição ${de} → ${body.para} não é permitida.`, { de, para: body.para });
  const s = c.session!;
  if (!can(s.role, 'social', acao)) throw new HttpError(403, 'FORBIDDEN', 'Seu papel não pode fazer esta transição.');
  const revisao = body.para === 'aprovado' || body.para === 'rejeitado';
  if (revisao && card.criadoPor === s.userId) throw new HttpError(409, 'SAME_REVIEWER', 'Quem criou o card não pode aprová-lo nem rejeitá-lo.');
  if (body.para === 'rejeitado' && !body.motivo) throw new HttpError(400, 'VALIDATION_ERROR', 'Rejeitar exige motivo.', { campo: 'motivo' });
  const now = c.deps.now();
  // Troca condicionada ao estado lido: duas revisões simultâneas não passam as duas (a segunda vê 409).
  const done = await c.deps.db
    .update(schema.creativeCards)
    .set({
      estado: body.para,
      motivo: body.para === 'rejeitado' ? body.motivo! : null,
      revisadoPor: revisao ? s.userId : null,
      revisadoEm: revisao ? now : null,
    })
    .where(and(eq(schema.creativeCards.id, card.id), eq(schema.creativeCards.estado, de)))
    .returning({ id: schema.creativeCards.id });
  if (done.length === 0) throw new HttpError(409, 'INVALID_TRANSITION', 'O card mudou de estado enquanto isso; recarregue.', { de, para: body.para });
  await audit(c.deps.db, { actorId: s.userId, actorRole: s.role, action: 'creative.card_transicao', resource: 'social', resourceId: card.id, ip: c.ip, detalhe: { requestId: c.requestId, de, para: body.para, motivo: body.motivo ?? null }, at: now });
  const after = await loadCard(c, card.id);
  return json({ card: cardView(after.card, after.titulo) });
};

/** Rasterizador (o do Growth usa sharp, só Node): carregado só na primeira chamada do PNG. Se o sharp não carregar, 503, nunca um PNG falso. */
export type Rasterize = (asset: CreativeAsset) => Promise<{ png: Uint8Array; filename: string }>;
let rasterizer: Rasterize | null | undefined;
export function setRasterizerForTest(r: Rasterize | null | undefined) {
  rasterizer = r;
}
async function getRasterizer(): Promise<Rasterize | null> {
  if (rasterizer !== undefined) return rasterizer;
  try {
    rasterizer = (await import('@ln/growth/raster')).rasterizeCreative;
  } catch (e) {
    console.error('[creative] rasterizador indisponivel', safeErr(e));
    rasterizer = null;
  }
  return rasterizer;
}

export const getCardPng: RouteFn = async (_req, c) => {
  const { card } = await loadCard(c, c.params.id ?? '');
  const rasterize = await getRasterizer();
  if (!rasterize) throw new HttpError(503, 'RASTER_UNAVAILABLE', 'Rasterizador indisponível neste ambiente.');
  const asset: CreativeAsset = { format: card.format as CreativeAsset['format'], width: card.width, height: card.height, svg: card.svg, html: '', contextKey: '', brandStatus: card.brandStatus, mock: card.mock };
  let out: { png: Uint8Array; filename: string };
  try {
    out = await rasterize(asset);
  } catch (e) {
    if (e instanceof Error && e.name === 'RasterRefusal') throw new HttpError(422, 'RASTER_REFUSED', e.message, { motivo: (e as Error & { rule?: string }).rule });
    throw e;
  }
  const filename = /^[a-z0-9-]{1,196}\.png$/.test(out.filename) ? out.filename : `ln-card-${card.svgSha256.slice(0, 8)}.png`;
  return new Response(new Uint8Array(out.png), {
    status: 200,
    headers: {
      'content-type': 'image/png',
      'content-disposition': `attachment; filename="${filename}"`,
      'cache-control': 'private, no-store',
      'x-content-type-options': 'nosniff',
    },
  });
};
