// RBAC do LN Studio. PROPOSTA de papéis (não há lista de papéis nos documentos lidos); o
// Chief Architect/PM pode ajustar. Negação por padrão: ação não listada é proibida.

export const ROLES = ['admin', 'editor_chefe', 'editor', 'revisor', 'comercial', 'leitor'] as const;
export type Role = (typeof ROLES)[number];

export const RESOURCES = [
  'editorias', 'materias', 'fontes', 'midia', 'agenda', 'entidades', 'inventario', 'campanhas', 'social', 'usuarios', 'auditoria',
] as const;
export type Resource = (typeof RESOURCES)[number];

export const ACTIONS = ['read', 'create', 'update', 'delete', 'transition', 'publish'] as const;
export type Action = (typeof ACTIONS)[number];

type Grant = Partial<Record<Resource, readonly Action[]>>;
const CRUD = ['read', 'create', 'update', 'delete'] as const;

const MATRIX: Record<Role, Grant> = {
  admin: Object.fromEntries(RESOURCES.map((r) => [r, [...ACTIONS]])) as Grant,
  editor_chefe: {
    editorias: CRUD, materias: [...CRUD, 'transition', 'publish'], fontes: CRUD, midia: CRUD, agenda: [...CRUD, 'transition'],
    entidades: CRUD, inventario: ['read'], campanhas: ['read'], social: ['read', 'create', 'publish'], auditoria: ['read'],
  },
  editor: {
    editorias: ['read'], materias: ['read', 'create', 'update', 'transition'], fontes: ['read', 'create', 'update'],
    midia: ['read', 'create', 'update'], agenda: ['read', 'create', 'update'], entidades: ['read', 'create', 'update'],
    social: ['read', 'create'],
  },
  revisor: {
    editorias: ['read'], materias: ['read', 'transition'], fontes: ['read'], midia: ['read'], agenda: ['read'], entidades: ['read'], social: ['read'],
  },
  comercial: {
    midia: ['read'], agenda: ['read'], inventario: CRUD, campanhas: [...CRUD, 'transition'], entidades: ['read'],
  },
  leitor: {
    editorias: ['read'], materias: ['read'], fontes: ['read'], midia: ['read'], agenda: ['read'], entidades: ['read'],
    inventario: ['read'], campanhas: ['read'],
  },
};

export function can(role: string | null | undefined, resource: Resource, action: Action): boolean {
  if (!role || !(ROLES as readonly string[]).includes(role)) return false;
  return MATRIX[role as Role][resource]?.includes(action) ?? false;
}

export function isRole(value: unknown): value is Role {
  return typeof value === 'string' && (ROLES as readonly string[]).includes(value);
}

/** Matriz completa, para o teste negativo por papel (ADR-011) e para documentação. */
export function matrix(): Record<Role, Grant> {
  return MATRIX;
}
