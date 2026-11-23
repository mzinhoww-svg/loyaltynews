/** Slug estável: sem acentos (marcas combinantes Unicode), minúsculo, hifenizado, até 80 caracteres. */
export function slugify(titulo: string): string {
  return titulo
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}
