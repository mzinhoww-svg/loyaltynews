import { route } from '../../../../_lib/http';
import { publicGetMove } from '../../../../_lib/intelligence/publico-pessoas';

export const dynamic = 'force-dynamic';
export const GET = route('public', publicGetMove);
