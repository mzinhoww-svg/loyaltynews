import { route } from '../../../_lib/http';
import { publicListPessoas } from '../../../_lib/intelligence/publico-pessoas';

export const dynamic = 'force-dynamic';
export const GET = route('public', publicListPessoas);
