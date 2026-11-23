import { route } from '../../../../_lib/http';
import { uploadCreativeFile } from '../../../../_lib/commercial/creative-upload';

export const dynamic = 'force-dynamic';
// Upload do arquivo do criativo (multipart): tipo, dimensões, peso e hash medidos no servidor. Só quem gerencia o comercial.
export const POST = route(['campanhas', 'update'], uploadCreativeFile);
