import { route } from '../../../_lib/http';
import { postKillSwitch } from '../../../_lib/orcamento';

export const dynamic = 'force-dynamic';
// parada de emergência do gateway de modelos: só admin (orcamento:update), sessão com MFA, motivo obrigatório, auditada
export const POST = route(['orcamento', 'update'], postKillSwitch);
