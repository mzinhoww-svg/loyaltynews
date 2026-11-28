// Estado público da coleta (vigia externo, DP-94 condição 4): só o estado e o horário da última rodada boa. Olha o RESULTADO gravado,
// por isso acusa também o worker parado e a chave desligada. Definição de rodada boa e limites: docs/coleta-rodada-boa.md.

/** Prazo da rodada boa (PM): sem nenhuma há mais que isto, a coleta está atrasada. Vale para o aviso do worker e para a rota pública. */
export const ROUND_STALE_AFTER_MS = 5 * 3_600_000;

export interface CollectionStatus {
  estado: 'ok' | 'atrasada' | 'nunca';
  ultimaRodadaBoaEm: string | null;
}

/** `ultimaBoa` é o horário do último registro de rodada boa; ausente ou ilegível = nunca. */
export function collectionStatus(ultimaBoa: string | null, agora: Date): CollectionStatus {
  const t = ultimaBoa === null ? Number.NaN : Date.parse(ultimaBoa);
  if (Number.isNaN(t)) return { estado: 'nunca', ultimaRodadaBoaEm: null };
  return { estado: agora.getTime() - t > ROUND_STALE_AFTER_MS ? 'atrasada' : 'ok', ultimaRodadaBoaEm: new Date(t).toISOString() };
}
