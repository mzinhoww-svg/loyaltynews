import { indexingBlocked, robotsTxt } from '../_lib/indexing';
import { SITE_URL } from '../_lib/site';
import { getSource } from '../_lib/source';

export const dynamic = 'force-dynamic';

/** Rota própria (não `robots.ts`) para funcionar dentro do route group (portal). */
export async function GET() {
  // noindex publicado no Studio soma-se ao bloqueio do ambiente.
  const blocked = indexingBlocked() || (await getSource().getSiteConfig())?.seo?.noindex === true;
  return new Response(robotsTxt(blocked, SITE_URL), { headers: { 'content-type': 'text/plain; charset=utf-8' } });
}
