import { route } from '../../../_lib/http';
import { openbotIoInput } from '../../../_lib/openbot';

export const dynamic = 'force-dynamic';
// O agente do OpenBot lê a entrada da tarefa (assinatura HMAC + lease vivo).
export const POST = route('public', openbotIoInput);
