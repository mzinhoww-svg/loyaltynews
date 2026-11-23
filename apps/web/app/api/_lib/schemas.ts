// Entradas das rotas de API. Montadas sobre os contratos de @ln/contracts (única fonte dos formatos);
// aqui só o que é específico do corpo de uma requisição (sem id/estado/recibo preenchidos pelo servidor).
import { z } from 'zod';
import { CorrecaoIn } from './editorial/correcao-schema';
import {
  ArticleStatus,
  ContentType,
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
  resumo: z.string().min(1).max(300).optional(),
  tipoConteudo: ContentType.default('noticia'),
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
  })
  .refine((a) => a.tipoConteudo !== 'patrocinado' || a.patrocinado, {
    message: 'tipo patrocinado exige patrocinado=true (rótulo)',
    path: ['patrocinado'],
  });

export const ArticleUpdate = z
  .strictObject({
    versaoEsperada: z.number().int().positive(),
    titulo: ArticleBase.titulo.optional(),
    subtitulo: z.string().max(300).nullable().optional(),
    editoria: EditoriaSlug.optional(),
    resumo: z.string().min(1).max(300).nullable().optional(),
    tipoConteudo: ContentType.optional(),
    corpo: ArticleBase.corpo.optional(),
    imagem: SafeImage.nullable().optional(),
    classeDeDado: DataClass.optional(),
    patrocinado: z.boolean().optional(),
    rotuloPublieditorial: z.string().min(1).nullable().optional(),
    /** Matéria já publicada: id do caso de correção aceito que autoriza a revisão (ADR-019 §c.5). */
    casoCorrecaoId: z.string().min(1).max(128).optional(),
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
  /** Obrigatória para matéria só em `articles`; opcional com rascunho no CMS editorial (a versão da projeção é do servidor). */
  versao: z.number().int().positive().optional(),
  checagens: PublicationReceipt.shape.checagens,
  /** Matéria da Fábrica já publicada: rascunho corrigido + checagem + caso aceito (ADR-019 §c.5). */
  correcao: CorrecaoIn.optional(),
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

/** Evidência da licença/autorização (contrato, e-mail, página de termos...): referência, nunca o arquivo em si. */
export const LicencaEvidencia = z
  .strictObject({
    tipo: z.enum(['url', 'documento', 'contrato', 'email']),
    referencia: z.string().trim().min(1).max(500),
    descricao: z.string().trim().max(500).optional(),
  })
  .refine((e) => e.tipo !== 'url' || /^https?:\/\/\S+$/i.test(e.referencia), { message: 'url exige http(s)', path: ['referencia'] });

export const MediaCreate = z.strictObject({
  tipo: z.enum(['imagem', 'video', 'documento']),
  direitos: SafeImage,
  sha256: Sha256,
  licencaExpiraEm: IsoDate.optional(),
  licencaEvidencia: LicencaEvidencia.optional(),
});

export const MediaPatch = z
  .strictObject({
    direitos: SafeImage.optional(),
    licencaExpiraEm: IsoDate.nullable().optional(),
    licencaEvidencia: LicencaEvidencia.nullable().optional(),
  })
  .refine((u) => Object.keys(u).length > 0, { message: 'nenhum campo para alterar' });

/** Metadados do upload: os mesmos direitos, sem a URL (o servidor aponta para o próprio arquivo). */
export const UploadMeta = z
  .strictObject({
    direitos: z.strictObject({
      origem: z.enum(['propria', 'licenciada', 'fonte_terceiro', 'dominio_publico', 'composicao_deterministica']),
      credito: z.string().min(1).max(300),
      link: HttpUrl.optional(),
      baseDeDireito: z.enum(['propria', 'licenca', 'autorizacao', 'dominio_publico', 'excecao_validada', 'pendente']),
      edicoes: z.array(z.enum(['enquadramento', 'tamanho', 'compressao'])).default([]),
      textoAlternativo: z.string().min(1).max(500),
    }),
    licencaExpiraEm: IsoDate.optional(),
    licencaEvidencia: LicencaEvidencia.optional(),
  });

export const MediaQuery = z.object({
  tipo: z.enum(['imagem', 'video', 'documento']).optional(),
  /** Licenças que vencem nos próximos N dias (1–365), ainda não vencidas. */
  vencendo: z.coerce.number().int().min(1).max(365).optional(),
  /** true = só licenças já vencidas. */
  vencida: z.enum(['true', 'false']).optional(),
  /** Busca no crédito e no texto alternativo (aparada, 1–100; % e _ literais). */
  q: z.string().trim().min(1).max(100).optional(),
  /** Mesma régua do campo `licencaStatus` da resposta (vence_em_breve = próximos 30 dias). */
  licencaStatus: z.enum(['sem_expiracao', 'valida', 'vence_em_breve', 'vencida']).optional(),
  /** Mesma régua do campo `publicavel` da resposta: base de direito não pendente E licença não vencida. */
  publicavel: z.enum(['true', 'false']).optional(),
});
export const AgendaQuery = z.object({
  from: IsoDate.optional(),
  to: IsoDate.optional(),
  moderacao: z.enum(['pendente', 'aprovado', 'rejeitado']).optional(),
  origem: z.enum(['interno', 'publico']).optional(),
});

/** Decisão de moderação de um evento da agenda. Rejeitar exige motivo. */
export const AgendaModeracao = z
  .strictObject({ estado: z.enum(['aprovado', 'rejeitado']), motivo: z.string().trim().min(3).max(500).optional() })
  .refine((m) => m.estado !== 'rejeitado' || Boolean(m.motivo), { message: 'rejeitar exige motivo', path: ['motivo'] });

/**
 * Sugestão PÚBLICA de evento. Sem dado pessoal (nada de contato), sem patrocínio, sem moderação no corpo.
 * `site` é o campo armadilha (honeypot): invisível para pessoas; se vier preenchido, é robô.
 */
export const AgendaSugestao = z.strictObject({
  titulo: z.string().trim().min(3).max(200),
  inicio: IsoDate,
  fim: IsoDate,
  local: z.string().trim().min(2).max(200),
  url: HttpUrl.max(500).optional(),
  fonteUrl: HttpUrl.max(500),
  editorias: z.array(EditoriaSlug).max(3).default([]),
  site: z.string().max(200).optional(),
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
