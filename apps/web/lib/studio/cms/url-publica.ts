// URL pública canônica de uma matéria no Portal: {PORTAL_BASE_URL ou NEXT_PUBLIC_SITE_URL}/noticia/{slug}. Quem publica não a digita:
// uma URL errada gravaria no recibo um link que dá 404 (auditoria de UX, P2-03). Sem base configurada devolve '' (a tela deixa editar).
export function urlPublicaDaMateria(slug: string, env: Record<string, string | undefined> = process.env): string {
  const base = (env.PORTAL_BASE_URL ?? env.NEXT_PUBLIC_SITE_URL ?? '').replace(/\/+$/, '');
  return base && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug) ? `${base}/noticia/${slug}` : '';
}
