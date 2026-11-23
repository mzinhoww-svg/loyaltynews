import { route } from '../../../../_lib/http';
import { openbotPilotRows } from '../../../../_lib/openbot-piloto-linhas';

export const dynamic = 'force-dynamic';
// linhas do piloto do OpenBot (planilha de medição, DP-41): só leitura; admin e editor-chefe (como o estado dos agentes); auditada
export const GET = route(['orcamento', 'read'], openbotPilotRows, { audit: { action: 'openbot.piloto_linhas_lidas', resource: 'openbot' } });
