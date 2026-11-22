import { z } from 'zod';
import { DataClass, EvidenceRef, Id, IsoDateTime } from './common';
import { EditoriaSlug } from './editoria';

/** Fonte cadastrada (D10): só acesso público, sem contornar login ou paywall. */
export const Source = z.object({
  id: Id,
  nome: z.string().min(1),
  url: z.url(),
  tipo: z.enum(['site', 'rss', 'api', 'comunicado']),
  editorias: z.array(EditoriaSlug).min(1),
  acesso: z.literal('publico'),
  termosRevisados: z.boolean().default(false),
  ativo: z.boolean().default(false),
});
export type Source = z.infer<typeof Source>;

/** Imagem e base de direito (Blueprint §6, D08, V21-08). */
export const ImageRights = z
  .object({
    url: z.url(),
    origem: z.enum(['propria', 'licenciada', 'fonte_terceiro', 'dominio_publico', 'composicao_deterministica']),
    credito: z.string().min(1),
    link: z.url().optional(),
    baseDeDireito: z.enum(['propria', 'licenca', 'autorizacao', 'dominio_publico', 'excecao_validada', 'pendente']),
    /** Só enquadramento, tamanho e compressão; marca d'água e crédito embutido nunca são removidos. */
    edicoes: z.array(z.enum(['enquadramento', 'tamanho', 'compressao'])).default([]),
    textoAlternativo: z.string().min(1),
  })
  .refine((i) => i.origem !== 'fonte_terceiro' || Boolean(i.link), {
    message: 'imagem de terceiro exige link para a fonte',
    path: ['link'],
  });
export type ImageRights = z.infer<typeof ImageRights>;

/** Sem base de utilização demonstrável, a imagem não é publicável (Blueprint §6: na dúvida, não publica). */
export function isImagePublishable(img: ImageRights): boolean {
  return img.baseDeDireito !== 'pendente';
}

export const ArticleStatus = z.enum([
  'rascunho',
  'em_checagem',
  'bloqueado',
  'aprovado',
  'publicado',
  'despublicado',
  'corrigido',
]);
export type ArticleStatus = z.infer<typeof ArticleStatus>;

/** Assinatura institucional única (D09): sem autor humano inventado. */
export const ASSINATURA = 'Redação Loyalty News' as const;

export const Article = z
  .object({
    id: Id,
    slug: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
    titulo: z.string().min(1).max(200),
    subtitulo: z.string().max(300).optional(),
    editoria: EditoriaSlug,
    status: ArticleStatus,
    assinatura: z.literal(ASSINATURA),
    corpo: z.string().min(1),
    fontes: z.array(EvidenceRef).min(1),
    imagem: ImageRights.optional(),
    classeDeDado: DataClass.default('public'),
    patrocinado: z.boolean().default(false),
    rotuloPublieditorial: z.string().min(1).optional(),
    versao: z.number().int().positive(),
    publicadoEm: IsoDateTime.optional(),
  })
  .refine((a) => !a.patrocinado || Boolean(a.rotuloPublieditorial), {
    message: 'conteúdo pago sempre rotulado (F-074)',
    path: ['rotuloPublieditorial'],
  })
  .refine((a) => a.status !== 'publicado' || !a.imagem || isImagePublishable(a.imagem), {
    message: 'imagem sem base de direito não pode ser publicada',
    path: ['imagem'],
  });
export type Article = z.infer<typeof Article>;
