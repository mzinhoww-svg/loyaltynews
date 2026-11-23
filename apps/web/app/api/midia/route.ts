import { route } from '../_lib/http';
import { createMedia, listMedia } from '../_lib/midia';

export const dynamic = 'force-dynamic';
export const GET = route(['midia', 'read'], listMedia);
export const POST = route(['midia', 'create'], createMedia, { audit: { action: 'midia.criada', resource: 'midia' } });
