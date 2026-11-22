import { z } from 'zod';
import { Id, IsoDate, IsoDateTime } from './common';

/** Estado por formato (CP-12): nada à venda sem capacidade operacional. */
export const Disponibilidade = z.enum(['disponivel', 'sob_consulta', 'indisponivel']);

/** Um dos 47 formatos comerciais (Blueprint v2.0 §4). Preço é referência (D12). */
export const AdFormat = z.object({
  id: z.string().regex(/^[a-z0-9-]+--[a-z0-9-]+$/),
  secao: z.string().min(1),
  nome: z.string().min(1),
  referenciaBrl: z.string().min(1),
  escopo: z.string().min(1),
  disponibilidade: Disponibilidade,
});
export type AdFormat = z.infer<typeof AdFormat>;

export const SlotPosition = z.enum([
  'TOP',
  'SIDEBAR_1',
  'SIDEBAR_2',
  'SIDEBAR_3',
  'FOOTER',
  'ARTICLE_INLINE',
  'HOME_BETWEEN',
  'AGENDA',
  'DATA',
]);

export const AdSlot = z.object({
  id: Id,
  posicao: SlotPosition,
  dimensaoDesktop: z.string().regex(/^\d+×\d+$|^parametrizavel$/),
  limiteCotas: z.number().int().positive().nullable(),
  pesoMaxKb: z.number().int().positive().nullable(),
  contratoMinimo: z.string().min(1).nullable(),
});
export type AdSlot = z.infer<typeof AdSlot>;

export const Campaign = z
  .object({
    id: Id,
    anunciante: z.string().min(1),
    formatoIds: z.array(z.string()).min(1),
    slotIds: z.array(Id).default([]),
    inicio: IsoDate,
    fim: IsoDate,
    status: z.enum(['rascunho', 'proposta', 'ativa', 'pausada', 'encerrada']),
    /** Conteúdo pago sempre rotulado (F-074). */
    rotulada: z.literal(true),
  })
  .refine((c) => c.fim >= c.inicio, { message: 'fim anterior ao início', path: ['fim'] });
export type Campaign = z.infer<typeof Campaign>;

/** Lead do mídia kit: dado pessoal (classe `personal`); opt-in de newsletter separado e desligado por padrão. */
export const Lead = z.object({
  id: Id,
  nome: z.string().min(1),
  empresa: z.string().min(1),
  email: z.email(),
  whatsapp: z.string().min(8).optional(),
  formatosInteresse: z.array(z.string()).default([]),
  objetivo: z.string().min(1),
  mensagem: z.string().max(4000).optional(),
  optInNewsletter: z.boolean().default(false),
  consentimentoEm: IsoDateTime,
  classeDeDado: z.literal('personal'),
});
export type Lead = z.infer<typeof Lead>;
