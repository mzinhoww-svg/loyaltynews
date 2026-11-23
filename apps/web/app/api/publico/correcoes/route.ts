import { route } from '../../_lib/http';
import { pedidoTitular } from '../../_lib/titular';

export const dynamic = 'force-dynamic';
// Canal do titular (DP-38): público e sem sessão; limite por IP e por contato, honeypot, teto de abertos e dedupe dentro do handler.
export const POST = route('public', pedidoTitular);
