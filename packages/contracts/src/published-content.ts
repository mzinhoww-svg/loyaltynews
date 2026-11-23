/**
 * Conteúdo publicado e sua forma canônica (ADR-017, decisão 3). FONTE ÚNICA do hash do recibo de publicação
 * (`PublicationReceipt.conteudoSha256`), da chave do outbox `article.published:{id}:{sha}` e do hash que o
 * Editorial guarda em `publication`. Cobre TODO campo que vai ao portal: mudou qualquer um depois da aprovação,
 * o recibo deixa de valer. Calculado sobre o RASCUNHO EDITORIAL aprovado (fonte da verdade do conteúdo), nunca
 * sobre a projeção da tabela `articles`.
 *
 * Este módulo é puro (sem node:crypto), seguro para o cliente. O hash fica em `@ln/contracts/hash` (servidor).
 */
export interface PublishableContent {
  titulo: string;
  subtitulo?: string | null;
  resumo?: string | null;
  tipoConteudo: string;
  editoria: string;
  /** Corpo completo, inclusive o bloco "Fontes:" quando houver. */
  corpo: string;
  /** Imagem de capa (ImageRights) ou null. */
  imagem?: unknown;
  classeDeDado: string;
  patrocinado: boolean;
  rotuloPublieditorial?: string | null;
  /** Identificadores estáveis das fontes citadas (ids de evidência ou URLs); a ordem não importa. */
  fontes: readonly string[];
}

export const PUBLISHED_CONTENT_HASH_VERSION = 'ln-published-content/1' as const;

function canonical(value: unknown): string {
  if (value === undefined || value === null) return 'null';
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (typeof value === 'object') {
    const o = value as Record<string, unknown>;
    return `{${Object.keys(o)
      .filter((k) => o[k] !== undefined)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonical(o[k])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

/** Texto canônico (determinístico) do conteúdo publicado, com prefixo de versão. Entrada do sha256. */
export function canonicalPublishedContent(c: PublishableContent): string {
  return `${PUBLISHED_CONTENT_HASH_VERSION}\n${canonical({
    titulo: c.titulo,
    subtitulo: c.subtitulo ?? null,
    resumo: c.resumo ?? null,
    tipoConteudo: c.tipoConteudo,
    editoria: c.editoria,
    corpo: c.corpo,
    imagem: c.imagem ?? null,
    classeDeDado: c.classeDeDado,
    patrocinado: c.patrocinado,
    rotuloPublieditorial: c.rotuloPublieditorial ?? null,
    fontes: [...c.fontes].sort(),
  })}`;
}
