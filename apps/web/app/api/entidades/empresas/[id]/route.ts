import { route } from '../../../_lib/http';
import { getCompany, patchCompany, deleteCompany } from '../../../_lib/entidades';

export const dynamic = 'force-dynamic';
export const GET = route(['entidades', 'read'], getCompany);
export const PATCH = route(['entidades', 'update'], patchCompany, { audit: { action: 'empresa.alterada', resource: 'entidades' } });
export const DELETE = route(['entidades', 'delete'], deleteCompany, { audit: { action: 'empresa.excluida', resource: 'entidades' } });
