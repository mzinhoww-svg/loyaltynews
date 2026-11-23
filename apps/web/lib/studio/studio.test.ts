import { describe, expect, it } from 'vitest';
import type { Session } from '@ln/auth';
import { FLAG_DEFAULTS } from '@ln/contracts';
import { MODULES, checkAccess, findModule, visibleModules } from './modules';
import { readFileSync } from 'node:fs';
import { resolveStudioSession } from './session';
import { e2eBackend as e2eBackendProd } from './e2e-backend.prod';

const sess = (roles: Session['roles'], mfa = true): Session => ({ userId: 'u', email: 'u@mock.invalid', role: roles[0]!, roles, mfa, sessionId: 's' });


describe('módulos do Studio', () => {
  it('cobre os 25 módulos pedidos, com slugs únicos', () => {
    expect(MODULES).toHaveLength(25);
    expect(new Set(MODULES.map((m) => m.slug)).size).toBe(25);
    for (const slug of ['cms', 'fontes', 'publicacoes', 'agenda', 'editorias', 'home-menus', 'seo', 'midia', 'social', 'creative', 'entidades', 'organogramas', 'watchlists', 'crm', 'inventario', 'campanhas', 'analytics', 'organizacao', 'reunioes', 'decisoes', 'modelops', 'finops', 'auditoria', 'configuracoes', 'permissoes']) {
      expect(findModule(slug), slug).toBeDefined();
    }
  });
  it('flags de módulo existem no contrato e estão desligadas', () => {
    for (const m of MODULES) if (m.flag) expect(FLAG_DEFAULTS[m.flag]).toBe(false);
  });
  it('nega por padrão: sem sessão, sem MFA ou sem papel', () => {
    expect(checkAccess(null, ['admin'])).toEqual({ ok: false, reason: 'NO_SESSION' });
    expect(checkAccess(sess(['admin'], false), ['admin'])).toEqual({ ok: false, reason: 'NO_MFA' });
    expect(checkAccess(sess(['leitor']), ['admin'])).toEqual({ ok: false, reason: 'FORBIDDEN' });
    expect(checkAccess(sess(['admin']), ['admin']).ok).toBe(true);
    expect(visibleModules(null)).toHaveLength(0);
  });
  it('papéis veem só os módulos do seu escopo', () => {
    const com = visibleModules(sess(['comercial'])).map((m) => m.slug);
    expect(com).toContain('crm');
    expect(com).not.toContain('cms');
    expect(com).not.toContain('finops');
    expect(visibleModules(sess(['admin']))).toHaveLength(25);
  });
});

describe('sessão do Studio', () => {
  it('sem runtime de auth (sem DATABASE_URL) não há sessão: nega por padrão', async () => {
    const r = await resolveStudioSession(new Headers({ cookie: 'better-auth.session_token=qualquer' }));
    expect(r.session).toBeNull();
  });
  it('produção: backend de e2e e banco em memória são nulos', () => {
    expect(e2eBackendProd).toBeNull();
  });
  it('session.ts e guard.ts não contêm sessão simulada nem referência ao código de teste', () => {
    for (const f of ['./session.ts', '../../app/studio/_lib/guard.ts']) {
      const src = readFileSync(new URL(f, import.meta.url), "utf8").split(String.fromCharCode(10)).filter((l) => !l.trim().startsWith("//")).join(" ");
      for (const marcador of ['ln-test-session', 'parseTestSession', 'e2e.mock', 'test-seam', 'createStaffUser']) expect(src.includes(marcador), `${f}: ${marcador}`).toBe(false);
    }
  });
});

