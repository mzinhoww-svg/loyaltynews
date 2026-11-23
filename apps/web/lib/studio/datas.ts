/** Hoje no fuso de São Paulo, em AAAA-MM-DD. */
export function hojeSP(agora = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(agora);
}

/** Evento ainda não terminou (fim >= hoje): entra na lista de próximos; senão vai para o arquivo. */
export const eventoVigente = (fim: string, hoje: string): boolean => fim >= hoje;
