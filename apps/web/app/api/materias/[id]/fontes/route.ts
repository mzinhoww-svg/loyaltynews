import { route } from '../../../_lib/http';
import { setArticleSources } from '../../../_lib/articles';

export const dynamic = 'force-dynamic';
export const PUT = route(['materias', 'update'], setArticleSources, { audit: { action: 'materia.fontes_alteradas', resource: 'materias' } });
