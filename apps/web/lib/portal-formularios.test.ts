import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// A flag portalFormularios é lida em EXECUÇÃO (ADR-022), a cada chamada, e não fixada na carga do módulo nem no build.
const estado = { portalFormularios: false };
vi.mock('./runtime-flags', () => ({ runtimeFlags: () => ({ ...estado }) }));

beforeEach(() => { estado.portalFormularios = false; });

describe('formulariosAtivos: leitura em execução', () => {
  it('desligada por padrão; ligar depois de importar o módulo vale na chamada seguinte, e desligar também (sem recarregar nada)', async () => {
    const { formulariosAtivos } = await import('./portal-formularios');
    expect(formulariosAtivos()).toBe(false);
    estado.portalFormularios = true;
    expect(formulariosAtivos()).toBe(true);
    estado.portalFormularios = false;
    expect(formulariosAtivos()).toBe(false);
  });
  it('só o valor booleano true liga (nada de truthy)', async () => {
    const { formulariosAtivos } = await import('./portal-formularios');
    for (const v of [1, 'true', {}, 'sim']) { (estado as Record<string, unknown>).portalFormularios = v; expect(formulariosAtivos(), String(v)).toBe(false); }
  });
});

describe('o código do portal não fixa a flag no build', () => {
  const ler = (p: string) => readFileSync(new URL(p, import.meta.url), 'utf8');
  it('a constante flags do portal não tem mais "forms" (valor fixo embutido no build) e ninguém a usa', () => {
    expect(ler('../app/(portal)/_lib/flags.ts')).not.toMatch(/\bforms\s*:/);
    for (const f of ['../app/(portal)/midia-kit/page.tsx', '../app/(portal)/[doc]/page.tsx', '../app/(portal)/layout.tsx', '../app/(portal)/_components/SiteFooter.tsx']) expect(ler(f), f).not.toMatch(/flags\.forms\b/);
  });
  it('o mídia kit lê pelo helper de execução e continua dinâmico (force-dynamic): o HTML não sai pronto do build', () => {
    const page = ler('../app/(portal)/midia-kit/page.tsx');
    expect(page).toMatch(/formulariosAtivos\(\)/);
    expect(page).toContain("export const dynamic = 'force-dynamic'");
    expect(page).not.toMatch(/^export const revalidate\b/m);
    // nenhuma cópia da flag em constante de módulo (fora de função)
    expect(page).not.toMatch(/^const \w+\s*=\s*(runtimeFlags|formulariosAtivos)\(/m);
  });
  it('o resolvedor de execução lê process.env na subida/lazy, não em constante do módulo (NEXT_PUBLIC_ nunca, N1)', () => {
    const rt = ler('./runtime-flags.ts');
    expect(rt).toContain('process.env');
    expect(rt).not.toContain('NEXT_PUBLIC_FLAGS');
    expect(ler('./portal-formularios.ts')).not.toMatch(/^(export )?const \w+\s*=\s*runtimeFlags\(/m);
  });
});
