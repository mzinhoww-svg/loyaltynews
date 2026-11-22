// Conversão de FormData do editor em VersionInput. Linhas de fonte vazias são descartadas.
import type { ImageInput, SourceInput, VersionInput } from './articles';

export const FONTES_LINHAS = 5;

const text = (fd: FormData, k: string) => (typeof fd.get(k) === 'string' ? (fd.get(k) as string).trim() : '');

export function parseVersionForm(fd: FormData): VersionInput {
  const fontes: SourceInput[] = [];
  for (let i = 0; i < FONTES_LINHAS; i++) {
    const nome = text(fd, `fonte_nome_${i}`);
    const url = text(fd, `fonte_url_${i}`);
    if (nome || url) fontes.push({ nome, url });
  }
  const img: ImageInput = {
    url: text(fd, 'img_url'),
    origem: text(fd, 'img_origem') || 'propria',
    credito: text(fd, 'img_credito'),
    baseDeDireito: text(fd, 'img_base') || 'pendente',
    textoAlternativo: text(fd, 'img_alt'),
    ...(text(fd, 'img_link') ? { link: text(fd, 'img_link') } : {}),
  };
  const temImagem = Boolean(img.url || img.credito || img.textoAlternativo || img.link);
  const subtitulo = text(fd, 'subtitulo');
  const rotulo = text(fd, 'rotulo');
  return {
    titulo: text(fd, 'titulo'),
    ...(subtitulo ? { subtitulo } : {}),
    corpo: text(fd, 'corpo'),
    editoria: text(fd, 'editoria'),
    fontes,
    ...(temImagem ? { imagem: img } : {}),
    patrocinado: fd.get('patrocinado') === 'on',
    ...(rotulo ? { rotuloPublieditorial: rotulo } : {}),
  };
}
