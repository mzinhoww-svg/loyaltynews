import { route } from '../../_lib/http';
import { deleteArticle, getArticle, updateArticle } from '../../_lib/articles';

export const dynamic = 'force-dynamic';
export const GET = route(['materias', 'read'], getArticle);
export const PATCH = route(['materias', 'update'], updateArticle, { audit: { action: 'materia.alterada', resource: 'materias' } });
export const DELETE = route(['materias', 'delete'], deleteArticle, { audit: { action: 'materia.excluida', resource: 'materias' } });
