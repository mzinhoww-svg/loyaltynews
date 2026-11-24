import { route } from '../../../_lib/http';
import { createEvidencia, listEvidencias } from '../../../_lib/fonte-rapida';

export const dynamic = 'force-dynamic';
// P2-05: evidência (URL + trecho) ligada a matéria em rascunho. Escrita só com materias:update; auditada; idempotente por `chave`.
export const GET = route(['materias', 'read'], listEvidencias);
export const POST = route(['materias', 'update'], createEvidencia, { audit: { action: 'evidencia.rapida_criada', resource: 'materias' } });
