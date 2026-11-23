import { route } from '../../_lib/http';
import { getAgenda, patchAgenda, deleteAgenda } from '../../_lib/agenda';

export const dynamic = 'force-dynamic';
export const GET = route(['agenda', 'read'], getAgenda);
export const PATCH = route(['agenda', 'update'], patchAgenda, { audit: { action: 'agenda.alterada', resource: 'agenda' } });
export const DELETE = route(['agenda', 'delete'], deleteAgenda, { audit: { action: 'agenda.excluida', resource: 'agenda' } });
