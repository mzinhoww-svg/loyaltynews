import { route } from '../_lib/http';
import { createArticle, listArticles } from '../_lib/articles';

export const dynamic = 'force-dynamic';
export const GET = route(['materias', 'read'], listArticles);
export const POST = route(['materias', 'create'], createArticle, { audit: { action: 'materia.criada', resource: 'materias' } });
