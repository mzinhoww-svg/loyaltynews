import { route } from '../../../_lib/http';
import { publicGetArticle } from '../../../_lib/articles';

export const dynamic = 'force-dynamic';
export const GET = route('public', publicGetArticle);
