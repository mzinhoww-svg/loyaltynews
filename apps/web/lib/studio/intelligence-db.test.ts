import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { BancoIndisponivel, criarBanco, type FabricaDev } from './intelligence-db-core';
import { devDb as fabricaProd } from './dev-db.prod';

const fabricaFalsa: FabricaDev = async () => ({ db: { query: async () => ({ rows: [] }) }, origem: 'pglite-memoria' });

describe('banco do Entity Intelligence', () => {
  it('sem DATABASE_URL e sem opt-in de dev: indisponível, nunca inventa dados', async () => {
    await expect(criarBanco({}, fabricaFalsa)).rejects.toBeInstanceOf(BancoIndisponivel);
    await expect(criarBanco({}, null)).rejects.toBeInstanceOf(BancoIndisponivel);
  });
  it('PRODUÇÃO: a fábrica de dev é nula, então LN_STUDIO_DEV_DB=pglite é ignorada', async () => {
    expect(fabricaProd).toBeNull();
    await expect(criarBanco({ LN_STUDIO_DEV_DB: 'pglite' }, fabricaProd)).rejects.toBeInstanceOf(BancoIndisponivel);
  });
  it('dev/e2e: com a fábrica e o opt-in exato, sobe o banco temporário; valor diferente não vale', async () => {
    expect((await criarBanco({ LN_STUDIO_DEV_DB: 'pglite' }, fabricaFalsa)).origem).toBe('pglite-memoria');
    await expect(criarBanco({ LN_STUDIO_DEV_DB: '1' }, fabricaFalsa)).rejects.toBeInstanceOf(BancoIndisponivel);
  });
  it('núcleo e wrapper de produção não contêm código de banco em memória', () => {
    for (const f of ['./intelligence-db-core.ts', './intelligence-db.ts', './dev-db.prod.ts']) {
      const src = readFileSync(new URL(f, import.meta.url), 'utf8').split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');
      expect(src.includes('electric-sql'), f).toBe(false);
      expect(src.includes('new PGlite'), f).toBe(false);
    }
  });
});
