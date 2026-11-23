import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import config from '../next.config';

// apps/web/lib -> raiz do monorepo
const raizEsperada = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

const salvo = { HOME: process.env.HOME, USERPROFILE: process.env.USERPROFILE, cwd: process.cwd() };
afterEach(() => {
  for (const k of ['HOME', 'USERPROFILE'] as const) {
    if (salvo[k] === undefined) delete process.env[k];
    else process.env[k] = salvo[k];
  }
  process.chdir(salvo.cwd);
});

describe('next.config: raiz do monorepo explícita (incidente do build na Vertra, 22/11/2026)', () => {
  it('a raiz esperada é a do monorepo (package.json com workspaces e apps/web dentro)', () => {
    const pkg = JSON.parse(readFileSync(path.join(raizEsperada, 'package.json'), 'utf8')) as { workspaces?: string[] };
    expect(pkg.workspaces).toBeTruthy();
    expect(existsSync(path.join(raizEsperada, 'apps', 'web', 'next.config.ts'))).toBe(true);
  });

  it('turbopack.root e outputFileTracingRoot apontam para a raiz do monorepo', () => {
    const c = config('phase-production-build');
    expect(c.turbopack?.root).toBe(raizEsperada);
    expect(c.outputFileTracingRoot).toBe(raizEsperada);
  });

  it('com HOME/USERPROFILE DENTRO da pasta do app (como na Vertra) a raiz continua a mesma', () => {
    const homeDentro = path.join(raizEsperada, '.cache', 'vertra', 'tmp', 'build', 'home');
    process.env.HOME = homeDentro;
    process.env.USERPROFILE = homeDentro;
    const c = config('phase-production-build');
    expect(c.turbopack?.root).toBe(raizEsperada);
    expect(c.outputFileTracingRoot).toBe(raizEsperada);
  });

  it('não depende do diretório de trabalho (npm -w roda em apps/web; o CI roda na raiz)', () => {
    process.chdir(path.join(raizEsperada, 'apps', 'web'));
    const a = config('phase-production-build');
    process.chdir(raizEsperada);
    const b = config('phase-production-build');
    expect(a.turbopack?.root).toBe(b.turbopack?.root);
    expect(a.turbopack?.root).toBe(raizEsperada);
  });
});
