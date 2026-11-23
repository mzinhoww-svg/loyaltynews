import { route } from '../../../_lib/http';
import { adCreativeImageRoute } from '../../../_lib/commercial/ads-public';

export const dynamic = 'force-dynamic';
// Arquivo do criativo real (aprovado, campanha ativa, no período), com cabeçalhos defensivos e ETag pelo sha256. Pública.
export const GET = route('public', adCreativeImageRoute);
