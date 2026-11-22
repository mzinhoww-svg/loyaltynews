import type { Role } from '@ln/auth';

/** Quem cria e edita matérias. */
export const CMS_EDIT: readonly Role[] = ['admin', 'editor_chefe', 'editor'];
/** Quem aprova ou bloqueia na fila de checagem (aprovação exige identidade diferente do autor). */
export const CMS_REVIEW: readonly Role[] = ['admin', 'editor_chefe', 'revisor'];
/** Quem enxerga o CMS. */
export const CMS_READ: readonly Role[] = ['admin', 'editor_chefe', 'editor', 'revisor', 'leitor'];
