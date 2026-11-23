import { route } from '../../../../_lib/http';
import { rollbackSiteDoc } from '../../../../_lib/site';

export const dynamic = 'force-dynamic';
export const POST = route(['site', 'publish'], rollbackSiteDoc);
