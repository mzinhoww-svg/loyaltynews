import { route } from '../../_lib/http';
import { publicListEditorias } from '../../_lib/editorias';

export const dynamic = 'force-dynamic';
export const GET = route('public', publicListEditorias);
