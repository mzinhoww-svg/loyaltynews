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

/** Crédito único da ilustração gerada (ADR-018): institucional, sem nome de ferramenta ou modelo (D09). */
export const ILLUSTRATION_CREDIT = 'Loyalty News' as const;
/** Rótulo visível obrigatório da ilustração gerada (ADR-018). Não menciona IA (D09); deixa claro que não é foto. */
export const ILLUSTRATION_LABEL = 'Ilustração conceitual' as const;
/** Rótulo com menção a IA, usado só com a flag `rotulagemIa` ligada (D09: pronta e desligada). */
export const ILLUSTRATION_LABEL_AI = 'Ilustração conceitual gerada por IA' as const;

/** Imagem e base de direito (Blueprint §6, D08, V21-08; ilustração gerada: ADR-018). */
export const ImageRights = z
  .object({
    url: z.url(),
    origem: z.enum(['propria', 'licenciada', 'fonte_terceiro', 'dominio_publico', 'composicao_deterministica', 'ilustracao_gerada']),
    credito: z.string().min(1),
    link: z.url().optional(),
    baseDeDireito: z.enum(['propria', 'licenca', 'autorizacao', 'dominio_publico', 'excecao_validada', 'gerada_ia', 'pendente']),
    /** Só enquadramento, tamanho e compressão; marca d'água e crédito embutido nunca são removidos. */
    edicoes: z.array(z.enum(['enquadramento', 'tamanho', 'compressao'])).default([]),
    textoAlternativo: z.string().min(1),
  })
  .refine((i) => i.origem !== 'fonte_terceiro' || Boolean(i.link), {
    message: 'imagem de terceiro exige link para a fonte',
    path: ['link'],
  })
  .refine((i) => (i.origem === 'ilustracao_gerada') === (i.baseDeDireito === 'gerada_ia'), {
    message: "ilustração gerada usa base 'gerada_ia', e essa base só vale para ilustração gerada (ADR-018)",
    path: ['baseDeDireito'],
  })
  .refine((i) => i.origem !== 'ilustracao_gerada' || i.credito === ILLUSTRATION_CREDIT, {
    message: `ilustração gerada leva o crédito institucional '${ILLUSTRATION_CREDIT}' (ADR-018, D09)`,
    path: ['credito'],
  });
export type ImageRights = z.infer<typeof ImageRights>;

/**
 * Rótulo visível que o portal (e o card social) mostra junto da imagem, ou null quando não há rótulo.
 * Ilustração gerada sempre tem rótulo (ADR-018); a menção a IA só com `rotulagemIa` ligada.
 */
export function imageLabel(img: Pick<ImageRights, 'origem'> | null | undefined, opts: { rotulagemIa?: boolean } = {}): string | null {
  if (!img || img.origem !== 'ilustracao_gerada') return null;
  return opts.rotulagemIa ? ILLUSTRATION_LABEL_AI : ILLUSTRATION_LABEL;
}

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

/** Tipo de conteúdo (campo transversal `content_type` do Blueprint v2.0; não é editoria). */
export const ContentType = z.enum(['noticia', 'flash', 'analise', 'entrevista', 'opiniao', 'estudo', 'patrocinado', 'cobertura_evento']);
export type ContentType = z.infer<typeof ContentType>;

/** Tempo de leitura DERIVADO do corpo (não é armazenado): ~200 palavras/min, mínimo 1 min; ignora marcação HTML/Markdown. */
export function readingTimeMinutes(corpo: string, wordsPerMinute = 200): number {
  const texto = corpo.replace(/<[^>]*>/g, ' ').replace(/[#*_>`~[\]()!-]/g, ' ');
  const palavras = texto.split(/\s+/).filter(Boolean).length;
  return Math.max(1, Math.ceil(palavras / wordsPerMinute));
}

/** Assinatura institucional única (D09): sem autor humano inventado. */
export const ASSINATURA = 'Redação Loyalty News' as const;

export const Article = z
  .object({
    id: Id,
    slug: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
    titulo: z.string().min(1).max(200),
    subtitulo: z.string().max(300).optional(),
    /** Resumo para cards e SEO; obrigatório para publicar. */
    resumo: z.string().min(1).max(300).optional(),
    tipoConteudo: ContentType.default('noticia'),
    editoria: EditoriaSlug,
    status: ArticleStatus,
    assinatura: z.literal(ASSINATURA),
    corpo: z.string().min(1),
    fontes: z.array(EvidenceRef).min(1),
    /** Imagem de capa, com crédito e base de direito (ImageRights). */
    imagem: ImageRights.optional(),
    classeDeDado: DataClass.default('public'),
    patrocinado: z.boolean().default(false),
    rotuloPublieditorial: z.string().min(1).optional(),
    versao: z.number().int().positive(),
    publicadoEm: IsoDateTime.optional(),
  })
  .refine((a) => a.status !== 'publicado' || Boolean(a.resumo), { message: 'matéria publicada exige resumo', path: ['resumo'] })
  .refine((a) => a.tipoConteudo !== 'patrocinado' || a.patrocinado, { message: 'tipo patrocinado exige patrocinado=true (rótulo)', path: ['patrocinado'] })
  .refine((a) => !a.patrocinado || Boolean(a.rotuloPublieditorial), {
    message: 'conteúdo pago sempre rotulado (F-074)',
    path: ['rotuloPublieditorial'],
  })
  .refine((a) => a.status !== 'publicado' || !a.imagem || isImagePublishable(a.imagem), {
    message: 'imagem sem base de direito não pode ser publicada',
    path: ['imagem'],
  })
  .refine((a) => a.imagem?.origem !== 'ilustracao_gerada' || a.tipoConteudo !== 'cobertura_evento', {
    message: 'cobertura de evento não usa ilustração gerada: sugere registro documental (ADR-018)',
    path: ['imagem'],
  });
export type Article = z.infer<typeof Article>;
