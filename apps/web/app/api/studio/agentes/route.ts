import { route } from '../../_lib/http';
import { getAgentesEstado } from '../../_lib/estado';

export const dynamic = 'force-dynamic';
// estado real dos agentes: organização (config), execuções de ritual e adaptador OpenBot (PostgreSQL); admin e editor-chefe
export const GET = route(['orcamento', 'read'], getAgentesEstado);
