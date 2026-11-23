import { dispatchTitular } from '../../../_lib/titular-studio';

export const dynamic = 'force-dynamic';
// Fila de pedidos do titular (DP-38). RBAC `titular`: editor-chefe e admin; demais 403.
export const GET = dispatchTitular;
export const POST = dispatchTitular;
