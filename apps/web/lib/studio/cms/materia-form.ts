// Conversão do formulário do editor nos corpos das rotas reais /api/materias (ArticleCreate / ArticleUpdate).
// Nenhuma regra de negócio aqui: validação, estados e versões são do Backend.
import { slugify } from './slug';

const txt = (fd: FormData, k: string) => (typeof fd.get(k) === 'string' ? (fd.get(k) as string).trim() : '');

export interface CamposMateria {
  titulo: string;
  subtitulo: string;
  resumo: string;
  tipoConteudo: string;
  editoria: string;
  corpo: string;
  evidenceIds: string[];
  imagem: { url: string; origem: string; credito: string; link?: string; baseDeDireito: string; textoAlternativo: string; edicoes: string[] } | null;
  patrocinado: boolean;
  rotulo: string;
}

export function lerCampos(fd: FormData): CamposMateria {
  const img = {
    url: txt(fd, 'img_url'),
    origem: txt(fd, 'img_origem') || 'propria',
    credito: txt(fd, 'img_credito'),
    baseDeDireito: txt(fd, 'img_base') || 'pendente',
    textoAlternativo: txt(fd, 'img_alt'),
    link: txt(fd, 'img_link'),
  };
  const temImagem = Boolean(img.url || img.credito || img.textoAlternativo || img.link);
  return {
    titulo: txt(fd, 'titulo'),
    subtitulo: txt(fd, 'subtitulo'),
    resumo: txt(fd, 'resumo'),
    tipoConteudo: txt(fd, 'tipoConteudo') || 'noticia',
    editoria: txt(fd, 'editoria'),
    corpo: txt(fd, 'corpo'),
    evidenceIds: fd.getAll('evidenceIds').map(String).filter(Boolean),
    imagem: temImagem ? { ...img, ...(img.link ? { link: img.link } : { link: undefined }), edicoes: [] } : null,
    patrocinado: fd.get('patrocinado') === 'on',
    rotulo: txt(fd, 'rotulo'),
  };
}

const semVazios = <T extends Record<string, unknown>>(o: T): T => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as T;

/** Corpo de POST /api/materias. Campos opcionais vazios não são enviados. */
export function corpoCriacao(c: CamposMateria) {
  return semVazios({
    slug: slugify(c.titulo),
    titulo: c.titulo,
    subtitulo: c.subtitulo || undefined,
    resumo: c.resumo || undefined,
    tipoConteudo: c.tipoConteudo,
    editoria: c.editoria,
    corpo: c.corpo,
    evidenceIds: c.evidenceIds,
    imagem: c.imagem ? semVazios(c.imagem) : undefined,
    patrocinado: c.patrocinado,
    rotuloPublieditorial: c.rotulo || undefined,
  });
}

/** Corpo de PATCH /api/materias/{id}: campos limpos viram null (a API aceita null para limpar). */
export function corpoAtualizacao(c: CamposMateria, versaoEsperada: number) {
  return semVazios({
    versaoEsperada,
    titulo: c.titulo,
    subtitulo: c.subtitulo || null,
    resumo: c.resumo || null,
    tipoConteudo: c.tipoConteudo,
    editoria: c.editoria,
    corpo: c.corpo,
    imagem: c.imagem ? semVazios(c.imagem) : null,
    patrocinado: c.patrocinado,
    rotuloPublieditorial: c.rotulo || null,
  });
}

export const mesmasEvidencias = (a: readonly string[], b: readonly string[]): boolean => {
  const x = [...new Set(a)].sort();
  const y = [...new Set(b)].sort();
  return x.length === y.length && x.every((v, i) => v === y[i]);
};
