import { test } from 'vitest';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertNoNetworkTools, networkTools } from '../collector/guard';
import * as pkg from '../index';

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => { const p = join(dir, n); return statSync(p).isDirectory() ? walk(p) : [p]; });
}
const SRC = walk(fileURLToPath(new URL('..', import.meta.url))).filter((p) => p.endsWith('.ts') && !p.includes('tests'));
const norm = (p: string) => p.replace(/\\/g, '/');

test('código de produção não importa SDK de provedor de modelo nem faz fetch/HTTP direto (exceto o fetcher fixado)', () => {
  const forbidden = [/from ['"](openai|@anthropic-ai\/[^'"]+|@google\/[^'"]+|ai|deepseek[^'"]*)['"]/, /\bfetch\(/, /\bXMLHttpRequest\b/, /\baxios\b/, /\bundici\b/];
  const socketModule = /node:https?['"]/;
  for (const f of SRC) {
    const t = readFileSync(f, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    for (const re of forbidden) assert.ok(!re.test(t), `${f} viola ${re}`);
    // Só collector/http-fetcher.ts abre socket HTTP, sempre via lookup fixado no IP validado.
    if (!norm(f).endsWith('collector/http-fetcher.ts')) assert.ok(!socketModule.test(t), `${f} importa módulo de socket HTTP`);
  }
  const fetcher = readFileSync(SRC.find((f) => norm(f).endsWith('collector/http-fetcher.ts'))!, 'utf8');
  assert.match(fetcher, /lookup: pinnedLookup\(/);
  assert.match(fetcher, /agent: false/);
});

test('ADR-007: perfis de modelo sem ferramenta de rede', () => {
  assert.deepEqual(networkTools(['read_evidence', 'write_draft', 'submit_claims']), []);
  assert.deepEqual(networkTools(['web_fetch', 'http_get', 'browser', 'read_evidence']).sort(), ['browser', 'http_get', 'web_fetch']);
  assert.throws(() => assertNoNetworkTools('writer_pontos', ['fetch']), /ferramenta de rede/);
});

test('flags padrão desligadas e API pública exportada', () => {
  assert.ok(Object.values(pkg.FLAG_DEFAULTS).every((v) => v === false));
  assert.equal(pkg.SIGNATURE, 'Redação Loyalty News');
  assert.equal(typeof pkg.Collector, 'function');
});
