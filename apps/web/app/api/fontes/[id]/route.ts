import { route } from '../../_lib/http';
import { getSource, patchSource, deleteSource } from '../../_lib/fontes';

export const dynamic = 'force-dynamic';
export const GET = route(['fontes', 'read'], getSource);
export const PATCH = route(['fontes', 'update'], patchSource, { audit: { action: 'fonte.alterada', resource: 'fontes' } });
export const DELETE = route(['fontes', 'delete'], deleteSource, { audit: { action: 'fonte.excluida', resource: 'fontes' } });
