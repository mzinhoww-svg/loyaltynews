import { route } from '../../../_lib/http';
import { publicListEmpresas } from '../../../_lib/intelligence/publico';

export const dynamic = 'force-dynamic';
export const GET = route('public', publicListEmpresas);
