import { route } from '../../_lib/http';
import { uploadMedia } from '../../_lib/midia';

export const dynamic = 'force-dynamic';
export const POST = route(['midia', 'create'], uploadMedia, { audit: { action: 'midia.arquivo_enviado', resource: 'midia' } });
