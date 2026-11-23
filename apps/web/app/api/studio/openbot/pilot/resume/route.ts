import { route } from '../../../../_lib/http';
import { openbotPilotResume } from '../../../../_lib/openbot';

export const dynamic = 'force-dynamic';
// retoma o piloto do OpenBot depois de uma parada imediata (DP-41): só admin (usuarios:update) e só se o canDispatchNext do AgentOps voltou a aceitar as linhas; auditado
export const POST = route(['usuarios', 'update'], openbotPilotResume, { audit: { action: 'openbot.piloto_retomado', resource: 'openbot' } });
