// Núcleo compartilhado dos módulos administrativos sem backend (Fontes, Mídia, Agenda, Home/menus, SEO).
// Repositório em memória, com trilha de auditoria por identidade. O Backend troca por @ln/db; as regras ficam aqui nos serviços.
export interface Auditoria {
  em: string;
  quem: string;
  acao: string;
  alvo: string;
  detalhe?: string;
}

export type Falha = { ok: false; erros: string[] };
export type Resultado<T> = { ok: true; valor: T } | Falha;

export interface Relogio {
  agora(): string;
  id(): string;
}
export const relogioSistema: Relogio = { agora: () => new Date().toISOString(), id: () => crypto.randomUUID() };

export const falha = (...erros: string[]): Falha => ({ ok: false, erros });

export function urlValida(v: string): boolean {
  try {
    const u = new URL(v);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}

/** Normaliza URL para detectar duplicatas: minúsculas no host, sem fragmento, sem barra final. */
export function normalizarUrl(v: string): string {
  const u = new URL(v);
  u.hash = '';
  u.hostname = u.hostname.toLowerCase();
  return u.toString().replace(/\/$/, '');
}

const g = globalThis as unknown as { __lnStudioStores?: Map<string, unknown> };

/** Instância única por processo (estado temporário; some ao reiniciar). */
export function singleton<T>(chave: string, criar: () => T): T {
  g.__lnStudioStores ??= new Map();
  if (!g.__lnStudioStores.has(chave)) g.__lnStudioStores.set(chave, criar());
  return g.__lnStudioStores.get(chave) as T;
}
