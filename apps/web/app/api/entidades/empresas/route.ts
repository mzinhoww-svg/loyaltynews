import { route } from '../../_lib/http';
import { listCompanies, createCompany } from '../../_lib/entidades';

export const dynamic = 'force-dynamic';
export const GET = route(['entidades', 'read'], listCompanies);
export const POST = route(['entidades', 'create'], createCompany, { audit: { action: 'empresa.criada', resource: 'entidades' } });
