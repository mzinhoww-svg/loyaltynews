import { route } from '../../../_lib/http';
import { getPublicMediaFile } from '../../../_lib/midia';

export const dynamic = 'force-dynamic';
// público, somente leitura: só serve imagem citada por matéria publicada/corrigida (nada de listar o acervo)
export const GET = route('public', getPublicMediaFile);
