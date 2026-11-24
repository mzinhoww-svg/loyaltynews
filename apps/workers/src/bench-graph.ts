// Medição da ADR-009 (p95 ≤ 300 ms com 100 mil arestas) de DENTRO da rede da Vertra: execução ÚNICA no worker de staging, com saída só no log (stdout).
//   node dist/bench-graph.js --confirm-staging-bench [--scale 0.02] [--with-reference] [--with-indexes] [--replace] [--schema ln_bench_AAAAMMDD]
// Mesma lógica e as mesmas garantias de packages/intelligence/src/bench-pg.ts (testadas): só cria/apaga o schema `ln_bench_<AAAAMMDD>` (sintético, descartável),
// nunca toca em `intelligence` nem em outro schema, apaga no fim, em erro e em SIGINT/SIGTERM, e confere em pg_namespace. Medido daqui, a ida e volta ao banco é a
// do aplicativo real (mesma rede): é a medição que falta para fechar o critério (a de fora da rede só dava estimativa).
// Limites (todos ANTES de abrir conexão):
//   L1 APP_ENV exatamente `staging`; produção, vazio ou outro valor recusam com saída 2.
//   L2 `--confirm-staging-bench` obrigatório (nunca roda por engano nem por reinício do processo).
//   L3 DATABASE_URL precisa ser o banco de staging registrado em infra/vertra/bindings.json (host e nome; embutido no build): outro banco recusa, sem repetir a URL.
//   L4 stdout/stderr nunca levam URL, usuário, senha nem PEM; só o relatório (tempos, contagens, versão, planos de dados sintéticos) ou tipo/código do erro.
//   L5 nenhuma rota HTTP, nenhum processo novo, nenhum custo: roda no worker que já existe, com a conexão (TLS) que o worker já tem.
// Build: npm run build:bench-graph -w @ln/workers (a migração oficial 0006 é embutida no bundle como texto).
import type { BenchClient, BenchHandle, BenchOptions } from '@ln/intelligence/bench-pg';
import { runPgBench } from '@ln/intelligence/bench-pg';

export class BenchRefused extends Error {}

export interface BindingsFile { ambientes?: Record<string, { dbHost: string | null; dbName: string | null } | undefined> }

/** L1. */
export function assertStaging(env: Record<string, string | undefined>): void {
  if (env.APP_ENV !== 'staging') throw new BenchRefused(`medição recusada: APP_ENV=${env.APP_ENV ? env.APP_ENV : '(vazio)'}; só vale em staging`);
}

/** L3: sem repetir a URL na mensagem. */
export function assertStagingBound(databaseUrl: string | undefined, bindings: BindingsFile): void {
  const reg = bindings.ambientes?.staging;
  if (!reg || !reg.dbHost || !reg.dbName) throw new BenchRefused('staging sem vínculo de banco em infra/vertra/bindings.json: recusado');
  let u: URL;
  try { u = new URL(databaseUrl ?? ''); } catch { throw new BenchRefused('DATABASE_URL ausente ou inválida: recusado'); }
  if (!/^postgres(ql)?:$/.test(u.protocol)) throw new BenchRefused('DATABASE_URL precisa ser postgres://: recusado');
  const database = decodeURIComponent(u.pathname.replace(/^\//, ''));
  if (u.hostname.toLowerCase() !== reg.dbHost.toLowerCase() || database !== reg.dbName) {
    throw new BenchRefused('DATABASE_URL NÃO aponta para o banco de staging registrado em infra/vertra/bindings.json: recusado');
  }
}

export interface BenchCliDeps {
  argv: string[];
  env: Record<string, string | undefined>;
  bindings: BindingsFile;
  migrationSql: string;
  /** Abre UMA conexão (sessão única). `close` sempre é chamado. */
  connect: (env: Record<string, string | undefined>) => Promise<{ client: BenchClient; close: () => Promise<void> }>;
  /** Saída padrão (o log do worker). */
  out: (line: string) => void;
  err: (line: string) => void;
  /** Recebe o abort() para ligar a SIGINT/SIGTERM. */
  onHandle?: (h: BenchHandle) => void;
}

const argValue = (argv: string[], name: string) => { const i = argv.indexOf(`--${name}`); return i >= 0 ? argv[i + 1] : undefined; };

/** Devolve o código de saída: 0 ok (schema apagado), 1 falha ou schema que sobrou, 2 recusa (nada foi aberto). */
export async function runBenchGraphCli(d: BenchCliDeps): Promise<number> {
  const { argv, env } = d;
  let opts: BenchOptions;
  try {
    assertStaging(env);
    if (!argv.includes('--confirm-staging-bench')) throw new BenchRefused('medição recusada: falta --confirm-staging-bench');
    assertStagingBound(env.DATABASE_URL, d.bindings);
    const scale = argValue(argv, 'scale') === undefined ? 1 : Number(argValue(argv, 'scale'));
    opts = {
      migrationSql: d.migrationSql, schema: argValue(argv, 'schema'), scale, replace: argv.includes('--replace'),
      compareReference: argv.includes('--with-reference'), withIndexes: argv.includes('--with-indexes'), log: (l) => d.err(`[bench] ${l}`),
    };
  } catch (e) {
    d.err(e instanceof BenchRefused ? e.message : 'medição recusada');
    return 2;
  }
  let conn: Awaited<ReturnType<BenchCliDeps['connect']>> | undefined;
  try {
    conn = await d.connect(env);
    const r = await runPgBench(conn.client, opts, d.onHandle);
    d.out(JSON.stringify({ env: 'staging', origem: 'dentro da rede (worker de staging)', ...r }, null, 2));
    return r.schema_dropped ? 0 : 1;
  } catch (e) {
    // nunca ecoar a mensagem do driver (pode ter host/usuário): só tipo e código; mensagens do próprio script começam por "bench_"
    const err = e as { name?: string; code?: string; message?: string };
    const own = typeof err.message === 'string' && err.message.startsWith('bench_') ? ` — ${err.message}` : '';
    const perm = err.code === '42501' ? ' — sem permissão para criar schema no banco: peça ao DevOps (o script não escala privilégio)' : '';
    d.err(`falha: ${err.name ?? 'Error'}${err.code ? ` (${err.code})` : ''}${own}${perm}`);
    return 1;
  } finally {
    await conn?.close().catch(() => undefined);
  }
}
