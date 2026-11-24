import { route } from '../../../../_lib/http';
import { createFonteRapida } from '../../../../_lib/fonte-rapida';

export const dynamic = 'force-dynamic';
// P2-05: fonte rápida da Nova matéria. Só papel com escrita de fontes; auditada; idempotente por `chave`.
export const POST = route(['fontes', 'create'], createFonteRapida, { audit: { action: 'fonte.rapida_criada', resource: 'fontes' } });
