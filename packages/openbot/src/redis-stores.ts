import type { CallbackStore } from './handlers';
import type { HealthStore } from './health';
import { DEFAULT_TOLERANCE_MS } from './signing';

// Stores em Redis do adaptador OpenBot. O Redis guarda só IDs e a chave de idempotência (ADR-002); a verdade fica no
// PostgreSQL. `RedisLike` é estrutural: o ioredis satisfaz; nenhuma conexão é criada aqui e nenhum segredo é lido.

export interface RedisLike {
  set(key: string, value: string, mode: 'PX', ttlMs: number, flag: 'NX'): Promise<'OK' | null>;
  set(key: string, value: string, mode: 'PX', ttlMs: number): Promise<'OK' | null>;
  get(key: string): Promise<string | null>;
}

export const DEFAULT_CALLBACK_TTL_MS = 24 * 60 * 60 * 1000;

/**
 * Dedupe de `callbackId` atômico (`SET key NX PX ttl`): em chamadas concorrentes, exatamente uma vê o id pela primeira vez,
 * em qualquer número de processos. O TTL tem de cobrir a janela de assinatura (um replay dentro da janela ainda seria
 * aceito pela assinatura): mínimo 2× a tolerância.
 */
export class RedisCallbackStore implements CallbackStore {
  private readonly redis: RedisLike;
  private readonly prefix: string;
  private readonly ttlMs: number;

  constructor(redis: RedisLike, opts: { prefix?: string; ttlMs?: number } = {}) {
    const ttlMs = opts.ttlMs ?? DEFAULT_CALLBACK_TTL_MS;
    if (!Number.isInteger(ttlMs) || ttlMs < 2 * DEFAULT_TOLERANCE_MS) {
      throw new Error(`ttl do callbackId deve ser inteiro e >= ${2 * DEFAULT_TOLERANCE_MS} ms (2x a janela de assinatura)`);
    }
    this.redis = redis;
    this.prefix = opts.prefix ?? 'ln:openbot:cb:';
    this.ttlMs = ttlMs;
  }

  async firstSeen(callbackId: string): Promise<boolean> {
    return (await this.redis.set(`${this.prefix}${callbackId}`, '1', 'PX', this.ttlMs, 'NX')) === 'OK';
  }
}

/** Último pull do OpenBot em Redis (compartilhado entre processos). Só workerId e instante; sem conteúdo. */
export class RedisHealthStore implements HealthStore {
  private readonly redis: RedisLike;
  private readonly key: string;
  private readonly ttlMs: number;

  constructor(redis: RedisLike, opts: { key?: string; ttlMs?: number } = {}) {
    this.redis = redis;
    this.key = opts.key ?? 'ln:openbot:last-pull';
    this.ttlMs = opts.ttlMs ?? 7 * 24 * 60 * 60 * 1000;
  }

  async markPull(workerId: string, now: Date): Promise<void> {
    await this.redis.set(this.key, JSON.stringify({ workerId, at: now.toISOString() }), 'PX', this.ttlMs);
  }

  async last(): Promise<{ workerId: string; at: string } | null> {
    const raw = await this.redis.get(this.key);
    if (!raw) return null;
    try {
      const v = JSON.parse(raw) as { workerId?: unknown; at?: unknown };
      return typeof v.workerId === 'string' && typeof v.at === 'string' ? { workerId: v.workerId, at: v.at } : null;
    } catch {
      return null;
    }
  }
}
