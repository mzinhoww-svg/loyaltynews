import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// O /midia-kit lê a API comercial em runtime (PORTAL_SOURCE=api). Com `export const revalidate` na página o Next a pré-renderiza no build,
// sem API, e serve essa cópia congelada ("Page changed from static to dynamic at runtime"), inclusive em produção. Ela precisa ser dinâmica.
const page = readFileSync(new URL('../app/(portal)/midia-kit/page.tsx', import.meta.url), 'utf8');
const exports = (src: string) => [...src.matchAll(/^export const (\w+)\s*=\s*([^;\n]+);?/gm)].map((m) => [m[1], m[2]!.trim()] as const);

describe('/midia-kit é dinâmica (não sai congelada do build)', () => {
  it("exporta dynamic = 'force-dynamic'", () => {
    expect(exports(page)).toContainEqual(['dynamic', "'force-dynamic'"]);
  });
  it('não exporta revalidate de página (o cache de 5 min fica só no fetch da API, em commercial-source)', () => {
    expect(exports(page).map(([nome]) => nome)).not.toContain('revalidate');
    expect(page).not.toMatch(/^export const (revalidate|fetchCache)\b/m);
  });
});
