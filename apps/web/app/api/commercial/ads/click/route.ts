import { route } from '../../../_lib/http';
import { adClickRoute } from '../../../_lib/commercial/ads-public';

export const dynamic = 'force-dynamic';
// Clique no anúncio: 302 para o destino do criativo cadastrado (conta o clique). Pública.
export const GET = route('public', adClickRoute);
