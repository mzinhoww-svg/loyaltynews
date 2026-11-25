// Teste de fronteira da política de filas (ADR-002).
// A web pode ler a decisão de fila, mas o módulo importado não pode puxar BullMQ, ioredis
// nem pg — direto ou transitivamente. Hoje a web importa @ln/workers/queues; depois da
// migração, @ln/contracts/queues. Se este teste falhar, a política voltou a depender de
// runtime de worker. Roda no projeto `node` do vitest (npm test / bateria), não só local.
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, posix, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const WEB = join(ROOT, 'apps/web');
const POLICY_SPECIFIERS = ['@ln/workers/queues', '@ln/contracts/queues'];
const FORBIDDEN = ['bullmq', 'ioredis', 'pg'];
const SKIP_DIRS = new Set([
  'node_modules', '.git', '.next', '.next-e2e', '.next-e2e-vitrine', '.test-results', 'test-results', 'e2e',
]);

function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
}

/** Especificadores importados/reexportados (estático, efeito colateral e dinâmico). */
export function importsOf(src: string): string[] {
  const clean = stripComments(src);
  const out = new Set<string>();
  for (const m of clean.matchAll(/\bfrom\s*['"]([^'"]+)['"]/g)) out.add(m[1]!);
  for (const m of clean.matchAll(/\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g)) out.add(m[1]!);
  for (const m of clean.matchAll(/(?:^|\n)\s*import\s*['"]([^'"]+)['"]/g)) out.add(m[1]!);
  return [...out];
}

function resolveRelative(fromFile: string, spec: string): string | null {
  const base = resolve(join(fromFile, '..'), spec);
  const tries = [
    base, `${base}.ts`, `${base}.tsx`, `${base}.mts`, `${base}.cts`,
    `${base}.js`, `${base}.mjs`, `${base}.cjs`, join(base, 'index.ts'), join(base, 'index.tsx'),
  ];
  return tries.find((p) => existsSync(p) && statSync(p).isFile()) ?? null;
}

/** Resolve um subpath @ln/<pacote>/<sub> pelo `exports` do package.json. */
function resolvePackage(spec: string): string | null {
  const m = spec.match(/^@ln\/([^/]+)(?:\/(.+))?$/);
  if (!m) return null;
  const [, name, sub] = m;
  if (!name) return null;
  const base = existsSync(join(ROOT, 'apps', name)) ? join(ROOT, 'apps', name) : join(ROOT, 'packages', name);
  const pkgPath = join(base, 'package.json');
  if (!existsSync(pkgPath)) return null;
  const pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) as {
    exports?: Record<string, string | { import?: string; default?: string }>;
  };
  const entry = pkg.exports?.[sub ? `./${sub}` : '.'];
  const rel = typeof entry === 'string' ? entry : entry?.import ?? entry?.default;
  if (!rel) return null;
  const abs = resolve(base, rel);
  return existsSync(abs) ? abs : null;
}

export interface Violation { spec: string; chain: string[] }

/** Caminha o grafo a partir de `entry` e devolve onde um pacote proibido aparece. */
export function forbiddenInGraph(
  entry: string,
  read: (file: string) => string | null,
  resolveSpec: (from: string, spec: string) => string | null,
): Violation[] {
  const seen = new Set<string>();
  const out: Violation[] = [];
  const visit = (file: string, chain: string[]) => {
    if (seen.has(file)) return;
    seen.add(file);
    const src = read(file);
    if (src === null) return;
    for (const spec of importsOf(src)) {
      if (FORBIDDEN.some((f) => spec === f || spec.startsWith(`${f}/`))) {
        out.push({ spec, chain: [...chain, file] });
        continue;
      }
      const next = resolveSpec(file, spec);
      if (next) visit(next, [...chain, file]);
    }
  };
  visit(entry, []);
  return out;
}

function webFiles(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (SKIP_DIRS.has(name)) continue;
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) webFiles(p, out);
    else if (/\.(ts|tsx|mts|cts)$/.test(name)) out.push(p);
  }
  return out;
}

describe('fronteira da política de filas', () => {
  it('o módulo de filas que a web importa não puxa BullMQ, ioredis nem pg', () => {
    const importers: string[] = [];
    for (const file of webFiles(WEB)) {
      const src = readFileSync(file, 'utf8');
      if (POLICY_SPECIFIERS.some((s) => importsOf(src).includes(s))) importers.push(file);
    }
    expect(
      importers.length,
      'a web não importa a política de filas: atualize este teste ou o import (a política deve vir de @ln/contracts/queues)',
    ).toBeGreaterThan(0);

    const entries = new Set<string>();
    for (const file of importers) {
      for (const spec of importsOf(readFileSync(file, 'utf8')).filter((s) => POLICY_SPECIFIERS.includes(s))) {
        const entry = resolvePackage(spec);
        expect(entry, `não resolvi ${spec} (confira o exports do package.json)`).not.toBeNull();
        if (entry) entries.add(entry);
      }
    }
    expect(entries.size).toBeGreaterThan(0);

    const read = (f: string) => (existsSync(f) ? readFileSync(f, 'utf8') : null);
    const resolveSpec = (from: string, spec: string) => (spec.startsWith('.') ? resolveRelative(from, spec) : resolvePackage(spec));
    const violations: Violation[] = [];
    for (const entry of entries) violations.push(...forbiddenInGraph(entry, read, resolveSpec));

    expect(
      violations,
      `fronteira quebrada: ${violations.map((v) => `${v.spec} em ${v.chain.join(' -> ')}`).join('; ')}`,
    ).toEqual([]);
  });

  it('o detector reprova bullmq, ioredis e pg, direto e transitivo (controle negativo)', () => {
    const files = new Map<string, string>([
      ['/e/entry.ts', "import { x } from './helper';\nimport 'pg';"],
      ['/e/helper.ts', "import { Queue } from 'bullmq';\nimport Redis from 'ioredis';"],
    ]);
    const read = (f: string) => files.get(f) ?? null;
    const resolveSpec = (from: string, spec: string) => {
      if (!spec.startsWith('.')) return null;
      const p = `${posix.resolve(posix.join(from, '..'), spec)}.ts`;
      return files.has(p) ? p : null;
    };
    const found = forbiddenInGraph('/e/entry.ts', read, resolveSpec).map((v) => v.spec).sort();
    expect(found).toEqual(['bullmq', 'ioredis', 'pg']);
  });
});
