import { route } from '../../../_lib/http';
import { deleteRedirect, patchRedirect } from '../../../_lib/site';

export const dynamic = 'force-dynamic';
export const PATCH = route(['site', 'publish'], patchRedirect, { audit: { action: 'site.redirect_alterado', resource: 'site' } });
// excluir é do admin; a chefia desativa (ativo=false)
export const DELETE = route(['site', 'delete'], deleteRedirect, { audit: { action: 'site.redirect_excluido', resource: 'site' } });
