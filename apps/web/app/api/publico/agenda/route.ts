import { route } from '../../_lib/http';
import { publicListAgenda } from '../../_lib/agenda';

export const dynamic = 'force-dynamic';
export const GET = route('public', publicListAgenda);
