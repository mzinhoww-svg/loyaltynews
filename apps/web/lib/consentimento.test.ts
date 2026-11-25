import { describe, expect, it } from 'vitest';
import {
  configGa, gravarConsentimento, lerConsentimento, mostrarBanner, podeCarregarGa, POLITICA_COOKIES_VERSAO, type Consentimento,
} from '../app/(portal)/_consentimento/regras';

const ID = 'G-3Y3YMHMLHZ';
const aceito: Consentimento = { versao: POLITICA_COOKIES_VERSAO, em: '2026-11-25T12:00:00.000Z', analiticos: true };
const base = { idGa: ID, producao: true, consentimento: aceito, sinalNaoRastrear: false };

describe('regra de carga do GA4 (LGPD)', () => {
  it('carrega só com tudo junto: ID válido, produção, aceite e sem GPC/DNT', () => {
    expect(podeCarregarGa(base)).toBe(true);
  });
  it.each([
    ['sem consentimento', { consentimento: null }],
    ['recusou', { consentimento: { ...aceito, analiticos: false } }],
    ['fora da produção (staging, vitrine, MOCK)', { producao: false }],
    ['GPC/DNT ligado', { sinalNaoRastrear: true }],
    ['sem NEXT_PUBLIC_GA_ID', { idGa: undefined }],
    ['ID em formato errado', { idGa: 'UA-123-1' }],
  ] as const)('não carrega: %s', (_n, over) => {
    expect(podeCarregarGa({ ...base, ...over })).toBe(false);
  });

  it('banner: só na produção com ID e enquanto não há escolha da versão vigente', () => {
    expect(mostrarBanner({ idGa: ID, producao: true, consentimento: null })).toBe(true);
    expect(mostrarBanner({ idGa: ID, producao: true, consentimento: aceito })).toBe(false);
    expect(mostrarBanner({ idGa: ID, producao: false, consentimento: null })).toBe(false);
    expect(mostrarBanner({ idGa: undefined, producao: true, consentimento: null })).toBe(false);
  });

  it('consentimento de versão antiga, inválido ou quebrado não vale', () => {
    expect(lerConsentimento(gravarConsentimento(true))).toMatchObject({ analiticos: true, versao: POLITICA_COOKIES_VERSAO });
    expect(lerConsentimento(JSON.stringify({ ...aceito, versao: '2020-01-01' }))).toBeNull();
    expect(lerConsentimento(JSON.stringify({ ...aceito, analiticos: 'sim' }))).toBeNull();
    expect(lerConsentimento('{quebrado')).toBeNull();
    expect(lerConsentimento(null)).toBeNull();
  });

  it('config do gtag: IP anonimizado, sem sinais de anúncio e caminho SEM query string nem âncora', () => {
    const c = configGa('/busca?q=fulano@exemplo.com#topo');
    expect(c).toMatchObject({ anonymize_ip: true, allow_google_signals: false, allow_ad_personalization_signals: false, page_path: '/busca' });
    expect(JSON.stringify(c)).not.toContain('fulano');
  });
});
