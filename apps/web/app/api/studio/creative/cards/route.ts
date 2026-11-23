import { route } from '../../../_lib/http';
import { createCard, listCards } from '../../../_lib/creative';

export const dynamic = 'force-dynamic';
export const GET = route(['social', 'read'], listCards);
export const POST = route(['social', 'create'], createCard);
