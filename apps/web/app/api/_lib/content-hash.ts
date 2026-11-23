import { createHash } from 'node:crypto';

export interface HashableArticle {
  titulo: string;
  subtitulo: string | null;
  resumo: string | null;
  tipoConteudo: string;
  editoria: string;
  corpo: string;
  imagem: unknown;
  classeDeDado: string;
  patrocinado: boolean;
  rotuloPublieditorial: string | null;
}

/** JSON canônico: chaves ordenadas em qualquer profundidade, sem espaços. */
export function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') {
    const o = value as Record<string, unknown>;
    return `{${Object.keys(o)
      .filter((k) => o[k] !== undefined)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonical(o[k])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value ?? null);
}

/**
 * Hash do conteúdo que o recibo aprova (conteudoSha256): título, subtítulo, resumo, tipo de conteúdo, editoria, corpo, imagem,
 * classe de dado, rótulo publieditorial e as evidências citadas (IDs ordenados). Mudou qualquer um, o
 * recibo deixa de valer.
 */
export function contentSha256(a: HashableArticle, evidenceIds: readonly string[]): string {
  const payload = canonical({
    titulo: a.titulo,
    subtitulo: a.subtitulo,
    resumo: a.resumo,
    tipoConteudo: a.tipoConteudo,
    editoria: a.editoria,
    corpo: a.corpo,
    imagem: a.imagem ?? null,
    classeDeDado: a.classeDeDado,
    patrocinado: a.patrocinado,
    rotuloPublieditorial: a.rotuloPublieditorial,
    fontes: [...evidenceIds].sort(),
  });
  return createHash('sha256').update(payload, 'utf8').digest('hex');
}
