import type { Role } from '@ln/auth';

/** Escrita nos módulos editoriais (fontes, mídia, agenda, SEO). Revisor e leitor só leem. */
export const ESCRITA_EDITORIAL: readonly Role[] = ['admin', 'editor_chefe', 'editor'];
/** Moderação de eventos. */
export const MODERACAO: readonly Role[] = ['admin', 'editor_chefe', 'revisor'];
/** Home e menus: chefia editorial. */
export const CHEFIA_EDITORIAL: readonly Role[] = ['admin', 'editor_chefe'];
