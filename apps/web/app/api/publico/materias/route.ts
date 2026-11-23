import { route } from '../../_lib/http';
import { publicListArticles } from '../../_lib/articles';

export const dynamic = 'force-dynamic';
export const GET = route('public', publicListArticles);
