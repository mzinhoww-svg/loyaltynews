import { route } from '../_lib/http';
import { createEditoria, listEditorias } from '../_lib/editorias';

export const dynamic = 'force-dynamic';
export const GET = route(['editorias', 'read'], listEditorias);
export const POST = route(['editorias', 'create'], createEditoria, { audit: { action: 'editoria.criada', resource: 'editorias' } });
