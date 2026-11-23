import { route } from '../../../_lib/http';
import { moderateAgenda } from '../../../_lib/agenda';

export const dynamic = 'force-dynamic';
// moderar evento = decisão editorial: editor-chefe e admin (agenda:transition)
export const POST = route(['agenda', 'transition'], moderateAgenda);
