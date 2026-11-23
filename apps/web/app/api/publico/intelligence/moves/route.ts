import { route } from '../../../_lib/http';
import { publicListMoves } from '../../../_lib/intelligence/publico-pessoas';

export const dynamic = 'force-dynamic';
export const GET = route('public', publicListMoves);
