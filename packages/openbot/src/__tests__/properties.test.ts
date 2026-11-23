import { readdirSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, test } from 'vitest';
import assert from 'node:assert/strict';
import * as pkg from '../index';

const SRC = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const sources = readdirSync(SRC)
  .filter((f) => f.endsWith('.ts'))
  .map((f) => ({ f, text: readFileSync(resolve(SRC, f), 'utf8') }));

describe('propriedades do ADR-003 verificadas no código-fonte', () => {
  test('só conexão de SAÍDA ao OpenBot: o pacote não abre servidor, porta, socket nem faz requisição de rede', () => {
    const forbidden = [/createServer\s*\(/, /\.listen\s*\(/, /\bfetch\s*\(/, /from\s+'node:(http|https|net|tls|dgram)'/, /require\(['"](http|https|net)['"]\)/, /WebSocket/];
    for (const { f, text } of sources) {
      for (const re of forbidden) assert.doesNotMatch(text, re, `${f} usa ${re}`);
    }
  });

  test('nenhum segredo, chave ou variável de ambiente é lido no pacote (segredos chegam por parâmetro, do cofre)', () => {
    for (const { f, text } of sources) {
      assert.doesNotMatch(text, /process\.env/, f);
      assert.doesNotMatch(text, /-----BEGIN [A-Z ]*PRIVATE KEY-----/, f);
      assert.doesNotMatch(text, /sk-[A-Za-z0-9]{20,}/, f);
      assert.doesNotMatch(text, /(api[_-]?key|password|senha)\s*[:=]\s*['"][^'"]{8,}['"]/i, f);
    }
  });

  test('o pacote não importa mlabs nem o publicador: o OpenBot não publica', () => {
    for (const { f, text } of sources) {
      const imports = [...text.matchAll(/(?:import|export)[^;]*?from\s+'([^']+)'/g)].map((m) => m[1] ?? '');
      for (const spec of imports) assert.doesNotMatch(spec, /@ln\/growth|mlabs|publisher/i, `${f} importa ${spec}`);
      assert.doesNotMatch(text, /\bcreatePost\b|\bPUBLISHER_SOCIAL\b|createSocialPublisher/, f);
    }
    for (const name of Object.keys(pkg)) assert.doesNotMatch(name, /publish|createPost/i, name);
  });

  test('payload de tarefa só tem IDs e limites: nenhum campo de conteúdo editorial no tipo entregue ao OpenBot', () => {
    const types = readFileSync(resolve(SRC, 'types.ts'), 'utf8');
    const leased = /export interface LeasedTask \{([\s\S]*?)\n\}/.exec(types)?.[1] ?? '';
    for (const forbidden of ['corpo', 'body', 'text', 'content', 'conteudo', 'titulo', 'title']) {
      assert.doesNotMatch(leased, new RegExp(`\\b${forbidden}\\b\\s*[:?]`), forbidden);
    }
  });

  test('a lista de despacho não contém nenhum tipo de publicação e a lista proibida os cobre', () => {
    for (const k of pkg.DISPATCHABLE_KINDS) assert.ok(!(pkg.NEVER_DISPATCH_KINDS as readonly string[]).includes(k), k);
    for (const k of ['social_publish', 'publish', 'create_post']) assert.ok((pkg.NEVER_DISPATCH_KINDS as readonly string[]).includes(k), k);
  });
});
