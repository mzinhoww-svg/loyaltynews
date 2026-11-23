import { route } from '../../_lib/http';
import { openbotRoute } from '../../_lib/openbot';

export const dynamic = 'force-dynamic';
// Chamada do OpenBot (máquina a máquina): sem sessão; a autenticação é a assinatura HMAC no corpo cru (x-ln-signature, x-ln-timestamp).
export const POST = route('public', openbotRoute('callback'));
