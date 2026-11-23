import { route } from '../../../_lib/http';
import { getMediaFile } from '../../../_lib/midia';

export const dynamic = 'force-dynamic';
export const GET = route(['midia', 'read'], getMediaFile);
