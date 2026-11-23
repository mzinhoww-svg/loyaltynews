import { route } from '../../../_lib/http';
import { adPlanRoute } from '../../../_lib/commercial/ads-public';

export const dynamic = 'force-dynamic';
// Plano das posições (leitura leve; nada é contado). Pública.
export const GET = route('public', adPlanRoute);
