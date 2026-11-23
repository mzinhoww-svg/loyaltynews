import { route } from '../../../_lib/http';
import { publicGetAgenda } from '../../../_lib/agenda';

export const dynamic = 'force-dynamic';
export const GET = route('public', publicGetAgenda);
