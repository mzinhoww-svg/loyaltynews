import { SITE_URL } from '../_lib/site';
import { isMockSource } from '../_lib/source';

export const dynamic = 'force-dynamic';

/** Rota própria (não `robots.ts`) para funcionar dentro do route group (portal). */
export function GET() {
  const body = isMockSource()
    ? // Com fonte MOCK, nada deve ser indexado.
      'User-Agent: *\nDisallow: /\n'
    : `User-Agent: *\nAllow: /\nDisallow: /busca\nDisallow: /studio\nDisallow: /api/\n\nSitemap: ${SITE_URL}/sitemap.xml\n`;
  return new Response(body, { headers: { 'content-type': 'text/plain; charset=utf-8' } });
}
