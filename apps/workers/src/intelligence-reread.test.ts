import { describe, it, expect } from 'vitest';
import { fileURLToPath } from 'node:url';
import type { Db } from '@ln/intelligence';
import { startIntelligenceReread } from './intelligence-reread';

const db = { query: async () => ({ rows: [] }) } as unknown as Db;
const SEED = fileURLToPath(new URL('../../../packages/intelligence/data/seed.public.v5.json', import.meta.url));

describe('releitura de páginas oficiais (Intelligence) no worker: desligada por padrão', () => {
  it('sem as duas chaves e o conjunto, não liga e não agenda nada', () => {
    const lines: string[] = [];
    const log = (l: string) => lines.push(l);
    expect(startIntelligenceReread({ db, env: {}, log })).toBeNull();
    expect(startIntelligenceReread({ db, env: { LN_INTELLIGENCE_REREAD: 'on' }, log })).toBeNull(); // falta a ingestão de pessoas (J-01)
    expect(startIntelligenceReread({ db, env: { LN_INTELLIGENCE_PESSOAS: 'on' }, log })).toBeNull(); // falta ligar o job
    expect(startIntelligenceReread({ db, env: { LN_INTELLIGENCE_REREAD: 'on', LN_INTELLIGENCE_PESSOAS: 'on' }, log })).toBeNull(); // falta o conjunto
    expect(lines.join('\n')).toMatch(/LN_INTELLIGENCE_PESSOAS/);
    expect(lines.join('\n')).toMatch(/LN_REREAD_SEED/);
  });

  it('com as duas chaves e o conjunto, liga (17 páginas oficiais) e o stop cancela os timers; nunca loga segredo', () => {
    const lines: string[] = [];
    const h = startIntelligenceReread({ db, env: { LN_INTELLIGENCE_REREAD: 'on', LN_INTELLIGENCE_PESSOAS: 'on', LN_REREAD_SEED: SEED, ZYTE_API_KEY: 'chave-de-teste-nao-logar' }, log: (l) => lines.push(l) });
    expect(h).not.toBeNull();
    h!.stop();
    expect(lines[0]).toMatch(/ligado: \d+ páginas, intervalo 168 h/);
    expect(lines.join('\n')).not.toContain('chave-de-teste-nao-logar');
  });
});
