import { describe, it, expect } from 'vitest';
import { fileURLToPath } from 'node:url';
import type { Db } from '@ln/intelligence';
import { startIntelligenceReread } from './intelligence-reread';

const db = { query: async () => ({ rows: [] }) } as unknown as Db;
const SEED = fileURLToPath(new URL('../../../packages/intelligence/data/seed.public.v5.json', import.meta.url));
const ALL_ON = () => true;

describe('releitura de páginas oficiais (Intelligence) no worker: desligada por padrão', () => {
  it('sem a chave do job, sem a flag intelligencePessoas (resolvedor) ou sem o conjunto, não liga e não agenda nada', () => {
    const lines: string[] = [];
    const log = (l: string) => lines.push(l);
    expect(startIntelligenceReread({ db, env: {}, log })).toBeNull();
    expect(startIntelligenceReread({ db, env: { LN_INTELLIGENCE_REREAD: 'on' }, log })).toBeNull(); // sem resolvedor: toda flag desligada
    expect(startIntelligenceReread({ db, env: { LN_INTELLIGENCE_REREAD: 'on' }, flags: () => false, log })).toBeNull();
    expect(startIntelligenceReread({ db, env: { LN_INTELLIGENCE_REREAD: 'on' }, flags: () => { throw new Error('flags indisponíveis'); }, log })).toBeNull(); // falha fechada
    expect(startIntelligenceReread({ db, env: {}, flags: ALL_ON, log })).toBeNull(); // flag ligada, mas o job não foi ligado
    expect(startIntelligenceReread({ db, env: { LN_INTELLIGENCE_REREAD: 'on' }, flags: ALL_ON, log })).toBeNull(); // falta o conjunto
    expect(lines.join('\n')).toMatch(/intelligencePessoas desligada/);
    expect(lines.join('\n')).toMatch(/LN_REREAD_SEED/);
  });

  it('a flag NÃO é lida de variável de ambiente própria: LN_INTELLIGENCE_PESSOAS=on não liga nada (ADR-022)', () => {
    const h = startIntelligenceReread({ db, env: { LN_INTELLIGENCE_REREAD: 'on', LN_INTELLIGENCE_PESSOAS: 'on', LN_FLAGS_ON: 'intelligencePessoas', LN_REREAD_SEED: SEED }, log: () => undefined });
    expect(h).toBeNull();
  });

  it('com a chave do job, a flag pelo resolvedor e o conjunto, liga (17 páginas oficiais) e o stop cancela os timers; nunca loga segredo', () => {
    const lines: string[] = [];
    const secret = 'sk-' + 'Q'.repeat(32);
    const h = startIntelligenceReread({ db, env: { LN_INTELLIGENCE_REREAD: 'on', LN_REREAD_SEED: SEED, BRIGHTDATA_API_KEY: secret }, flags: ALL_ON, log: (l) => lines.push(l) });
    expect(h).not.toBeNull();
    h!.stop();
    expect(lines[0]).toMatch(/ligado: \d+ páginas, intervalo 168 h/);
    expect(lines.join('\n')).not.toContain(secret);
  });
});
