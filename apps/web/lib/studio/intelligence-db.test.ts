import { afterEach, describe, expect, it } from 'vitest';
import { BancoIndisponivel, bancoIntelligence, bancoOuNulo } from './intelligence-db';

const antes = { url: process.env.DATABASE_URL, dev: process.env.LN_STUDIO_DEV_DB };
afterEach(() => {
  if (antes.url === undefined) delete process.env.DATABASE_URL;
  else process.env.DATABASE_URL = antes.url;
  if (antes.dev === undefined) delete process.env.LN_STUDIO_DEV_DB;
  else process.env.LN_STUDIO_DEV_DB = antes.dev;
});

describe('banco do Entity Intelligence', () => {
  it('sem DATABASE_URL e sem opt-in de dev: indisponível, nunca inventa dados nem sobe banco em memória', async () => {
    delete process.env.DATABASE_URL;
    delete process.env.LN_STUDIO_DEV_DB;
    await expect(bancoIntelligence()).rejects.toBeInstanceOf(BancoIndisponivel);
    expect(await bancoOuNulo()).toBeNull();
  });
});
