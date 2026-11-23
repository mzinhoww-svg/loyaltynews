import { route } from '../../../_lib/http';
import { suggestAgenda } from '../../../_lib/agenda';

export const dynamic = 'force-dynamic';
// público e sem sessão: limite por IP, honeypot, teto de pendentes e dedupe dentro do handler
export const POST = route('public', suggestAgenda);
