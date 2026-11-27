import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { assinaturaExibida, ehConteudoDemo, emDemonstracao, type AmbienteDemo } from '../app/(portal)/_lib/demo';

const base: AmbienteDemo = { appEnv: 'production', nodeEnv: 'production', portalDemo: '0', mock: false };

describe('assinatura institucional em conteúdo de demonstração', () => {
  const autor = 'Redação Loyalty News';
  const real = { title: 'Programa muda regra de pontos', authorLabel: autor };

  it('fixture MOCK e matéria com o rótulo do seed saem marcadas, com a marca na frente', () => {
    for (const a of [{ ...real, mock: true }, { ...real, title: '[DEMO · staging] Programa fictício' }, { ...real, title: ' [demo] x' }]) {
      expect(ehConteudoDemo(a), a.title).toBe(true);
      expect(assinaturaExibida(a)).toBe(`Demonstração: ${autor}`);
    }
  });

  it('controle negativo: conteúdo real não muda, mesmo falando de demonstração', () => {
    for (const title of [real.title, 'Demo day de fidelidade reúne programas', 'Empresa anuncia [DEMO] de produto', '[Atualizado] Regra muda', '[DEMOGRAFIA] Estudo', '[Demo day] Agenda']) {
      for (const mock of [undefined, false]) expect(assinaturaExibida({ ...real, title, mock }), title).toBe(autor);
    }
  });

  it('o rótulo reconhecido é o mesmo que o seed de staging grava', () => {
    const seed = readFileSync(new URL('../../workers/src/seed-staging.ts', import.meta.url), 'utf8');
    const rotulo = /SEED_LABEL = '([^']+)'/.exec(seed)![1]!;
    expect(ehConteudoDemo({ title: `${rotulo} qualquer título` })).toBe(true);
  });
});

describe('faixa de demonstração por ambiente', () => {
  it('staging com fonte api + seed mostra a faixa (o defeito do G1)', () => {
    expect(emDemonstracao({ ...base, appEnv: 'staging', mock: false })).toBe(true);
  });

  it('staging com fonte mock também mostra', () => {
    expect(emDemonstracao({ ...base, appEnv: 'staging', mock: true })).toBe(true);
  });

  it('produção não mostra, nem com fonte mock', () => {
    expect(emDemonstracao({ ...base, appEnv: 'production', mock: false })).toBe(false);
    expect(emDemonstracao({ ...base, appEnv: 'production', mock: true })).toBe(false);
  });

  it('vitrine de staging (constante de build) mostra; dev com mock mostra; dev com api não', () => {
    expect(emDemonstracao({ ...base, nodeEnv: 'production', portalDemo: '1', mock: true })).toBe(true);
    expect(emDemonstracao({ ...base, nodeEnv: 'development', mock: true })).toBe(true);
    expect(emDemonstracao({ ...base, nodeEnv: 'development', mock: false })).toBe(false);
  });

  it('controle negativo: a regra antiga (só mock) não veria o staging com api', () => {
    const antiga = (a: typeof base) => (a.nodeEnv !== 'production' || a.portalDemo === '1') && a.mock;
    expect(antiga({ ...base, appEnv: 'staging', mock: false })).toBe(false);
    expect(emDemonstracao({ ...base, appEnv: 'staging', mock: false })).toBe(true);
  });
});
