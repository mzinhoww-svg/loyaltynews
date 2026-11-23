import { route } from '../../../../_lib/http';
import { getCard } from '../../../../_lib/creative';

export const dynamic = 'force-dynamic';
export const GET = route(['social', 'read'], getCard);
