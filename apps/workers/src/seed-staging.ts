// Seed de STAGING 100% rotulado. Só para o ambiente de staging (APP_ENV=staging): produção e qualquer outro valor recusam.
//   node dist/seed-staging.js apply    cria o conjunto de demonstração (idempotente: ids fixos `seed-stg-*`)
//   node dist/seed-staging.js check    confere que TODA linha do seed carrega o rótulo e que o SEO está em noindex
//   node dist/seed-staging.js remove   apaga só as linhas do seed (por id), nada mais
// Regras: (1) toda linha tem id `seed-stg-*`; (2) todo texto visível ao leitor (título, resumo, corpo, local, nota) começa com
// `[DEMO · staging]` ou o traz; (3) a matéria fictícia NUNCA tem fonte ou recibo inventado; (4) o SEO do seed é `noindex` (staging não indexa);
// (5) nada de e-mail, pessoa ou empresa real; (6) o seed não toca em linha que não seja dele. As dez editorias são dado de referência
// oficial (@ln/contracts), não demonstração: entram só se faltarem e não contam como seed.
// Build: npm run build:seed-staging -w @ln/workers. Nunca imprime URL, senha nem PEM.
import { and, eq, inArray, like, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { audit } from '@ln/auth';
import type { Db } from '@ln/auth';
import { EDITORIAS } from '@ln/contracts';
import { schema } from '@ln/db';
import { pgPoolConfig } from '@ln/db/tls';

export const SEED_PREFIX = 'seed-stg-';
export const SEED_LABEL = '[DEMO · staging]';
const NOTICE = 'Conteúdo fictício de demonstração do ambiente de staging. Não é notícia nem informação real.';

export class SeedRefused extends Error {}

/** Só `APP_ENV=staging` semeia. Produção, vazio ou qualquer outro valor recusam (falha fechada). */
export function assertStaging(env: Record<string, string | undefined>): void {
  if (env.APP_ENV !== 'staging') throw new SeedRefused(`seed recusado: APP_ENV=${env.APP_ENV ? env.APP_ENV : '(vazio)'}; só vale em staging`);
}

const tag = (t: string) => `${SEED_LABEL} ${t}`;

const ARTIGOS = [
  { n: 1, editoria: 'mercado', titulo: 'Programa fictício amplia a rede de parceiros', publicada: true },
  { n: 2, editoria: 'programas', titulo: 'Clube fictício revisa regras de acúmulo', publicada: true },
  { n: 3, editoria: 'pontos', titulo: 'Campanha fictícia de bônus de transferência', publicada: true },
  { n: 4, editoria: 'bancos', titulo: 'Cartão fictício lança nova categoria', publicada: true },
  { n: 5, editoria: 'varejo', titulo: 'Cashback fictício chega a novas lojas', publicada: true },
  { n: 6, editoria: 'tech', titulo: 'Rascunho fictício sobre personalização', publicada: false },
] as const;

const EVENTOS = [
  { n: 1, titulo: 'Encontro fictício de fidelidade', inicio: '2099-03-10', fim: '2099-03-11' },
  { n: 2, titulo: 'Seminário fictício de CRM', inicio: '2099-05-20', fim: '2099-05-20' },
  { n: 3, titulo: 'Painel fictício de cartões', inicio: '2099-08-04', fim: '2099-08-05' },
] as const;

const artigoSlug = (n: number, editoria: string) => `demo-staging-${n}-${editoria}`;

export interface SeedReport {
  editoriasCriadas: number;
  artigos: number;
  eventos: number;
  documentosSite: number;
}

/** Cria o conjunto (idempotente). Devolve o que foi criado nesta chamada (0 em chamadas repetidas). */
export async function applyStagingSeed(db: Db, env: Record<string, string | undefined>, now: Date = new Date()): Promise<SeedReport> {
  assertStaging(env);
  const report: SeedReport = { editoriasCriadas: 0, artigos: 0, eventos: 0, documentosSite: 0 };
  await db.transaction(async (tx) => {
    const t = tx as unknown as Db;
    // dado de referência oficial: só as que faltam
    const ja = new Set((await t.select({ slug: schema.editorias.slug }).from(schema.editorias)).map((e) => e.slug));
    const faltam = EDITORIAS.filter((e) => !ja.has(e.slug));
    if (faltam.length) {
      await t.insert(schema.editorias).values(faltam.map((e) => ({ slug: e.slug, nome: e.nome }))).onConflictDoNothing();
      report.editoriasCriadas = faltam.length;
    }

    for (const a of ARTIGOS) {
      const id = `${SEED_PREFIX}art-${a.n}`;
      const slug = artigoSlug(a.n, a.editoria);
      const feito = await t.insert(schema.articles).values({
        id,
        slug,
        titulo: tag(a.titulo),
        subtitulo: tag('Demonstração'),
        resumo: `${SEED_LABEL} ${NOTICE}`,
        editoria: a.editoria,
        status: a.publicada ? 'publicado' : 'rascunho',
        corpo: `${SEED_LABEL} ${NOTICE}\n\nEste texto existe só para o staging exercitar listas, páginas e rotas. Não há fonte, recibo de revisão nem fato verificado por trás dele.`,
        classeDeDado: 'public',
        publicadoEm: a.publicada ? new Date(now.getTime() - a.n * 86_400_000) : null,
      }).onConflictDoNothing().returning({ id: schema.articles.id });
      report.artigos += feito.length;
    }

    for (const e of EVENTOS) {
      const feito = await t.insert(schema.agendaEvents).values({
        id: `${SEED_PREFIX}ev-${e.n}`,
        titulo: tag(e.titulo),
        inicio: e.inicio,
        fim: e.fim,
        local: tag('Local fictício'),
        editorias: [],
        patrocinado: false,
        fonteUrl: 'https://example.invalid/seed-staging',
        moderacao: 'aprovado',
        origem: 'interno',
      }).onConflictDoNothing().returning({ id: schema.agendaEvents.id });
      report.eventos += feito.length;
    }

    // Home e SEO publicados (F-29). O SEO é `noindex`: staging não indexa nada, nem o seed.
    const publicadas = ARTIGOS.filter((a) => a.publicada).map((a) => artigoSlug(a.n, a.editoria));
    const docs: Array<{ tipo: 'home' | 'seo_global'; conteudo: unknown }> = [
      {
        tipo: 'home',
        conteudo: {
          blocos: [
            { tipo: 'destaque', id: 'topo', titulo: tag('Destaques'), materiaSlugs: publicadas.slice(0, 3) },
            { tipo: 'lista_editoria', id: 'mercado', titulo: tag('Mercado'), editoria: 'mercado', limite: 3 },
            { tipo: 'ultimas', id: 'ultimas', titulo: tag('Últimas'), limite: 6 },
            { tipo: 'agenda', id: 'agenda', titulo: tag('Agenda'), limite: 3 },
          ],
        },
      },
      {
        tipo: 'seo_global',
        conteudo: {
          tituloPadrao: tag('Loyalty News'),
          descricaoPadrao: `${SEED_LABEL} Ambiente de staging com conteúdo fictício. Não indexar.`,
          indexacao: 'noindex',
          sitemap: { incluirMaterias: false },
          dadosEstruturados: { organizacao: { nome: tag('Loyalty News'), url: 'https://staging.invalid', sameAs: [] } },
        },
      },
    ];
    for (const d of docs) {
      const id = `${SEED_PREFIX}site-${d.tipo}`;
      const [existe] = await t.select({ id: schema.siteDocumentos.id }).from(schema.siteDocumentos).where(eq(schema.siteDocumentos.id, id));
      if (existe) continue;
      // só entra como versão em vigor se o tipo ainda não tem documento publicado (não passa por cima do que alguém publicou)
      const [tem] = await t.select({ id: schema.siteDocumentos.id }).from(schema.siteDocumentos).where(and(eq(schema.siteDocumentos.tipo, d.tipo), inArray(schema.siteDocumentos.estado, ['publicado', 'agendado'])));
      if (tem) continue;
      const [m] = await t.select({ v: sql<number>`coalesce(max(${schema.siteDocumentos.versao}), 0)::int` }).from(schema.siteDocumentos).where(eq(schema.siteDocumentos.tipo, d.tipo));
      await t.insert(schema.siteDocumentos).values({
        id, tipo: d.tipo, versao: (m?.v ?? 0) + 1, estado: 'publicado', conteudo: d.conteudo, publicadoEm: now, nota: tag('seed de staging'), criadoPor: 'seed-staging', criadoEm: now,
      });
      report.documentosSite += 1;
    }

    await audit(t, { actorId: 'seed-staging', actorRole: 'cli', action: 'staging.seed_aplicado', resource: 'staging', resourceId: 'seed', detalhe: { ...report }, at: now });
  });
  return report;
}

export interface SeedCheck {
  ok: boolean;
  /** Linhas do seed por tabela. */
  linhas: Record<string, number>;
  /** Problemas (vazio quando ok). */
  problemas: string[];
}

/** Confere que toda linha do seed tem rótulo visível e que o SEO do seed é noindex. Só leitura. */
export async function checkStagingSeed(db: Db): Promise<SeedCheck> {
  const problemas: string[] = [];
  const linhas: Record<string, number> = {};
  const rotulado = (...textos: Array<string | null | undefined>) => textos.every((t) => typeof t === 'string' && t.includes(SEED_LABEL));

  const arts = await db.select().from(schema.articles).where(like(schema.articles.id, `${SEED_PREFIX}%`));
  linhas.articles = arts.length;
  for (const a of arts) if (!rotulado(a.titulo, a.subtitulo, a.resumo, a.corpo)) problemas.push(`matéria ${a.id} sem rótulo em título/subtítulo/resumo/corpo`);
  // O seed NÃO inventa fonte: matéria do seed com fonte/evidência ligada (alguém acrescentou depois) faz a conferência falhar.
  if (arts.length > 0) {
    const ligadas = await db.select({ articleId: schema.articleSources.articleId }).from(schema.articleSources).where(inArray(schema.articleSources.articleId, arts.map((a) => a.id)));
    for (const id of new Set(ligadas.map((l) => l.articleId))) problemas.push(`matéria ${id} do seed tem fonte/evidência ligada (o seed não inventa fonte)`);
  }

  const evs = await db.select().from(schema.agendaEvents).where(like(schema.agendaEvents.id, `${SEED_PREFIX}%`));
  linhas.agenda_events = evs.length;
  for (const e of evs) if (!rotulado(e.titulo, e.local)) problemas.push(`evento ${e.id} sem rótulo em título/local`);

  const docs = await db.select().from(schema.siteDocumentos).where(like(schema.siteDocumentos.id, `${SEED_PREFIX}%`));
  linhas.site_documentos = docs.length;
  for (const d of docs) {
    if (!rotulado(d.nota)) problemas.push(`documento ${d.id} sem rótulo na nota`);
    const c = d.conteudo as { tituloPadrao?: string; indexacao?: string; blocos?: Array<{ titulo?: string }> };
    if (d.tipo === 'seo_global') {
      if (!rotulado(c.tituloPadrao)) problemas.push(`documento ${d.id} sem rótulo no título padrão`);
      if (c.indexacao !== 'noindex') problemas.push(`documento ${d.id}: o SEO do seed precisa ser noindex`);
    }
    if (d.tipo === 'home') for (const b of c.blocos ?? []) if (b.titulo !== undefined && !rotulado(b.titulo)) problemas.push(`documento ${d.id}: bloco sem rótulo`);
  }
  return { ok: problemas.length === 0, linhas, problemas };
}

/** Apaga só o que é do seed (por id `seed-stg-*`). Matéria vem depois dos documentos que a citam. */
export async function removeStagingSeed(db: Db, env: Record<string, string | undefined>, now: Date = new Date()): Promise<Record<string, number>> {
  assertStaging(env);
  const out: Record<string, number> = {};
  await db.transaction(async (tx) => {
    const t = tx as unknown as Db;
    out.site_documentos = (await t.delete(schema.siteDocumentos).where(like(schema.siteDocumentos.id, `${SEED_PREFIX}%`)).returning({ id: schema.siteDocumentos.id })).length;
    out.agenda_events = (await t.delete(schema.agendaEvents).where(like(schema.agendaEvents.id, `${SEED_PREFIX}%`)).returning({ id: schema.agendaEvents.id })).length;
    out.articles = (await t.delete(schema.articles).where(like(schema.articles.id, `${SEED_PREFIX}%`)).returning({ id: schema.articles.id })).length;
    await audit(t, { actorId: 'seed-staging', actorRole: 'cli', action: 'staging.seed_removido', resource: 'staging', resourceId: 'seed', detalhe: { ...out }, at: now });
  });
  return out;
}

export async function run(
  argv: string[],
  env: Record<string, string | undefined> = process.env,
  out: (s: string) => void = console.log,
  /** Só testes: banco já aberto. */
  injectedDb?: unknown,
): Promise<number> {
  const [cmd] = argv;
  if (cmd !== 'apply' && cmd !== 'check' && cmd !== 'remove') {
    out('uso: apply | check | remove (somente com APP_ENV=staging)');
    return 2;
  }
  if (cmd !== 'check') {
    try {
      assertStaging(env);
    } catch (e) {
      out((e as Error).message);
      return 2;
    }
  }
  const pool = injectedDb ? null : new Pool(pgPoolConfig(env, { max: 1 }));
  try {
    const db = (injectedDb ?? drizzle(pool!, { schema })) as unknown as Db;
    if (cmd === 'apply') out(JSON.stringify(await applyStagingSeed(db, env)));
    else if (cmd === 'remove') out(JSON.stringify(await removeStagingSeed(db, env)));
    else {
      const r = await checkStagingSeed(db);
      out(JSON.stringify(r));
      return r.ok ? 0 : 1;
    }
    return 0;
  } finally {
    await pool?.end();
  }
}

const invokedDirectly = typeof process !== 'undefined' && process.argv[1] !== undefined && /seed-staging\.(js|ts)$/.test(process.argv[1]);
if (invokedDirectly) {
  run(process.argv.slice(2)).then(
    (code) => process.exit(code),
    (e: unknown) => {
      console.error(`falha: ${e instanceof Error ? e.message : 'erro'}`); // só a mensagem
      process.exit(1);
    },
  );
}
