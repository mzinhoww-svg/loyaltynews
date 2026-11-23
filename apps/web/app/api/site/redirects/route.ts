import { route } from '../../_lib/http';
import { createRedirect, listRedirects } from '../../_lib/site';

export const dynamic = 'force-dynamic';
export const GET = route(['site', 'read'], listRedirects);
export const POST = route(['site', 'publish'], createRedirect, { audit: { action: 'site.redirect_criado', resource: 'site' } });
