// Contrato de hidratação/persistência do módulo: cada classe de estado expõe `snapshot()` (dados puros, JSON-serializáveis,
// cópia profunda) e `load(snapshot)` (substitui o estado, valida a versão e recalcula os contadores de id).
// O Backend usa isto no lugar de acessar campos privados.
export const SNAPSHOT_VERSION = 1 as const;

export class SnapshotError extends Error {
  code = 'INVALID_SNAPSHOT' as const;
}

/** Exige objeto com `version` suportada. Falha na hora em vez de corromper estado. */
export function assertSnapshot(s: unknown, what: string, arrays: readonly string[] = []): asserts s is { version: typeof SNAPSHOT_VERSION } & Record<string, unknown> {
  if (typeof s !== 'object' || s === null) throw new SnapshotError(`${what}: snapshot ausente ou inválido.`);
  const o = s as Record<string, unknown>;
  if (o.version !== SNAPSHOT_VERSION) throw new SnapshotError(`${what}: versão de snapshot ${String(o.version)} não suportada (esperado ${SNAPSHOT_VERSION}).`);
  for (const k of arrays) if (!Array.isArray(o[k])) throw new SnapshotError(`${what}: campo "${k}" deve ser lista.`);
}

/** Falha se houver ids repetidos (carga duplicada corromperia o estado). */
export function assertUnique(ids: readonly string[], what: string): void {
  if (new Set(ids).size !== ids.length) throw new SnapshotError(`${what}: ids duplicados no snapshot.`);
}

/** Maior sufixo numérico entre ids `prefixo-N`; ids de outro formato (ex.: uuid) são ignorados. */
export function maxSeq(ids: Iterable<string>): number {
  let max = 0;
  for (const id of ids) {
    const m = /-(\d+)$/.exec(id);
    if (m) max = Math.max(max, Number(m[1]));
  }
  return max;
}

/** Cópia profunda de dados puros (o snapshot nunca compartilha referência com o estado vivo). */
export const clone = <T>(v: T): T => structuredClone(v);
