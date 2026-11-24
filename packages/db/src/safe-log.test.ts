import { spawnSync } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildSync } from 'esbuild';
import pg from 'pg';
import { afterAll, describe, expect, it } from 'vitest';
import { errLine, installOutputFilter, installProcessGuards, onClientError, safeErr, sanitizeOutput, sanitizeText } from './safe-log';

// Incidente de 23/11/2026 (decisão de segurança 17, C1–C5): a chave privada do certificado de cliente saiu no log do worker. Nenhum erro, de nenhum caminho, pode
// levar o objeto de erro (com `_tlsOptions`/`options`/`cause`) ao log.
const KEY = '-----BEGIN PRIVATE KEY-----\nMIIEvQIBADANBgkqhkiG9w0BAQEFAASCBKcwggSjAgEAAoIBAQC7\nSEGREDODECHAVEQUENUNCADEVESAIR\n-----END PRIVATE KEY-----\n';

/** Erro como o do socket TLS do pg/ioredis: o objeto carrega as opções do TLS inteiras. */
function erroHostil(): Error {
  const e = new Error(`connect ECONNRESET postgres:` + `//app:senha-do-banco@db.interno.invalid:5432/ln key=${KEY}`) as Error & Record<string, unknown>;
  e.code = 'ECONNRESET';
  e.options = { ca: KEY, cert: KEY, key: KEY, servername: 'db.interno.invalid', singleUse: true, session: Buffer.from('s') };
  e.socket = { _tlsOptions: { key: KEY, ca: KEY, cert: KEY } };
  e.cause = new Error(`causa com ${KEY}`);
  return e;
}
const vazou = (t: string) => /PRIVATE KEY|BEGIN |END |SEGREDODECHAVE|senha-do-banco|MIIEvQ/.test(t);

describe('C3: safeErr / sanitizeText', () => {
  it('só {name, code, message}; PEM vira [PEM REMOVIDO]; credencial de URL vira ***; nunca o objeto, options, socket nem cause', () => {
    const s = safeErr(erroHostil());
    expect(Object.keys(s).sort()).toEqual(['code', 'message', 'name']);
    expect(s).toMatchObject({ name: 'Error', code: 'ECONNRESET' });
    expect(s.message).toContain('postgres://***@db.interno.invalid:5432/ln');
    expect(s.message).toContain('[PEM REMOVIDO]');
    expect(vazou(JSON.stringify(s))).toBe(false);
    expect(errLine('[x] falha', erroHostil())).toMatch(/^\[x\] falha: Error \[ECONNRESET\] /);
    expect(vazou(errLine('[x] falha', erroHostil()))).toBe(false);
  });

  it('aceita qualquer valor lançado (texto, objeto qualquer, null, getter hostil) sem vazar e sem lançar', () => {
    expect(safeErr(`texto com ${KEY}`).message.trim()).toBe('texto com [PEM REMOVIDO]');
    expect(vazou(JSON.stringify(safeErr({ message: KEY, name: KEY, code: KEY })))).toBe(false);
    expect(safeErr(null).message).toBe('null');
    expect(safeErr(undefined).name).toBe('Error');
    const hostil = Object.defineProperty({}, 'message', { get() { throw new Error(KEY); } });
    expect(safeErr(hostil)).toEqual({ name: 'Error', code: null, message: 'erro ilegível' });
    expect(safeErr(new Error('x'.repeat(5000))).message.length).toBe(500);
  });

  it('PEM truncado (sem END), cabeçalho solto, PEM partido pelo util.inspect e credencial de redis:// e https://', () => {
    expect(sanitizeText('a -----BEGIN CERTIFICATE-----\nMIIB')).toBe('a [PEM REMOVIDO]');
    expect(sanitizeText('so o fim -----END PRIVATE KEY-----')).toBe('so o fim [PEM REMOVIDO]');
    expect(vazou(sanitizeText("key: '-----BEGIN PRIVATE KEY-----\\n' +\n    'MIIEvQ\\n' +\n    '-----END PRIVATE KEY-----\\n',"))).toBe(false);
    expect(sanitizeText('redis:' + '//default:segredo@redis.invalid:6379 e https://u:p@x.invalid/a')).toBe('redis://***@redis.invalid:6379 e https://***@x.invalid/a');
    expect(sanitizeText('https://exemplo.invalid/caminho@sem-credencial')).toBe('https://exemplo.invalid/caminho@sem-credencial');
  });
});

describe('C1: ouvinte de erro no Pool do pg e no cliente Redis', () => {
  it('Pool real do pg: o erro emitido com o objeto do TLS só chega ao log como safeErr', () => {
    const linhas: string[] = [];
    const pool = new pg.Pool({ host: '127.0.0.1', port: 1, max: 1 });
    pool.on('error', onClientError('[pg] conexão ociosa', (l) => linhas.push(l)));
    pool.emit('error', erroHostil());
    expect(linhas).toHaveLength(1);
    expect(vazou(linhas.join('\n'))).toBe(false);
    expect(linhas[0]).toMatch(/ECONNRESET/);
    void pool.end();
  });

  it('cliente estilo ioredis (EventEmitter): idem; e SEM ouvinte o EventEmitter lança o erro inteiro (o que o incidente mostrou)', () => {
    const linhas: string[] = [];
    const redis = new EventEmitter();
    expect(() => redis.emit('error', erroHostil())).toThrow(); // sem ouvinte: a exceção carrega o objeto até o util.inspect do Node
    redis.on('error', onClientError('[redis]', (l) => linhas.push(l)));
    expect(() => redis.emit('error', erroHostil())).not.toThrow();
    expect(vazou(linhas.join('\n'))).toBe(false);
  });
});

describe('C2: guardas de unhandledRejection e uncaughtException', () => {
  it('rejeição e exceção: log saneado e saída com código 1; remover os ouvintes funciona', () => {
    const alvo = new EventEmitter() as unknown as Pick<NodeJS.Process, 'on' | 'off'> & EventEmitter;
    const linhas: string[] = [];
    const saidas: number[] = [];
    const remover = installProcessGuards({ log: (l) => linhas.push(l), exit: (c) => saidas.push(c), target: alvo });
    alvo.emit('unhandledRejection', erroHostil());
    alvo.emit('uncaughtException', erroHostil());
    expect(saidas).toEqual([1, 1]);
    expect(linhas).toHaveLength(2);
    expect(linhas[0]).toContain('promessa rejeitada sem tratamento');
    expect(linhas[1]).toContain('exceção sem tratamento');
    expect(vazou(linhas.join('\n'))).toBe(false);
    remover();
    expect(alvo.listenerCount('unhandledRejection') + alvo.listenerCount('uncaughtException')).toBe(0);
  });
});

describe('C4: filtro de PEM em stdout/stderr', () => {
  it('remove blocos PEM (e credencial de URL) de qualquer escrita, inclusive Buffer; o resto passa igual; restaura os originais', () => {
    const escritas: string[] = [];
    const fake = { write: (c: unknown) => { escritas.push(typeof c === 'string' ? c : Buffer.from(c as Uint8Array).toString('utf8')); return true; } };
    const original = fake.write;
    const restaurar = installOutputFilter([fake]);
    fake.write(`linha normal\n${KEY}`);
    fake.write(Buffer.from(`buffer ${KEY}`));
    fake.write('conexão redis:' + '//default:senha@r.invalid:6379 ok');
    fake.write('nada a esconder (https://exemplo.invalid/a)');
    expect(escritas[0]!.trim()).toBe('linha normal\n[PEM REMOVIDO]');
    expect(vazou(escritas.join('\n'))).toBe(false);
    expect(escritas[2]).toBe('conexão redis://***@r.invalid:6379 ok');
    expect(escritas[3]).toBe('nada a esconder (https://exemplo.invalid/a)');
    restaurar();
    expect(fake.write).toBe(original);
    expect(sanitizeOutput('sem marcador')).toBe('sem marcador');
  });
});

describe('C5 ponta a ponta: processo real com erro hostil e rejeição não tratada', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ln-safelog-'));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it('console.error(err) (o util.inspect do Node), erro de conexão sem ouvinte tratado e unhandledRejection: stdout+stderr SEM "PRIVATE KEY" e saída ≠ 0', () => {
    const entrada = join(dir, 'entrada.ts');
    const modulo = fileURLToPath(new URL('./safe-log.ts', import.meta.url)).split(sep).join('/');
    writeFileSync(entrada, `
import { installOutputFilter, installProcessGuards } from '${modulo}';
installOutputFilter();
installProcessGuards();
const KEY = ${JSON.stringify(KEY)};
const e: any = new Error('connect ECONNRESET postgres:' + '//app:senha-do-banco@db.interno.invalid/ln');
e.code = 'ECONNRESET';
e.options = { ca: KEY, cert: KEY, key: KEY, servername: 'db.interno.invalid', singleUse: true };
e.socket = { _tlsOptions: { key: KEY } };
console.error(e); // o jeito errado: o Node imprime o objeto inteiro com util.inspect; o filtro de saída tem de segurar
console.log('opções:', e.options);
Promise.reject(e); // rejeição sem tratamento: sai com 1
setTimeout(() => console.log('NAO DEVIA CHEGAR AQUI'), 2000);
`);
    const saida = join(dir, 'saida.mjs');
    buildSync({ entryPoints: [entrada], outfile: saida, bundle: true, platform: 'node', format: 'esm', logLevel: 'silent' });
    const r = spawnSync(process.execPath, [saida], { encoding: 'utf8', timeout: 20_000 });
    const tudo = `${r.stdout}\n${r.stderr}`;
    expect(vazou(tudo), tudo).toBe(false);
    expect(r.status).not.toBe(0);
    expect(tudo).not.toContain('NAO DEVIA CHEGAR AQUI');
    expect(tudo).toContain('[PEM REMOVIDO]'); // o filtro agiu (o log foi mantido, sem o segredo)
  });
});

describe('C1 estático: todo cliente de produção registra ouvinte de erro no mesmo arquivo', () => {
  const RAIZ = fileURLToPath(new URL('../../../', import.meta.url));
  const IGNORAR = /node_modules|[\\/]dist[\\/]|[\\/]\.next|\.test\.|\.real\.|[\\/]tests?[\\/]|[\\/]e2e[\\/]|testing\.ts$|\.mock\.|[\\/]fixtures[\\/]|[\\/]showcase[\\/]/;
  const arquivos = (dir: string, out: string[] = []): string[] => {
    for (const f of readdirSync(dir)) {
      const p = join(dir, f);
      if (IGNORAR.test(p)) continue;
      if (statSync(p).isDirectory()) arquivos(p, out);
      else if (/\.(ts|tsx)$/.test(f)) out.push(p);
    }
    return out;
  };
  it('new Pool(, new Client(, new IORedis(, new Worker( e new Queue( em código de produção vêm com .on(\'error\'', () => {
    const cria = /new (?:pg\.)?(?:Pool|Client)\(|new IORedis\(|new Worker\(|new Queue\(/;
    const sem: string[] = [];
    for (const base of ['apps/web', 'apps/workers/src', 'packages/auth/src', 'packages/db/src', 'packages/modelops/src', 'packages/intelligence/src', 'packages/agents/src']) {
      for (const f of arquivos(join(RAIZ, base))) {
        const t = readFileSync(f, 'utf8');
        const codigo = t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, ''); // comentários não contam (a documentação cita new Pool)
        if (cria.test(codigo) && !/\.on\(\s*'error'/.test(codigo)) sem.push(relative(RAIZ, f));
      }
    }
    expect(sem, `arquivos que criam cliente sem ouvinte de 'error'`).toEqual([]);
  });
});
