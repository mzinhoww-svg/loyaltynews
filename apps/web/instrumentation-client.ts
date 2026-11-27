/**
 * Roda no navegador antes da hidratação (convenção do Next).
 *
 * Zod testa `new Function` para acelerar a validação. Sob a CSP (lib/csp.ts, sem 'unsafe-eval') o teste, mesmo capturado, vira
 * violação em toda página pública. `jitless` desliga o teste; a validação continua igual, sem a compilação em tempo de execução.
 * Escrito direto no global do Zod para não levar a biblioteca às páginas que não a usam.
 */
const g = globalThis as typeof globalThis & { __zod_globalConfig?: { jitless?: boolean } };
(g.__zod_globalConfig ??= {}).jitless = true;

export {};
