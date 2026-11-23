import { route } from '../../_lib/http';
import { getMedia, deleteMedia } from '../../_lib/midia';

export const dynamic = 'force-dynamic';
export const GET = route(['midia', 'read'], getMedia);
export const DELETE = route(['midia', 'delete'], deleteMedia, { audit: { action: 'midia.excluida', resource: 'midia' } });
