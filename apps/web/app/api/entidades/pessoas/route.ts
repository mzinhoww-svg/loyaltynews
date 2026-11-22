import { route } from '../../_lib/http';
import { listPeople, createPerson } from '../../_lib/entidades';

export const dynamic = 'force-dynamic';
export const GET = route(['entidades', 'read'], listPeople);
export const POST = route(['entidades', 'create'], createPerson, { audit: { action: 'pessoa.criada', resource: 'entidades' } });
