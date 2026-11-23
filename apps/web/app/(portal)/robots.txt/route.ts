import { indexingBlocked, robotsTxt } from '../_lib/indexing';
import { SITE_URL } from '../_lib/site';

export const dynamic = 'force-dynamic';

/** Rota própria (não `robots.ts`) para funcionar dentro do route group (portal). */
export function GET() {
  return new Response(robotsTxt(indexingBlocked(), SITE_URL), { headers: { 'content-type': 'text/plain; charset=utf-8' } });
}
