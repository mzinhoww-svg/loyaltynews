import { route } from '../../../../_lib/http';
import { publicGetPessoa } from '../../../../_lib/intelligence/publico-pessoas';

export const dynamic = 'force-dynamic';
export const GET = route('public', publicGetPessoa);
