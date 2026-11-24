import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
// @ts-expect-error -- script .mjs sem tipos
import { freePort, parseArgs, refusedStartProbe, startFromRoot } from '../scripts/start-raiz.mjs';

// Regressão do início pela raiz (linha 7, 24/11): `next start apps/web` com cwd = raiz do monorepo tem de responder /api/health 200.
// A parte que sobe o servidor exige o build (apps/web/.next) e roda com LN_START_RAIZ=1 (bateria da int/020); o resto roda sempre.
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');

describe('start-raiz: utilitários', () => {
  it('porta livre escolhida pelo sistema, nunca fixa; duas chamadas podem dar portas diferentes', async () => {
    const a = await freePort();
    expect(a).toBeGreaterThan(0);
    expect(a).toBeLessThan(65536);
  });
  it('tempo-limite explícito: padrão 90 s; valor inválido é recusado', () => {
    expect(parseArgs([]).timeout).toBe(90);
    expect(parseArgs(['--timeout', '30']).timeout).toBe(30);
    expect(() => parseArgs(['--timeout', '0'])).toThrow(/timeout/);
    expect(() => parseArgs(['--timeout', 'x'])).toThrow(/timeout/);
  });
  it('sem build: código 2 com motivo, sem subir nada', async () => {
    const r = await startFromRoot({ root: join(ROOT, 'nao-existe'), timeout: 5 });
    expect(r).toMatchObject({ ok: false, code: 2 });
    expect(r.motivo).toMatch(/sem build/);
  });
});

describe.skipIf(process.env.LN_START_RAIZ !== '1' || !existsSync(join(ROOT, 'apps/web/.next/BUILD_ID')))('start-raiz: next start apps/web pela raiz', () => {
  it('responde /api/health 200 dentro do prazo', async () => {
    const r = await startFromRoot({ root: ROOT, timeout: Number(process.env.LN_START_RAIZ_TIMEOUT ?? 90) });
    expect(r.motivo).toBe('health 200');
    expect(r.ok).toBe(true);
  }, 150_000);
});

describe.skipIf(process.env.LN_START_RAIZ !== '1' || !existsSync(join(ROOT, 'apps/web/.next/BUILD_ID')))('subida recusada (ADR-022, achado do QA 8)', () => {
  it('produção + LN_FLAGS_ON=intelligencePessoas: nenhum 200 em momento algum (consulta desde o segundo 0) e saída 1', async () => {
    const r = await refusedStartProbe({
      root: ROOT,
      env: { APP_ENV: 'production', LN_FLAGS_ON: 'intelligencePessoas', NEXT_PUBLIC_SITE_URL: 'https://loyaltynews.example.invalid' },
      timeout: 60,
    });
    expect(r.vistos['200'] ?? 0).toBe(0);
    expect(r.exitCode).toBe(1);
    expect(r.ultimas.join(' | ')).toMatch(/Subida recusada: flag intelligencePessoas sem decisão para production \(ADR-022\)/);
  }, 90_000);
});
