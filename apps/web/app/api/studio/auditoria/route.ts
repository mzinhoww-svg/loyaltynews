import { route } from '../../_lib/http';
import { listAuditoria } from '../../_lib/auditoria';

export const dynamic = 'force-dynamic';
// trilha de auditoria (admin e editor-chefe leem; o IP só o admin vê)
export const GET = route(['auditoria', 'read'], listAuditoria);
