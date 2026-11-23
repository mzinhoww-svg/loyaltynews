import { route } from '../../_lib/http';
import { listSiteDocs } from '../../_lib/site';

export const dynamic = 'force-dynamic';
export const GET = route(['site', 'read'], listSiteDocs);
