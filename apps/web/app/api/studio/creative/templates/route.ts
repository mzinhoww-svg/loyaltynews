import { route } from '../../../_lib/http';
import { listTemplates } from '../../../_lib/creative';

export const dynamic = 'force-dynamic';
export const GET = route(['social', 'read'], listTemplates);
