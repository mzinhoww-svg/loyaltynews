import { route } from '../../_lib/http';
import { getModelopsEstado } from '../../_lib/estado';

export const dynamic = 'force-dynamic';
// política de modelos carregada, flags, parada e consumo do mês no ledger canônico; admin e editor-chefe
export const GET = route(['orcamento', 'read'], getModelopsEstado);
