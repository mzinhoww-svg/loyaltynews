// Home, menus, SEO e links internos como documentos versionados + redirects.
//  - rascunho (um por tipo) → preview → publicar agora ou agendar (um agendamento por tipo) → rollback (nova versão);
//  - versão efetiva = a de maior data efetiva (publicadoEm ou publicarEm) já vencida; agendamento vale sozinho na hora marcada;
//  - home e menus: só a chefia escreve e publica; SEO e links internos: a redação escreve, a chefia publica;
//  - publicar revalida o conteúdo e o estado do sistema (matérias fixadas publicadas; posições publicitárias com dimensão reservada).
import { and, asc, count, desc, eq, inArray, lte, sql } from 'drizzle-orm';
import { audit, can } from '@ln/auth';
import { schema } from '@ln/db';
import { z } from 'zod';
import { HttpError, json, newId, parse, Paging, queryObject, readBody, type RouteCtx, type RouteFn } from '../http';
import {
  CHEFIA_ONLY, CONTEUDO, CaminhoInterno, Destino, SiteTipoSchema, dimensaoReservada, pendenciasDePublicacao, type HomeContentT, type SeoContentT, type SiteTipo,
} from './content';

type Doc = typeof schema.siteDocumentos.$inferSelect;
const MAX_REDIRECTS = 2000;
const AGENDAMENTO_MAX_DIAS = 365;
const efetiva = sql`coalesce(${schema.siteDocumentos.publicarEm}, ${schema.siteDocumentos.publicadoEm})`;

function tipoOf(c: RouteCtx): SiteTipo {
  const r = SiteTipoSchema.safeParse(c.params.tipo);
  if (!r.success) throw new HttpError(404, 'NOT_FOUND', 'Tipo de documento inexistente.');
  return r.data;
}

/** Home e menus são da chefia; SEO e links internos, da redação. Publicar é sempre da chefia (a rota exige `site:publish`). */
function assertCanWrite(c: RouteCtx, tipo: SiteTipo) {
  const role = c.session?.role;
  const ok = CHEFIA_ONLY.has(tipo) ? can(role, 'site', 'publish') : can(role, 'site', 'update');
  if (!ok) throw new HttpError(403, 'FORBIDDEN', `Sem permissão para alterar ${tipo}.`);
}

const meta = (d: Doc, now: Date) => ({
  id: d.id, tipo: d.tipo, versao: d.versao, estado: d.estado, publicarEm: d.publicarEm, publicadoEm: d.publicadoEm, nota: d.nota,
  criadoPor: d.criadoPor, criadoEm: d.criadoEm,
  efetivoAgora: (d.estado === 'publicado' || d.estado === 'agendado') && (d.publicarEm ?? d.publicadoEm)! <= now,
});

/** Documento em vigor agora (ou null). */
export async function efetivo(db: RouteCtx['deps']['db'], tipo: SiteTipo, now: Date): Promise<Doc | null> {
  const [d] = await db
    .select()
    .from(schema.siteDocumentos)
    .where(and(eq(schema.siteDocumentos.tipo, tipo), inArray(schema.siteDocumentos.estado, ['publicado', 'agendado']), lte(efetiva, now)))
    .orderBy(desc(efetiva), desc(schema.siteDocumentos.versao))
    .limit(1);
  return d ?? null;
}

async function porEstado(db: RouteCtx['deps']['db'], tipo: SiteTipo, estado: string): Promise<Doc | null> {
  const [d] = await db.select().from(schema.siteDocumentos).where(and(eq(schema.siteDocumentos.tipo, tipo), eq(schema.siteDocumentos.estado, estado))).limit(1);
  return d ?? null;
}

// ---------- leitura ----------
export const listSiteDocs: RouteFn = async (_req, c) => {
  const q = parse(z.object({ tipo: SiteTipoSchema.optional() }).extend(Paging.shape), queryObject(c.url));
  const where = q.tipo ? eq(schema.siteDocumentos.tipo, q.tipo) : undefined;
  const now = c.deps.now();
  const rows = await c.deps.db.select().from(schema.siteDocumentos).where(where).orderBy(asc(schema.siteDocumentos.tipo), desc(schema.siteDocumentos.versao)).limit(q.limit).offset(q.offset);
  const [total] = await c.deps.db.select({ n: count() }).from(schema.siteDocumentos).where(where);
  return json({ data: rows.map((r) => meta(r, now)), total: total?.n ?? 0, limit: q.limit, offset: q.offset });
};

export const getSiteDoc: RouteFn = async (_req, c) => {
  const tipo = tipoOf(c);
  const now = c.deps.now();
  const [vigente, rascunho, agendado] = await Promise.all([efetivo(c.deps.db, tipo, now), porEstado(c.deps.db, tipo, 'rascunho'), porEstado(c.deps.db, tipo, 'agendado')]);
  const full = (d: Doc | null) => (d ? { ...meta(d, now), conteudo: d.conteudo } : null);
  return json({ data: { tipo, vigente: full(vigente), rascunho: full(rascunho), agendado: full(agendado) } });
};

/** Preview do rascunho: o conteúdo, as pendências de publicação e (na home) as matérias fixadas já resolvidas. */
export const previewSiteDoc: RouteFn = async (_req, c) => {
  const tipo = tipoOf(c);
  const rascunho = await porEstado(c.deps.db, tipo, 'rascunho');
  if (!rascunho) throw new HttpError(404, 'NO_DRAFT', 'Não há rascunho deste documento.');
  const pendencias = await pendenciasDePublicacao(c.deps.db, tipo, rascunho.conteudo);
  const resolvido = tipo === 'home' ? await resolverHome(c.deps.db, rascunho.conteudo as HomeContentT) : null;
  return json({ data: { tipo, conteudo: rascunho.conteudo, pendencias, publicavel: pendencias.length === 0, resolvido } });
};

// ---------- escrita ----------
export const putDraft: RouteFn = async (req, c) => {
  const tipo = tipoOf(c);
  assertCanWrite(c, tipo);
  const b = await readBody(req, z.strictObject({ conteudo: z.unknown() }));
  const conteudo = parse(CONTEUDO[tipo], b.conteudo);
  const session = c.session!;
  const row = await c.deps.db.transaction(async (tx) => {
    const [cur] = await tx.select().from(schema.siteDocumentos).where(and(eq(schema.siteDocumentos.tipo, tipo), eq(schema.siteDocumentos.estado, 'rascunho'))).for('update');
    if (cur) {
      const [u] = await tx.update(schema.siteDocumentos).set({ conteudo, criadoPor: session.userId }).where(eq(schema.siteDocumentos.id, cur.id)).returning();
      return u!;
    }
    const [i] = await tx
      .insert(schema.siteDocumentos)
      .values({ id: newId(), tipo, estado: 'rascunho', conteudo, criadoPor: session.userId, criadoEm: c.deps.now() })
      .returning();
    return i!;
  });
  await audit(c.deps.db, { actorId: session.userId, actorRole: session.role, action: 'site.rascunho_salvo', resource: 'site', resourceId: tipo, ip: c.ip, detalhe: { tipo }, at: c.deps.now() });
  return json({ data: { ...meta(row, c.deps.now()), conteudo: row.conteudo } }, 200);
};

const Publicar = z.strictObject({ agendarPara: z.iso.datetime({ offset: true }).optional() });

async function proximaVersao(tx: Pick<RouteCtx['deps']['db'], 'select'>, tipo: SiteTipo): Promise<number> {
  const [m] = await tx.select({ v: sql<number>`coalesce(max(${schema.siteDocumentos.versao}), 0)::int` }).from(schema.siteDocumentos).where(eq(schema.siteDocumentos.tipo, tipo));
  return (m?.v ?? 0) + 1;
}

export const publishSiteDoc: RouteFn = async (req, c) => {
  const tipo = tipoOf(c);
  const b = await readBody(req, Publicar);
  const session = c.session!;
  const now = c.deps.now();
  let quando: Date | null = null;
  if (b.agendarPara) {
    quando = new Date(b.agendarPara);
    if (quando.getTime() <= now.getTime() + 60_000) throw new HttpError(422, 'AGENDAMENTO_INVALIDO', 'O agendamento precisa ser no futuro (pelo menos 1 minuto).');
    if (quando.getTime() > now.getTime() + AGENDAMENTO_MAX_DIAS * 86_400_000) throw new HttpError(422, 'AGENDAMENTO_INVALIDO', `O agendamento não pode passar de ${AGENDAMENTO_MAX_DIAS} dias.`);
  }
  const out = await c.deps.db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`site:${tipo}`}))`);
    const [draft] = await tx.select().from(schema.siteDocumentos).where(and(eq(schema.siteDocumentos.tipo, tipo), eq(schema.siteDocumentos.estado, 'rascunho')));
    if (!draft) throw new HttpError(409, 'NO_DRAFT', 'Não há rascunho para publicar.');
    parse(CONTEUDO[tipo], draft.conteudo);
    const pend = await pendenciasDePublicacao(tx as unknown as RouteCtx['deps']['db'], tipo, draft.conteudo);
    if (pend.length) throw new HttpError(422, 'PENDENCIAS', 'O rascunho não pode ser publicado.', pend);
    const [ag] = await tx.select().from(schema.siteDocumentos).where(and(eq(schema.siteDocumentos.tipo, tipo), eq(schema.siteDocumentos.estado, 'agendado')));
    if (ag) throw new HttpError(409, quando ? 'AGENDAMENTO_EXISTENTE' : 'AGENDAMENTO_PENDENTE', 'Já existe um agendamento para este documento; cancele-o antes.');
    const versao = await proximaVersao(tx as unknown as RouteCtx['deps']['db'], tipo);
    if (quando) {
      const [u] = await tx.update(schema.siteDocumentos).set({ estado: 'agendado', versao, publicarEm: quando }).where(eq(schema.siteDocumentos.id, draft.id)).returning();
      return u!;
    }
    await tx.update(schema.siteDocumentos).set({ estado: 'substituido' }).where(and(eq(schema.siteDocumentos.tipo, tipo), eq(schema.siteDocumentos.estado, 'publicado')));
    const [u] = await tx.update(schema.siteDocumentos).set({ estado: 'publicado', versao, publicadoEm: now }).where(eq(schema.siteDocumentos.id, draft.id)).returning();
    return u!;
  });
  await audit(c.deps.db, {
    actorId: session.userId, actorRole: session.role, action: quando ? 'site.agendado' : 'site.publicado', resource: 'site', resourceId: tipo, ip: c.ip,
    detalhe: { tipo, versao: out.versao, ...(quando ? { publicarEm: quando.toISOString() } : {}) }, at: now,
  });
  return json({ data: meta(out, now) }, quando ? 202 : 200);
};

export const cancelSchedule: RouteFn = async (_req, c) => {
  const tipo = tipoOf(c);
  const session = c.session!;
  const out = await c.deps.db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`site:${tipo}`}))`);
    const ag = await porEstado(tx as unknown as RouteCtx['deps']['db'], tipo, 'agendado');
    if (!ag) throw new HttpError(404, 'NOT_FOUND', 'Não há agendamento para cancelar.');
    if (await porEstado(tx as unknown as RouteCtx['deps']['db'], tipo, 'rascunho')) {
      throw new HttpError(409, 'RASCUNHO_EXISTENTE', 'Há um rascunho em edição; publique ou descarte-o antes de cancelar o agendamento.');
    }
    const [u] = await tx.update(schema.siteDocumentos).set({ estado: 'rascunho', versao: null, publicarEm: null }).where(eq(schema.siteDocumentos.id, ag.id)).returning();
    return u!;
  });
  await audit(c.deps.db, { actorId: session.userId, actorRole: session.role, action: 'site.agendamento_cancelado', resource: 'site', resourceId: tipo, ip: c.ip, detalhe: { tipo }, at: c.deps.now() });
  return json({ data: { ...meta(out, c.deps.now()), conteudo: out.conteudo } });
};

/** Rollback = NOVA versão com o conteúdo de uma versão anterior (o histórico não é reescrito). Revalida contra o estado atual. */
export const rollbackSiteDoc: RouteFn = async (req, c) => {
  const tipo = tipoOf(c);
  const b = await readBody(req, z.strictObject({ versao: z.number().int().positive() }));
  const session = c.session!;
  const now = c.deps.now();
  const out = await c.deps.db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`site:${tipo}`}))`);
    const [src] = await tx
      .select()
      .from(schema.siteDocumentos)
      .where(and(eq(schema.siteDocumentos.tipo, tipo), eq(schema.siteDocumentos.versao, b.versao), inArray(schema.siteDocumentos.estado, ['publicado', 'substituido'])));
    if (!src) throw new HttpError(404, 'NOT_FOUND', 'Versão publicada inexistente.');
    if (await porEstado(tx as unknown as RouteCtx['deps']['db'], tipo, 'agendado')) throw new HttpError(409, 'AGENDAMENTO_PENDENTE', 'Há um agendamento; cancele-o antes do rollback.');
    parse(CONTEUDO[tipo], src.conteudo);
    const pend = await pendenciasDePublicacao(tx as unknown as RouteCtx['deps']['db'], tipo, src.conteudo);
    if (pend.length) throw new HttpError(422, 'PENDENCIAS', 'A versão antiga não pode ser republicada hoje.', pend);
    const versao = await proximaVersao(tx as unknown as RouteCtx['deps']['db'], tipo);
    await tx.update(schema.siteDocumentos).set({ estado: 'substituido' }).where(and(eq(schema.siteDocumentos.tipo, tipo), eq(schema.siteDocumentos.estado, 'publicado')));
    const [n] = await tx
      .insert(schema.siteDocumentos)
      .values({ id: newId(), tipo, versao, estado: 'publicado', conteudo: src.conteudo, publicadoEm: now, nota: `rollback para v${b.versao}`, criadoPor: session.userId, criadoEm: now })
      .returning();
    return n!;
  });
  await audit(c.deps.db, { actorId: session.userId, actorRole: session.role, action: 'site.rollback', resource: 'site', resourceId: tipo, ip: c.ip, detalhe: { tipo, de: b.versao, para: out.versao }, at: now });
  return json({ data: meta(out, now) }, 201);
};

// ---------- redirects ----------
const RedirectBody = z.strictObject({ origem: CaminhoInterno, destino: Destino, codigo: z.union([z.literal(301), z.literal(302)]).default(301), ativo: z.boolean().default(true) });
const RedirectPatch = z
  .strictObject({ origem: CaminhoInterno.optional(), destino: Destino.optional(), codigo: z.union([z.literal(301), z.literal(302)]).optional(), ativo: z.boolean().optional() })
  .refine((u) => Object.keys(u).length > 0, { message: 'nenhum campo para alterar' });

const caminho = (u: string) => u.split(/[?#]/)[0] ?? u;

/** Cadeia de redirects a partir de `from`: devolve true se volta a `from` (laço) ou passa de 10 saltos. */
function temLaco(map: Map<string, string>, from: string): boolean {
  let at = from;
  for (let i = 0; i < 10; i++) {
    const next = map.get(caminho(at));
    if (!next || !next.startsWith('/')) return false;
    if (caminho(next) === from) return true;
    at = next;
  }
  return true;
}

async function validarRedirect(c: RouteCtx, id: string | null, v: { origem: string; destino: string; ativo: boolean }) {
  if (caminho(v.origem) === caminho(v.destino)) throw new HttpError(422, 'REDIRECT_INVALIDO', 'Origem e destino iguais.');
  const rows = await c.deps.db.select().from(schema.siteRedirects).where(eq(schema.siteRedirects.ativo, true));
  const map = new Map(rows.filter((r) => r.id !== id).map((r) => [caminho(r.origem), r.destino]));
  if (v.ativo) map.set(caminho(v.origem), v.destino);
  if (temLaco(map, caminho(v.origem))) throw new HttpError(409, 'REDIRECT_LOOP', 'O redirect formaria um laço ou uma cadeia longa demais.');
}

export const listRedirects: RouteFn = async (_req, c) =>
  json({ data: await c.deps.db.select().from(schema.siteRedirects).orderBy(asc(schema.siteRedirects.origem)) });

export const createRedirect: RouteFn = async (req, c) => {
  const b = await readBody(req, RedirectBody);
  const [{ n }] = (await c.deps.db.select({ n: count() }).from(schema.siteRedirects)) as [{ n: number }];
  if (n >= MAX_REDIRECTS) throw new HttpError(409, 'LIMITE', `Limite de ${MAX_REDIRECTS} redirects.`);
  await validarRedirect(c, null, b);
  const [r] = await c.deps.db.insert(schema.siteRedirects).values({ id: newId(), ...b, criadoPor: c.session!.userId, criadoEm: c.deps.now() }).returning();
  return json({ data: r }, 201);
};

export const patchRedirect: RouteFn = async (req, c) => {
  const b = await readBody(req, RedirectPatch);
  const [cur] = await c.deps.db.select().from(schema.siteRedirects).where(eq(schema.siteRedirects.id, c.params.id ?? ''));
  if (!cur) throw new HttpError(404, 'NOT_FOUND', 'Redirect não encontrado.');
  const next = { origem: b.origem ?? cur.origem, destino: b.destino ?? cur.destino, ativo: b.ativo ?? cur.ativo };
  await validarRedirect(c, cur.id, next);
  const [r] = await c.deps.db.update(schema.siteRedirects).set(b).where(eq(schema.siteRedirects.id, cur.id)).returning();
  return json({ data: r });
};

export const deleteRedirect: RouteFn = async (_req, c) => {
  const d = await c.deps.db.delete(schema.siteRedirects).where(eq(schema.siteRedirects.id, c.params.id ?? '')).returning();
  if (!d[0]) throw new HttpError(404, 'NOT_FOUND', 'Redirect não encontrado.');
  return new Response(null, { status: 204 });
};

// ---------- público (Portal) ----------
async function resolverHome(db: RouteCtx['deps']['db'], h: HomeContentT) {
  const slugs = [...new Set(h.blocos.flatMap((b) => (b.tipo === 'destaque' ? b.materiaSlugs : [])))];
  const rows = slugs.length
    ? await db
        .select({ slug: schema.articles.slug, titulo: schema.articles.titulo, subtitulo: schema.articles.subtitulo, resumo: schema.articles.resumo, editoria: schema.articles.editoria, publicadoEm: schema.articles.publicadoEm })
        .from(schema.articles)
        .where(and(inArray(schema.articles.slug, slugs), inArray(schema.articles.status, ['publicado', 'corrigido']), eq(schema.articles.classeDeDado, 'public')))
    : [];
  const bySlug = new Map(rows.map((r) => [r.slug, r]));
  return h.blocos.map((b) => {
    if (b.tipo === 'destaque') return { ...b, materias: b.materiaSlugs.flatMap((s) => (bySlug.has(s) ? [bySlug.get(s)!] : [])) }; // fixada que saiu do ar some, sem quebrar a home
    if (b.tipo === 'publicidade') return { ...b, dimensao: dimensaoReservada(b.posicao) };
    return b;
  });
}

/** Tudo o que o Portal precisa para montar a página, na versão em vigor agora. Sem documento publicado = null (o Portal usa o padrão dele). */
export const publicSite: RouteFn = async (_req, c) => {
  const now = c.deps.now();
  const [home, menuPrincipal, menuRodape, seo, links] = await Promise.all(
    (['home', 'menu_principal', 'menu_rodape', 'seo_global', 'links_internos'] as const).map((t) => efetivo(c.deps.db, t, now)),
  );
  const seoC = (seo?.conteudo ?? null) as SeoContentT | null;
  const org = seoC?.dadosEstruturados.organizacao;
  return json(
    {
      data: {
        home: home ? { versao: home.versao, blocos: await resolverHome(c.deps.db, home.conteudo as HomeContentT) } : null,
        menus: { principal: menuPrincipal?.conteudo ?? null, rodape: menuRodape?.conteudo ?? null },
        seo: seoC
          ? {
              tituloPadrao: seoC.tituloPadrao, descricaoPadrao: seoC.descricaoPadrao, imagemOgUrl: seoC.imagemOgUrl ?? null, indexacao: seoC.indexacao,
              jsonLd: { '@context': 'https://schema.org', '@type': 'Organization', name: org!.nome, url: org!.url, ...(org!.logoUrl ? { logo: org!.logoUrl } : {}), ...(org!.sameAs.length ? { sameAs: org!.sameAs } : {}) },
            }
          : null,
        linksInternos: (links?.conteudo as { regras: unknown[] } | undefined)?.regras ?? [],
      },
    },
    200,
    { 'cache-control': 'public, max-age=60, stale-while-revalidate=300' },
  );
};

export const publicRedirects: RouteFn = async (_req, c) =>
  json(
    { data: (await c.deps.db.select().from(schema.siteRedirects).where(eq(schema.siteRedirects.ativo, true)).orderBy(asc(schema.siteRedirects.origem))).map((r) => ({ origem: r.origem, destino: r.destino, codigo: r.codigo })) },
    200,
    { 'cache-control': 'public, max-age=60, stale-while-revalidate=300' },
  );

/** Sem SEO publicado, o padrão seguro é NÃO indexar. `noindex` ou sem matérias no sitemap ⇒ lista vazia. */
export const publicSitemap: RouteFn = async (_req, c) => {
  const seo = await efetivo(c.deps.db, 'seo_global', c.deps.now());
  const conf = (seo?.conteudo ?? null) as SeoContentT | null;
  const headers = { 'cache-control': 'public, max-age=300' };
  if (!conf || conf.indexacao === 'noindex' || !conf.sitemap.incluirMaterias) return json({ data: { indexacao: conf?.indexacao ?? 'noindex', urls: [] } }, 200, headers);
  const rows = await c.deps.db
    .select({ slug: schema.articles.slug, publicadoEm: schema.articles.publicadoEm })
    .from(schema.articles)
    .where(and(inArray(schema.articles.status, ['publicado', 'corrigido']), eq(schema.articles.classeDeDado, 'public')))
    .orderBy(desc(schema.articles.publicadoEm))
    .limit(5000);
  return json({ data: { indexacao: 'indexar', urls: rows.map((r) => ({ loc: `/noticia/${r.slug}`, lastmod: r.publicadoEm })) } }, 200, headers);
};
