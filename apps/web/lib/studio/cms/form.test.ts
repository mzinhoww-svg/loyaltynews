import { describe, expect, it } from 'vitest';
import { parseVersionForm } from './form';

describe('parseVersionForm', () => {
  it('descarta fontes vazias e monta imagem só quando preenchida', () => {
    const fd = new FormData();
    fd.set('titulo', '  Título ');
    fd.set('corpo', 'Corpo');
    fd.set('editoria', 'mercado');
    fd.set('fonte_nome_0', 'A');
    fd.set('fonte_url_0', 'https://a.com');
    fd.set('fonte_nome_3', '');
    fd.set('fonte_url_3', '');
    const v = parseVersionForm(fd);
    expect(v.titulo).toBe('Título');
    expect(v.fontes).toEqual([{ nome: 'A', url: 'https://a.com' }]);
    expect(v.imagem).toBeUndefined();
    expect(v.patrocinado).toBe(false);
  });
  it('lê imagem, base de direito e patrocinado', () => {
    const fd = new FormData();
    fd.set('titulo', 'T');
    fd.set('img_url', 'https://x.com/i.jpg');
    fd.set('img_origem', 'fonte_terceiro');
    fd.set('img_credito', 'Agência');
    fd.set('img_base', 'licenca');
    fd.set('img_alt', 'Alt');
    fd.set('img_link', 'https://x.com');
    fd.set('patrocinado', 'on');
    fd.set('rotulo', 'Conteúdo patrocinado');
    const v = parseVersionForm(fd);
    expect(v.imagem).toMatchObject({ origem: 'fonte_terceiro', baseDeDireito: 'licenca', link: 'https://x.com' });
    expect(v.patrocinado).toBe(true);
    expect(v.rotuloPublieditorial).toBe('Conteúdo patrocinado');
  });
});
