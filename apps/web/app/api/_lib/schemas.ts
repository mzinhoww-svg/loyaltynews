// Entradas das rotas de API. Montadas sobre os contratos de @ln/contracts (única fonte dos formatos);
// aqui só o que é específico do corpo de uma requisição (sem id/estado/recibo preenchidos pelo servidor).
import { z } from 'zod';
import {
  ArticleStatus,
  DataClass,
  EditoriaSlug,
  EvidenceRef,
  ImageRights,
  Id,
  IsoDate,
  PublicationReceipt,
  Sha256,
  Source,
} from '@ln/contracts';

const isHttp = (u: string) => /^https?:\/\//i.test(u);
/** URL http(s): recusa javascript:, data: e afins. */
export const HttpUrl = z.url().refine(isHttp, { message: 'apenas http ou https' });
/** ImageRights do contrato + só URLs http(s) (url e link). */
export const SafeImage = ImageRights.refine((i) => isHttp(i.url) && (!i.link || isHttp(i.link)), {
  message: 'url e link da imagem: apenas http ou https',
  path: ['url'],
});

export const Slug = z.string().min(1).max(120).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);

const ArticleBase = {
  titulo: z.string().min(1).max(200),
  subtitulo: z.string().max(300).optional(),
  editoria: EditoriaSlug,
  corpo: z.string().min(1),
  imagem: SafeImage.optional(),
  classeDeDado: DataClass.default('public'),
  patrocinado: z.boolean().default(false),
  rotuloPublieditorial: z.string().min(1).optional(),
};

export const ArticleCreate = z
  .strictObject({ slug: Slug, ...ArticleBase, evidenceIds: z.array(Id).max(50).default([]) })
  .refine((a) => !a.patrocinado || Boolean(a.rotuloPublieditorial), {
    message: 'conteúdo pago sempre rotulado (F-074)',
    path: ['rotuloPublieditorial'],
  });

export const ArticleUpdate = z
  .strictObject({
    versaoEsperada: z.number().int().positive(),
    titulo: ArticleBase.titulo.optional(),
    subtitulo: z.string().max(300).nullable().optional(),
    editoria: EditoriaSlug.optional(),
    corpo: ArticleBase.corpo.optional(),
    imagem: SafeImage.nullable().optional(),
    classeDeDado: DataClass.optional(),
    patrocinado: z.boolean().optional(),
    rotuloPublieditorial: z.string().min(1).nullable().optional(),
  })
  .refine((u) => Object.keys(u).some((k) => k !== 'versaoEsperada'), { message: 'nenhum campo para alterar' });

export const ArticleSources = z.strictObject({
  versaoEsperada: z.number().int().positive(),
  evidenceIds: z.array(Id).max(50),
});

export const ArticleTransition = z.strictObject({
  para: ArticleStatus,
  nota: z.string().min(3).max(1000).optional(),
  versaoEsperada: z.number().int().positive().optional(),
});

export const ReceiptInput = z.strictObject({
  versao: z.number().int().positive(),
  checagens: PublicationReceipt.shape.checagens,
  identidadePublicacao: z.string().min(1).optional(),
});

export const ArticleQuery = z.object({
  editoria: EditoriaSlug.optional(),
  status: ArticleStatus.optional(),
  q: z.string().min(1).max(100).optional(),
});

export const EditoriaPatch = z.strictObject({ nome: z.string().min(1).max(100) });
export const EditoriaCreate = z.strictObject({ slug: EditoriaSlug });

export const SourceCreate = z.strictObject({
  id: Id,
  nome: Source.shape.nome,
  url: HttpUrl,
  tipo: Source.shape.tipo,
  editorias: Source.shape.editorias,
  acesso: Source.shape.acesso.default('publico'),
  termosRevisados: z.boolean().default(false),
});
export const SourcePatch = z
  .strictObject({
    nome: Source.shape.nome.optional(),
    url: HttpUrl.optional(),
    tipo: Source.shape.tipo.optional(),
    editorias: Source.shape.editorias.optional(),
    termosRevisados: z.boolean().optional(),
    ativo: z.boolean().optional(),
  })
  .refine((u) => Object.keys(u).length > 0, { message: 'nenhum campo para alterar' });
export const EvidenceCreate = z.strictObject({
  url: HttpUrl,
  capturadoEm: EvidenceRef.shape.capturadoEm,
  sha256: EvidenceRef.shape.sha256,
});

export const MediaCreate = z.strictObject({
  tipo: z.enum(['imagem', 'video', 'documento']),
  direitos: SafeImage,
  sha256: Sha256,
});

export const MediaQuery = z.object({ tipo: z.enum(['imagem', 'video', 'documento']).optional() });
export const AgendaQuery = z.object({ from: IsoDate.optional(), to: IsoDate.optional() });

export const CompanyCreate = z.strictObject({
  id: Id,
  nome: z.string().min(1),
  nomeLegal: z.string().min(1).optional(),
  site: HttpUrl.optional(),
  setor: z.string().min(1).optional(),
  evidenceIds: z.array(Id).min(1).max(50),
});
export const CompanyPatch = z
  .strictObject({
    nome: z.string().min(1).optional(),
    nomeLegal: z.string().min(1).nullable().optional(),
    site: HttpUrl.nullable().optional(),
    setor: z.string().min(1).nullable().optional(),
    evidenceIds: z.array(Id).min(1).max(50).optional(),
  })
  .refine((u) => Object.keys(u).length > 0, { message: 'nenhum campo para alterar' });
/** Pessoa (DP-11/P4): só nome, cargo, empresa e a evidência pública. Qualquer outro campo é recusado. */
export const PersonCreate = z.strictObject({
  id: Id,
  nome: z.string().min(1),
  cargo: z.string().min(1),
  empresaId: Id,
  evidenceId: Id,
});

export const AgendaCreate = z
  .strictObject({
    titulo: z.string().min(1),
    inicio: IsoDate,
    fim: IsoDate,
    local: z.string().min(1),
    url: HttpUrl.optional(),
    editorias: z.array(EditoriaSlug).default([]),
    patrocinado: z.boolean().default(false),
    fonteUrl: HttpUrl,
  })
  .refine((e) => e.fim >= e.inicio, { message: 'fim anterior ao início', path: ['fim'] });
export const AgendaPatch = z
  .strictObject({
    titulo: z.string().min(1).optional(),
    inicio: IsoDate.optional(),
    fim: IsoDate.optional(),
    local: z.string().min(1).optional(),
    url: HttpUrl.nullable().optional(),
    editorias: z.array(EditoriaSlug).optional(),
    patrocinado: z.boolean().optional(),
    fonteUrl: HttpUrl.optional(),
  })
  .refine((u) => Object.keys(u).length > 0, { message: 'nenhum campo para alterar' });
