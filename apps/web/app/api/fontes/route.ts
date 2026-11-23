import { route } from '../_lib/http';
import { listSources, createSource } from '../_lib/fontes';

export const dynamic = 'force-dynamic';
export const GET = route(['fontes', 'read'], listSources);
export const POST = route(['fontes', 'create'], createSource, { audit: { action: 'fonte.criada', resource: 'fontes' } });
