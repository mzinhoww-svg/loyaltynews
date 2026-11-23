import { readdirSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, test } from 'vitest';
import assert from 'node:assert/strict';
import * as pkg from '../index';

// Propriedades de privacidade verificadas no CÓDIGO-FONTE (sem comentários): o protótipo não usa cookie, armazenamento do
// navegador, fingerprint, rede, nem lê IP, cabeçalhos ou user agent. É uma rede de segurança contra regressão, não a prova
// de conformidade com a LGPD (essa depende do parecer jurídico).

const SRC = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const strip = (t: string) => t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
const sources = readdirSync(SRC).filter((f) => f.endsWith('.ts')).map((f) => ({ f, text: strip(readFileSync(resolve(SRC, f), 'utf8')) }));

describe('o protótipo não identifica ninguém nem fala com terceiros', () => {
  test('sem cookie, localStorage, sessionStorage, indexedDB, fingerprint ou canvas', () => {
    const bad = [/document\.cookie/, /\bSet-Cookie\b/i, /localStorage/, /sessionStorage/, /indexedDB/, /fingerprint/i, /getContext\s*\(/, /AudioContext/];
    for (const { f, text } of sources) for (const re of bad) assert.doesNotMatch(text, re, `${f}: ${re}`);
  });

  test('sem rede: nenhum fetch, XHR, sendBeacon, WebSocket, http/net nem import de biblioteca de analytics de terceiros', () => {
    const bad = [/\bfetch\s*\(/, /XMLHttpRequest/, /sendBeacon\s*\(/, /WebSocket/, /from\s+'node:(http|https|net|tls|dgram)'/, /google-analytics|gtag|googletagmanager|analytics\.google|plausible|matomo|umami|segment\.(?:com|io)|api\.segment|mixpanel|hotjar|clarity\.ms/i];
    for (const { f, text } of sources) for (const re of bad) assert.doesNotMatch(text, re, `${f}: ${re}`);
  });

  test('não lê IP, cabeçalhos, user agent nem variáveis de ambiente', () => {
    const bad = [/remoteAddress/, /x-forwarded-for/i, /\buser-?agent\b/i, /req\.headers/, /process\.env/, /navigator\./];
    for (const { f, text } of sources) for (const re of bad) assert.doesNotMatch(text, re, `${f}: ${re}`);
  });

  test('nenhum identificador persistente: sem UUID aleatório, sem hash de IP/dispositivo, sem salt', () => {
    const bad = [/randomUUID/, /createHash/, /createHmac/, /randomBytes/, /\bsalt\b/i, /Math\.random/];
    for (const { f, text } of sources) for (const re of bad) assert.doesNotMatch(text, re, `${f}: ${re}`);
  });

  test('a única unidade persistida é a linha agregada (dia, caminho, origem, dispositivo, contagem)', () => {
    const agg = readFileSync(resolve(SRC, 'aggregate.ts'), 'utf8');
    const bucket = /export interface Bucket \{([\s\S]*?)\n\}/.exec(agg)?.[1] ?? '';
    const fields = [...bucket.matchAll(/^\s*(\w+):/gm)].map((m) => m[1]).sort();
    assert.deepEqual(fields, ['day', 'device', 'path', 'ref']);
  });

  test('só as quatro categorias fechadas de origem e as quatro classes de dispositivo existem', () => {
    assert.deepEqual([...pkg.REFERRER_CATEGORIES], ['direto', 'busca', 'social', 'interno', 'outro']);
    assert.deepEqual([...pkg.DEVICE_CLASSES], ['mobile', 'tablet', 'desktop', 'desconhecido']);
  });

  test('o schema de coleta é estrito e tem exatamente 4 campos', () => {
    assert.deepEqual(Object.keys(pkg.CollectEventSchema.shape).sort(), ['path', 'ref', 't', 'w']);
  });
});
