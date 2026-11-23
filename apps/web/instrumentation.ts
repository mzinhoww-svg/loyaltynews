// Instrumentação do servidor web (Next): guardas de saída e de erro do incidente de 23/11 (ver @ln/db/safe-log).
export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') await import('./instrumentation-node');
}
