// ArticleSource do Social Dashboard: lê a matéria do PostgreSQL e projeta para o Growth (toSocialArticle).
// Fatos vêm SÓ da checagem editorial (claims `fact` com veredito `pass` no registro do CMS), nunca do corpo;
// sem fato com fonte não há post (o motor de copy recusa). `gatesPassed` exige estado aprovado/publicado/corrigido
// E recibo da versão atual. A URL canônica é NEXT_PUBLIC_SITE_URL (mesma variável do portal; padrão: localhost) + /noticia/{slug}, a rota pública do portal.
import { and, eq } from 'drizzle-orm';
import { schema } from '@ln/db';
import type { Article as ContractArticle } from '@ln/contracts';
import type { Db } from '@ln/auth';
import { PgEditorialStore } from '@ln/workers/editorial-store';
import { toSocialArticle, type ArticleSource } from '@ln/growth/dashboard';
import type { Article, Fact } from '@ln/growth';

/** URL pública da matéria no portal: `${NEXT_PUBLIC_SITE_URL}/noticia/${slug}` (sem barra dupla). */
export function portalArticleUrl(siteUrl: string, slug: string): string {
  return `${siteUrl.trim().replace(/\/+$/, '')}/noticia/${encodeURIComponent(slug)}`;
}

export class PgArticleSource implements ArticleSource {
  constructor(
    private readonly db: Db,
    private readonly siteUrl: string,
  ) {}

  async get(id: string): Promise<Article | null> {
    const [a] = await this.db.select().from(schema.articles).where(eq(schema.articles.id, id));
    if (!a) return null;
    const [receipt] = await this.db
      .select({ id: schema.publicationReceipts.id })
      .from(schema.publicationReceipts)
      .where(and(eq(schema.publicationReceipts.articleId, a.id), eq(schema.publicationReceipts.versao, a.versao)));
    const approved = ['aprovado', 'publicado', 'corrigido'].includes(a.status);
    const contract = {
      id: a.id, slug: a.slug, titulo: a.titulo, subtitulo: a.subtitulo ?? undefined, resumo: a.resumo ?? undefined, tipoConteudo: a.tipoConteudo,
      editoria: a.editoria, status: a.status, assinatura: a.assinatura, corpo: a.corpo, fontes: [], imagem: a.imagem ?? undefined,
      classeDeDado: a.classeDeDado, patrocinado: a.patrocinado, rotuloPublieditorial: a.rotuloPublieditorial ?? undefined, versao: a.versao,
    } as unknown as ContractArticle;
    return toSocialArticle(contract, {
      url: portalArticleUrl(this.siteUrl, a.slug),
      facts: await this.approvedFacts(a.id),
      gatesPassed: approved && Boolean(receipt),
      mock: false,
    });
  }

  /** Claims `fact` aprovadas pela checagem, com a URL da evidência como fonte. */
  private async approvedFacts(articleId: string): Promise<Fact[]> {
    const rec = await new PgEditorialStore(this.db).getArticle(articleId);
    if (!rec?.draft || !rec.factcheck) return [];
    const pass = new Set(rec.factcheck.verdicts.filter((v) => v.verdict === 'pass').map((v) => v.claimId));
    const url = new Map(rec.evidences.map((e) => [e.id, e.url]));
    return rec.draft.claims
      .filter((c) => c.kind === 'fact' && pass.has(c.id))
      .flatMap((c) => {
        const source = c.evidenceIds.map((e) => url.get(e)).find(Boolean);
        return source ? [{ text: c.text, source }] : [];
      });
  }
}
