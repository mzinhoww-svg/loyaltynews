import { redirect } from 'next/navigation';
import type { Resultado } from '@/lib/studio/registros';

/** Volta à página com o aviso na query (formulários sem JS). Falhas listam todos os erros; nunca declara sucesso sem o serviço confirmar. */
export function voltar(path: string, r: Resultado<unknown> | { ok: true }, sucesso: string): never {
  const msg = r.ok ? sucesso : r.erros.join(' ');
  redirect(`${path}?tipo=${r.ok ? 'ok' : 'err'}&aviso=${encodeURIComponent(msg)}`);
}

export const texto = (fd: FormData, k: string): string => (typeof fd.get(k) === 'string' ? (fd.get(k) as string).trim() : '');
