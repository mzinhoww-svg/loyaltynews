import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { assertNoNetworkTools, networkTools } from '../src/collector/guard.ts';
import * as pkg from '../src/index.ts';

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => { const p = join(dir, n); return statSync(p).isDirectory() ? walk(p) : [p]; });
}
const SRC = walk(new URL('../src', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')).filter((p) => p.endsWith('.ts'));

test('código de produção não importa SDK de provedor de modelo nem faz fetch/HTTP direto', () => {
  const forbidden = [/from ['"](openai|@anthropic-ai\/[^'"]+|@google\/[^'"]+|ai|deepseek[^'"]*)['"]/, /\bfetch\(/, /node:https?['"]/, /\bXMLHttpRequest\b/, /\baxios\b/];
  for (const f of SRC) {
    const t = readFileSync(f, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    for (const re of forbidden) assert.ok(!re.test(t), `${f} viola ${re}`);
  }
});

test('ADR-007: perfis de modelo sem ferramenta de rede', () => {
  assert.deepEqual(networkTools(['read_evidence', 'write_draft', 'submit_claims']), []);
  assert.deepEqual(networkTools(['web_fetch', 'http_get', 'browser', 'read_evidence']).sort(), ['browser', 'http_get', 'web_fetch']);
  assert.throws(() => assertNoNetworkTools('writer_pontos', ['fetch']), /ferramenta de rede/);
});

test('flags padrão desligadas e API pública exportada', () => {
  assert.ok(Object.values(pkg.DEFAULT_FLAGS).every((v) => v === false));
  assert.equal(pkg.SIGNATURE, 'Redação Loyalty News');
  assert.equal(typeof pkg.Collector, 'function');
});
