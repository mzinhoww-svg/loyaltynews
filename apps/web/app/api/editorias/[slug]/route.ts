import { route } from '../../_lib/http';
import { deleteEditoria, getEditoria, patchEditoria } from '../../_lib/editorias';

export const dynamic = 'force-dynamic';
export const GET = route(['editorias', 'read'], getEditoria);
export const PATCH = route(['editorias', 'update'], patchEditoria, { audit: { action: 'editoria.alterada', resource: 'editorias' } });
export const DELETE = route(['editorias', 'delete'], deleteEditoria, { audit: { action: 'editoria.excluida', resource: 'editorias' } });
