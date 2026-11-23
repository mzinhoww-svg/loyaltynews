import { describe, expect, it } from 'vitest';
import { corpoAtualizacao, corpoCriacao, lerCampos, mesmasEvidencias } from './materia-form';
import { slugify } from './slug';

function fd(o: Record<string, string | string[]>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(o)) for (const x of Array.isArray(v) ? v : [v]) f.append(k, x);
  return f;
}

describe('slug', () => {
  it('remove acentos e pontuação', () => {
    expect(slugify('Programa Fidelização: nova regra!')).toBe('programa-fidelizacao-nova-regra');
    expect(slugify('  ---  ')).toBe('');
    expect(slugify('a'.repeat(200)).length).toBe(80);
  });
});

describe('formulário da matéria → corpos da API', () => {
  const base = { titulo: ' Título X ', editoria: 'pontos', corpo: 'Texto', resumo: 'Resumo', evidenceIds: ['e2', 'e1'] };
  it('criação: só envia o que foi preenchido e gera o slug', () => {
    const c = corpoCriacao(lerCampos(fd(base)));
    expect(c).toMatchObject({ slug: 'titulo-x', titulo: 'Título X', editoria: 'pontos', tipoConteudo: 'noticia', patrocinado: false, evidenceIds: ['e2', 'e1'] });
    expect(c).not.toHaveProperty('subtitulo');
    expect(c).not.toHaveProperty('imagem');
    expect(c).not.toHaveProperty('rotuloPublieditorial');
  });
  it('imagem só entra quando algum campo dela foi preenchido; link vazio some', () => {
    const c = corpoCriacao(lerCampos(fd({ ...base, img_url: 'https://x.com/i.jpg', img_credito: 'Agência', img_alt: 'Alt', img_base: 'licenca' })));
    expect(c.imagem).toMatchObject({ url: 'https://x.com/i.jpg', origem: 'propria', baseDeDireito: 'licenca', edicoes: [] });
    expect(c.imagem).not.toHaveProperty('link');
  });
  it('atualização: campos limpos viram null e leva a versão esperada', () => {
    const u = corpoAtualizacao(lerCampos(fd(base)), 3);
    expect(u).toMatchObject({ versaoEsperada: 3, subtitulo: null, imagem: null, rotuloPublieditorial: null, resumo: 'Resumo' });
  });
  it('patrocinado e rótulo vão juntos', () => {
    const c = corpoCriacao(lerCampos(fd({ ...base, patrocinado: 'on', rotulo: 'Conteúdo patrocinado' })));
    expect(c).toMatchObject({ patrocinado: true, rotuloPublieditorial: 'Conteúdo patrocinado' });
  });
  it('compara conjuntos de evidências sem ordem nem duplicata', () => {
    expect(mesmasEvidencias(['a', 'b'], ['b', 'a', 'a'])).toBe(true);
    expect(mesmasEvidencias(['a'], ['a', 'b'])).toBe(false);
  });
});
