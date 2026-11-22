import { route } from '../../../_lib/http';
import { listEvidences, createEvidence } from '../../../_lib/fontes';

export const dynamic = 'force-dynamic';
export const GET = route(['fontes', 'read'], listEvidences);
export const POST = route(['fontes', 'create'], createEvidence, { audit: { action: 'evidencia.criada', resource: 'fontes' } });
