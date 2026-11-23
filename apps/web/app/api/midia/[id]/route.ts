import { route } from '../../_lib/http';
import { deleteMedia, getMedia, patchMedia } from '../../_lib/midia';

export const dynamic = 'force-dynamic';
export const GET = route(['midia', 'read'], getMedia);
export const PATCH = route(['midia', 'update'], patchMedia, { audit: { action: 'midia.alterada', resource: 'midia' } });
export const DELETE = route(['midia', 'delete'], deleteMedia, { audit: { action: 'midia.excluida', resource: 'midia' } });
