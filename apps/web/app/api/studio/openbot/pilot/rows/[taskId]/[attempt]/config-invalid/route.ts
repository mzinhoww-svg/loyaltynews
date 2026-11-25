import { route } from '../../../../../../../_lib/http';
import { openbotPilotConfigInvalid } from '../../../../../../../_lib/openbot-piloto-linhas';

export const dynamic = 'force-dynamic';
// Exclui por CONFIGURAÇÃO uma linha inválida só por conta/modelo (criada antes do D1): só admin, auditada, preserva a linha.
export const POST = route(['usuarios', 'update'], openbotPilotConfigInvalid);
