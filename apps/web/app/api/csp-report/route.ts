import { criarColetorCsp } from '../_lib/csp-report';

// Relatórios de violação da CSP enviados pelo navegador (lib/csp.ts). Só registra no log; não grava em banco.
export const dynamic = 'force-dynamic';

export const POST = criarColetorCsp();
