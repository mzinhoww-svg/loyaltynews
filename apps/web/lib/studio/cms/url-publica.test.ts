import { describe, expect, it } from 'vitest';
import { urlPublicaDaMateria } from './url-publica';

describe('urlPublicaDaMateria', () => {
  it('base do Portal + /noticia/ + slug, sem barra dupla', () => {
    expect(urlPublicaDaMateria('banco-beta', { PORTAL_BASE_URL: 'https://portal.example.test/' })).toBe('https://portal.example.test/noticia/banco-beta');
    expect(urlPublicaDaMateria('banco-beta', { NEXT_PUBLIC_SITE_URL: 'https://portal.example.test' })).toBe('https://portal.example.test/noticia/banco-beta');
  });
  it('PORTAL_BASE_URL vale sobre NEXT_PUBLIC_SITE_URL', () => {
    expect(urlPublicaDaMateria('a-b', { PORTAL_BASE_URL: 'https://um.test', NEXT_PUBLIC_SITE_URL: 'https://dois.test' })).toBe('https://um.test/noticia/a-b');
  });
  it('sem base ou com slug fora do padrão devolve vazio (a tela deixa editar)', () => {
    expect(urlPublicaDaMateria('banco-beta', {})).toBe('');
    expect(urlPublicaDaMateria('Slug Inválido!', { PORTAL_BASE_URL: 'https://portal.example.test' })).toBe('');
  });
});
