import { route } from '../../../_lib/http';
import { transitionArticle } from '../../../_lib/articles';

export const dynamic = 'force-dynamic';
export const POST = route(['materias', 'transition'], transitionArticle, { audit: { action: 'materia.transicao', resource: 'materias' } });
