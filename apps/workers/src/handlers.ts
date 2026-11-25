// Registro dos handlers de fila. Cada frente dona de uma fila registra o seu aqui.
// O destino de cada fila está em `QUEUE_DECISIONS` (queues.ts): `on` exige handler; `off` proíbe handler.
// O guard de subida (queue-guard.ts) recusa o worker se esta promessa for quebrada.
import { createHash } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { schema } from '@ln/db';
import type { Db } from '@ln/auth';
import { consumeArticle, type Db as IntelDb } from '@ln/intelligence';
import type { Handlers } from './runtime';

/** Assinatura do Portal (a mesma do CMS): é o nome da fonte no Intelligence. */
export const PORTAL_SOURCE_NAME = 'Loyalty News';

/**
 * O consumidor do Intelligence fala SQL puro (`{ query }`). O efeito roda dentro da transação do
 * effect_ledger; usar o cliente da própria transação mantém o efeito e o ledger atômicos. O cliente
 * não é público na API do drizzle, por isso o acesso é explícito e falha fechada se não existir.
 */
export function intelDbFromTx(tx: Db): IntelDb {
  const client = (tx as unknown as { session?: { client?: { query?: (text: string, params?: unknown[]) => Promise<{ rows: unknown[] }> } } })
    .session?.client;
  if (!client || typeof client.query !== 'function') {
    throw new Error('transação sem cliente PostgreSQL: o efeito do Intelligence precisa rodar na mesma transação');
  }
  return { query: (text, params) => client.query!(text, params) as Promise<{ rows: Record<string, unknown>[] }> };
}

const sha256 = (s: string) => createHash('sha256').update(s, 'utf8').digest('hex');

/** Hash estável do conteúdo publicado (título, subtítulo, resumo e corpo). Muda a cada correção. */
export function articleContentSha(a: { titulo: string; subtitulo?: string | null; resumo?: string | null; corpo: string }): string {
  return sha256([a.titulo, a.subtitulo ?? '', a.resumo ?? '', a.corpo].join('\n'));
}

const baseUrl = (env: Record<string, string | undefined>): string => (env.APP_URL ?? env.NEXT_PUBLIC_SITE_URL ?? '').trim().replace(/\/+$/, '');

/**
 * Fila `entidades`: matéria publicada ou corrigida vira organizações no Intelligence (determinístico, sem
 * modelo). Rascunho, conteúdo não público e matéria inexistente não geram efeito; correção gera uma nova
 * evidência pelo hash novo. Idempotência: a chave do job (linha do outbox) no effect_ledger e, no consumidor,
 * a mesma URL + hash.
 */
export async function ingestPublishedArticle(tx: Db, articleId: string, siteBase: string): Promise<void> {
  const [a] = await tx
    .select({
      id: schema.articles.id, slug: schema.articles.slug, titulo: schema.articles.titulo, subtitulo: schema.articles.subtitulo,
      resumo: schema.articles.resumo, corpo: schema.articles.corpo, status: schema.articles.status,
      classeDeDado: schema.articles.classeDeDado, publicadoEm: schema.articles.publicadoEm, criadoEm: schema.articles.criadoEm,
    })
    .from(schema.articles)
    .where(eq(schema.articles.id, articleId))
    .limit(1);
  if (!a) throw new Error(`matéria ${articleId} não encontrada para a fila entidades`);
  if (a.status !== 'publicado' && a.status !== 'corrigido') return;
  if (a.classeDeDado !== 'public') return; // dado restrito não entra no Intelligence público
  if (!/^https?:\/\//i.test(siteBase)) throw new Error('APP_URL (ou NEXT_PUBLIC_SITE_URL) ausente: a fonte do Intelligence precisa de URL pública');
  const publishedAt = (a.publicadoEm ?? a.criadoEm).toISOString();
  await consumeArticle(intelDbFromTx(tx), {
    article: {
      id: a.id,
      status: 'published',
      url: `${siteBase}/noticia/${a.slug}`,
      sourceName: PORTAL_SOURCE_NAME,
      fetchedAt: publishedAt,
      publishedAt,
      contentSha256: articleContentSha(a),
      headline: a.titulo,
      text: a.corpo,
      isMock: false,
    },
  });
}

/** Handlers reais, na mesma ordem da política de filas. */
export function createHandlers(env: Record<string, string | undefined> = process.env): Handlers {
  const siteBase = baseUrl(env);
  return {
    entidades: async (payload, tx) => ingestPublishedArticle(tx, payload.refId, siteBase),
  };
}

/** Compatibilidade: o processo de workers usa `createHandlers` para capturar o ambiente na subida. */
export const handlers: Handlers = createHandlers();
