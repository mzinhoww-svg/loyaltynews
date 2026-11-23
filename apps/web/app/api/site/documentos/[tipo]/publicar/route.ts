import { route } from '../../../../_lib/http';
import { publishSiteDoc } from '../../../../_lib/site';

export const dynamic = 'force-dynamic';
// publicar ou agendar: só a chefia (site:publish); auditoria é feita no handler
export const POST = route(['site', 'publish'], publishSiteDoc);
