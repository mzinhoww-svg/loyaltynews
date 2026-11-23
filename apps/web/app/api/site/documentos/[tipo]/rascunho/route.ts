import { route } from '../../../../_lib/http';
import { putDraft } from '../../../../_lib/site';

export const dynamic = 'force-dynamic';
// home e menus: o handler exige papel de chefia; SEO e links internos: editor também escreve
export const PUT = route(['site', 'update'], putDraft);
