import { route } from '../../../_lib/http';
import { issueReceipt } from '../../../_lib/articles';

export const dynamic = 'force-dynamic';
export const POST = route(['materias', 'transition'], issueReceipt, { audit: { action: 'materia.recibo_emitido', resource: 'materias' } });
