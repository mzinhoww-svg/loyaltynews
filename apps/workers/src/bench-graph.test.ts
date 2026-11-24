import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createTestDb } from '@ln/db/testing';
import { EventEmitter } from 'node:events';
import { assertStagingBound, openBenchClient, runBenchGraphCli, type BenchCliDeps, type PgLike } from './bench-graph';

const MIGRATION = readFileSync(fileURLToPath(new URL('../../../packages/db/drizzle/0006_intelligence.sql', import.meta.url)), 'utf8');
const HOST = 'staging-db.example.invalid';
const NAME = 'vertracloud';
const BINDINGS = { ambientes: { staging: { dbHost: HOST, dbName: NAME }, production: { dbHost: null, dbName: null } } };
// URL montada em tempo de execução (nenhum literal de conexão no arquivo)
const url = (host = HOST, db = NAME) => ['postgres', '://', 'usuario', ':', 'senha-de-teste', '@', host, '/', db].join('');
const ENV = { APP_ENV: 'staging', DATABASE_URL: url() };
const CONFIRM = '--confirm-staging-bench';

function deps(over: Partial<BenchCliDeps> = {}) {
  const out: string[] = [], err: string[] = [];
  const connect = vi.fn(async () => { throw new Error('não deveria conectar'); });
  const d: BenchCliDeps = { argv: [CONFIRM], env: ENV, bindings: BINDINGS, migrationSql: MIGRATION, connect, out: (l) => out.push(l), err: (l) => err.push(l), ...over };
  return { d, out, err, connect };
}

describe('medição ADR-009 de dentro da rede: recusas ANTES de abrir qualquer conexão', () => {
  it('produção, ambiente vazio ou desconhecido: recusa com saída 2 e nada conecta', async () => {
    for (const APP_ENV of ['production', '', undefined, 'local', 'Staging']) {
      const { d, err, connect } = deps({ env: { ...ENV, APP_ENV } });
      expect(await runBenchGraphCli(d), String(APP_ENV)).toBe(2);
      expect(connect).not.toHaveBeenCalled();
      expect(err.join(' ')).toMatch(/medição recusada/);
    }
  });

  it('sem --confirm-staging-bench: recusa (nunca roda por engano)', async () => {
    const { d, err, connect } = deps({ argv: ['--scale', '0.02'] });
    expect(await runBenchGraphCli(d)).toBe(2);
    expect(connect).not.toHaveBeenCalled();
    expect(err.join(' ')).toMatch(/--confirm-staging-bench/);
  });

  it('DATABASE_URL de OUTRO banco, ausente, inválida ou de outro protocolo: recusa sem repetir a URL', async () => {
    for (const DATABASE_URL of [url('outro-host.example.invalid'), url(HOST, 'outrobanco'), undefined, 'isto não é url', ['mysql', '://u:p@'].join('') + HOST + '/' + NAME]) {
      const { d, err, out, connect } = deps({ env: { ...ENV, DATABASE_URL } });
      expect(await runBenchGraphCli(d)).toBe(2);
      expect(connect).not.toHaveBeenCalled();
      const all = [...err, ...out].join('\n');
      expect(all).toMatch(/recusado/);
      expect(all).not.toContain('senha-de-teste');
      expect(all).not.toContain('outro-host');
    }
  });

  it('staging sem vínculo registrado (bindings vazio/produção nula): recusa', () => {
    expect(() => assertStagingBound(url(), { ambientes: { staging: { dbHost: null, dbName: null } } })).toThrow(/sem vínculo/);
    expect(() => assertStagingBound(url(), {})).toThrow(/sem vínculo/);
  });
});

describe('medição ADR-009 de dentro da rede: execução (PGlite)', () => {
  it('caminho feliz: imprime só o relatório (JSON) no log, schema descartável apagado, intelligence intacto, nada de credencial na saída', async () => {
    const t = await createTestDb(); // PostgreSQL de teste com o schema oficial
    try {
      const snapshot = async () => (await t.client.query<{ c: string }>(`SELECT count(*)::text c FROM intelligence.organization`)).rows[0]!.c;
      const before = await snapshot();
      const closed = vi.fn(async () => undefined);
      const { d, out, err } = deps({
        argv: [CONFIRM, '--scale', '0.02', '--schema', 'ln_bench_20261123', '--with-indexes'],
        connect: async () => ({ client: { query: async (sql, params) => ({ rows: (await t.client.query(sql, params as unknown[])).rows as Record<string, unknown>[] }) }, close: closed }),
      });
      expect(await runBenchGraphCli(d)).toBe(0);
      expect(closed).toHaveBeenCalledTimes(1);
      const r = JSON.parse(out.join('\n')) as { schema: string; schema_dropped: boolean; origem: string; network: { select1_roundtrip: { p50_ms: number } }; with_indexes?: unknown };
      expect(r).toMatchObject({ schema: 'ln_bench_20261123', schema_dropped: true });
      expect(r.origem).toMatch(/dentro da rede/);
      expect(r.network.select1_roundtrip.p50_ms).toBeGreaterThanOrEqual(0);
      expect(r.with_indexes).toBeDefined();
      const left = await t.client.query(`SELECT 1 FROM pg_namespace WHERE nspname LIKE 'ln_bench%'`);
      expect(left.rows).toHaveLength(0);
      expect(await snapshot()).toBe(before);
      const everything = [...out, ...err].join('\n');
      expect(everything).not.toMatch(/senha-de-teste|postgres(ql)?:\/\/|BEGIN (CERT|PRIVATE)/);
    } finally {
      await t.close();
    }
  });

  it('erro de banco no meio: saída 1, só tipo/código na mensagem (nunca o texto do driver) e conexão fechada; schema inválido: mensagem própria', async () => {
    const closed = vi.fn(async () => undefined);
    const boom = Object.assign(new Error('falha com host ' + HOST + ' e usuário usuario'), { code: '42501', name: 'error' });
    const a = deps({ connect: async () => ({ client: { query: async () => { throw boom; } }, close: closed }) });
    expect(await runBenchGraphCli(a.d)).toBe(1);
    expect(a.err.join(' ')).toMatch(/falha: error \(42501\) — sem permissão para criar schema/);
    expect(a.err.join(' ')).not.toContain(HOST);
    expect(closed).toHaveBeenCalledTimes(1);
    const b = deps({ argv: [CONFIRM, '--schema', 'public'], connect: async () => ({ client: { query: async () => ({ rows: [] }) }, close: closed }) });
    expect(await runBenchGraphCli(b.d)).toBe(1);
    expect(b.err.join(' ')).toMatch(/bench_schema_invalido/);
  });
});

describe('R1 (incidente de 23/11): o cliente de banco tem ouvinte de erro ANTES de conectar, com saída saneada', () => {
  class FakePg extends EventEmitter {
    order: string[] = [];
    override on(event: string | symbol, l: (...a: unknown[]) => void): this { if (event === 'error') this.order.push('on-error'); return super.on(event, l); }
    async connect() { this.order.push('connect'); }
    async query() { return { rows: [] }; }
    async end() { this.order.push('end'); }
  }

  it('registra o ouvinte antes de conectar; um erro de conexão com o objeto do TLS NÃO vaza chave/PEM e NÃO derruba o processo', async () => {
    const fake = new FakePg();
    const lines: string[] = [];
    const { close } = await openBenchClient(() => fake as unknown as PgLike, (l) => lines.push(l));
    expect(fake.order).toEqual(['on-error', 'connect']); // ouvinte primeiro
    const pem = ['-----BEGIN ', 'PRIVATE KEY-----'].join('') + 'segredo-do-certificado';
    const boom = Object.assign(new Error('conexão caiu em ' + HOST), { code: 'ECONNRESET', name: 'Error', socket: { key: pem }, options: { ssl: { key: pem } } });
    expect(() => fake.emit('error', boom)).not.toThrow(); // com ouvinte, o EventEmitter não lança
    const all = lines.join(' | ');
    expect(all).toContain('ECONNRESET');
    expect(all).toMatch(/--replace/);
    expect(all).not.toMatch(/BEGIN|PRIVATE KEY|segredo-do-certificado/);
    await close();
    expect(fake.order.at(-1)).toBe('end');
  });
});
