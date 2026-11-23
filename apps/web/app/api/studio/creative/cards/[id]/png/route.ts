import { route } from '../../../../../_lib/http';
import { getCardPng } from '../../../../../_lib/creative';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs'; // sharp
export const GET = route(['social', 'read'], getCardPng);
