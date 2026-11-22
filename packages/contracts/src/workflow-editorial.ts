import { z } from 'zod';
import { Id, IsoDate, IsoDateTime, Sha256 } from './common';
import { ArticleStatus, ImageRights } from './editorial';
import { EditoriaSlug } from './editoria';

type Status = z.infer<typeof ArticleStatus>;

/**
 * Transições permitidas da matéria (WF02/WF03/WF08). Publicar só a partir de `aprovado`
 * e só pela identidade de publicação, com recibo (ADR-008). `bloqueado` volta a rascunho.
 */
export const ARTICLE_TRANSITIONS: Readonly<Record<Status, readonly Status[]>> = {
  rascunho: ['em_checagem'],
  em_checagem: ['aprovado', 'bloqueado', 'rascunho'],
  bloqueado: ['rascunho'],
  aprovado: ['publicado', 'rascunho'],
  publicado: ['despublicado', 'corrigido'],
  despublicado: ['rascunho'],
  corrigido: ['despublicado', 'corrigido'],
};

export function canTransition(from: Status, to: Status): boolean {
  return ARTICLE_TRANSITIONS[from].includes(to);
}

/** Recibo de publicação: liga a versão publicada às checagens que a aprovaram (gate automático). */
export const PublicationReceipt = z.object({
  id: Id,
  articleId: Id,
  versao: z.number().int().positive(),
  conteudoSha256: Sha256,
  checagens: z
    .array(
      z.object({
        tipo: z.enum(['fatos', 'direitos', 'originalidade', 'editor', 'classe_de_dado']),
        resultado: z.literal('aprovado'),
        /** Autor do modelo da checagem (ex.: openai), distinto do redator para `fatos`. */
        autorModelo: z.string().min(1).optional(),
        generationId: z.string().min(1).optional(),
      }),
    )
    .min(1),
  aprovador: z.string().min(1),
  identidadePublicacao: z.string().min(1),
  emitidoEm: IsoDateTime,
});
export type PublicationReceipt = z.infer<typeof PublicationReceipt>;

/** Ativo da biblioteca de mídia, sempre com base de direito. */
export const MediaAsset = z.object({
  id: Id,
  tipo: z.enum(['imagem', 'video', 'documento']),
  direitos: ImageRights,
  sha256: Sha256,
  criadoEm: IsoDateTime,
});
export type MediaAsset = z.infer<typeof MediaAsset>;

/** Evento da Agenda (estado de disponibilidade do módulo pelo Blueprint §1). */
export const AgendaEvent = z
  .object({
    id: Id,
    titulo: z.string().min(1),
    inicio: IsoDate,
    fim: IsoDate,
    local: z.string().min(1),
    url: z.url().optional(),
    editorias: z.array(EditoriaSlug).default([]),
    patrocinado: z.boolean().default(false),
    fonteUrl: z.url(),
  })
  .refine((e) => e.fim >= e.inicio, { message: 'fim anterior ao início', path: ['fim'] });
export type AgendaEvent = z.infer<typeof AgendaEvent>;
