import { route } from '../_lib/http';
import { listAgenda, createAgenda } from '../_lib/agenda';

export const dynamic = 'force-dynamic';
export const GET = route(['agenda', 'read'], listAgenda);
export const POST = route(['agenda', 'create'], createAgenda, { audit: { action: 'agenda.criada', resource: 'agenda' } });
