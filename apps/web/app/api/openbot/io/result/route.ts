import { route } from '../../../_lib/http';
import { openbotIoResult } from '../../../_lib/openbot';

export const dynamic = 'force-dynamic';
// O agente do OpenBot grava o resultado da tentativa (assinatura HMAC + lease vivo) e recebe o resultRef.
export const POST = route('public', openbotIoResult);
