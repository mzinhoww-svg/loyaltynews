import { route } from '../../../_lib/http';
import { previewCard } from '../../../_lib/creative';

export const dynamic = 'force-dynamic';
// Prévia: só leitura (não grava nada), por isso social:read.
export const POST = route(['social', 'read'], previewCard);
