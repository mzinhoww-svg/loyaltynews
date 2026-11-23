import { route } from '../../../../../_lib/http';
import { transitionCard } from '../../../../../_lib/creative';

export const dynamic = 'force-dynamic';
// Base social:create (revisor só lê); aprovar/rejeitar confere social:publish dentro do handler. Auditoria no handler (de→para, motivo).
export const POST = route(['social', 'create'], transitionCard);
