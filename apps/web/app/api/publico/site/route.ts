import { route } from '../../_lib/http';
import { publicSite } from '../../_lib/site';

export const dynamic = 'force-dynamic';
export const GET = route('public', publicSite);
