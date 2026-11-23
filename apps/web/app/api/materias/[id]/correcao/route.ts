import { route } from '../../../_lib/http';
import { discardRevision, getRevision } from '../../../_lib/correcao';

export const dynamic = 'force-dynamic';
// revisão de correção em aberto (ADR-019 §c.5): ler e descartar; criar/alterar é PATCH /api/materias/{id} com casoCorrecaoId
export const GET = route(['materias', 'read'], getRevision);
export const DELETE = route(['materias', 'transition'], discardRevision, { audit: { action: 'materia.revisao_descartada', resource: 'materias' } });
