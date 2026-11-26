import { route } from '../../../../../../../_lib/http';
import { openbotPilotResolve } from '../../../../../../../_lib/openbot-piloto-linhas';

export const dynamic = 'force-dynamic';
// trata uma violação do piloto (decisão PM-2026-11-23-D): só admin, auditada; libera o despacho e a retomada, NÃO apaga a linha e a violação continua contando no critério
export const POST = route(['usuarios', 'update'], openbotPilotResolve);
