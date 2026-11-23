import { describe, expect, it } from 'vitest';
import type { Session } from '@ln/auth';
import { FLAG_DEFAULTS } from '@ln/contracts';
import { MODULES, checkAccess, findModule, visibleModules } from './modules';
import { readFileSync } from 'node:fs';
import { resolveStudioSession } from './session';
import { testSeam as seamProd } from './test-seam.prod';
import { TEST_COOKIE, parseTestSession, testSeam as seamE2e } from './test-seam.e2e.mock';
import { CmsService, MemoryArticleRepository, checkVersion, currentVersion, hasBlockers, slugify, type VersionInput } from './cms/articles';

const sess = (roles: Session['roles'], mfa = true): Session => ({ userId: 'u', email: 'u@mock.invalid', role: roles[0]!, roles, mfa, sessionId: 's' });

const valid: VersionInput = {
  titulo: 'Programa X muda regra de pontos',
  corpo: 'Texto da matéria.',
  editoria: 'pontos',
  fontes: [{ nome: 'Comunicado oficial', url: 'https://exemplo.com.br/comunicado' }],
  imagem: { url: 'https://exemplo.com.br/i.jpg', origem: 'propria', credito: 'Redação Loyalty News', baseDeDireito: 'propria', textoAlternativo: 'Cartão de fidelidade' },
  patrocinado: false,
};

function service() {
  let n = 0;
  return new CmsService(new MemoryArticleRepository(), { now: () => new Date(Date.UTC(2026, 10, 22, 12, 0, n++)).toISOString(), id: () => `id-${n++}` });
}

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
  it('produção: seam nulo, mesmo com a variável e o cookie presentes não há sessão', async () => {
    expect(seamProd).toBeNull();
    const r = await resolveStudioSession(new Headers({ cookie: `${TEST_COOKIE}=u1:admin` }), seamProd, { LN_STUDIO_TEST_SESSION: '1' });
    expect(r).toEqual({ session: null, simulada: false });
  });
  it('session.ts não contém nenhum código de sessão simulada', () => {
    const src = readFileSync(new URL('./session.ts', import.meta.url), 'utf8');
    for (const marcador of ['parseTestSession', 'LN_STUDIO_TEST_SESSION=', 'cookie', 'ROLES']) expect(src.includes(marcador), marcador).toBe(false);
    const guard = readFileSync(new URL('../../app/studio/_lib/guard.ts', import.meta.url), 'utf8');
    expect(guard.includes('test-seam.e2e')).toBe(false);
  });
  it('seam de e2e só vale com LN_STUDIO_TEST_SESSION=1', async () => {
    const h = new Headers({ cookie: `a=b; ${TEST_COOKIE}=u1:admin+editor` });
    expect(await resolveStudioSession(h, seamE2e, {})).toEqual({ session: null, simulada: false });
    expect((await resolveStudioSession(h, seamE2e, { LN_STUDIO_TEST_SESSION: 'true' })).session).toBeNull();
    const r = await resolveStudioSession(h, seamE2e, { LN_STUDIO_TEST_SESSION: '1' });
    expect(r.simulada).toBe(true);
    expect(r.session).toMatchObject({ userId: 'u1', role: 'admin', roles: ['admin', 'editor'], mfa: true });
  });
  it('cookie inválido ou papel desconhecido não gera sessão', () => {
    expect(parseTestSession(undefined)).toBeNull();
    expect(parseTestSession('u1')).toBeNull();
    expect(parseTestSession('u1:superuser')).toBeNull();
    expect(parseTestSession('u1:editor:nomfa')?.mfa).toBe(false);
  });
});

describe('CMS editorial', () => {
  it('começa vazio (sem matéria fictícia)', () => {
    expect(service().list()).toEqual([]);
  });
  it('slugify remove acentos e gera slug único', () => {
    expect(slugify('Programa Fidelização: nova regra!')).toBe('programa-fidelizacao-nova-regra');
    const s = service();
    const a = s.create('u1', valid);
    const b = s.create('u1', valid);
    expect(a.ok && b.ok && a.value.slug !== b.value.slug).toBe(true);
  });
  it('editar gera nova versão e nunca sobrescreve', () => {
    const s = service();
    const c = s.create('u1', valid);
    if (!c.ok) throw new Error('create');
    const e = s.edit('u1', c.value.id, { ...valid, titulo: 'Título novo' }, 'ajuste');
    if (!e.ok) throw new Error('edit');
    expect(e.value.versoes.map((v) => v.numero)).toEqual([1, 2]);
    expect(e.value.versoes[0]!.titulo).toBe(valid.titulo);
    expect(currentVersion(e.value).titulo).toBe('Título novo');
  });
  it('checagem bloqueia matéria sem fonte, sem rótulo pago e imagem pendente', () => {
    expect(hasBlockers(checkVersion({ ...valid, fontes: [] }))).toBe(true);
    expect(hasBlockers(checkVersion({ ...valid, patrocinado: true }))).toBe(true);
    expect(hasBlockers(checkVersion({ ...valid, patrocinado: true, rotuloPublieditorial: 'Conteúdo patrocinado' }))).toBe(false);
    expect(hasBlockers(checkVersion({ ...valid, imagem: { ...valid.imagem!, baseDeDireito: 'pendente' } }))).toBe(true);
    expect(hasBlockers(checkVersion({ ...valid, imagem: { ...valid.imagem!, origem: 'fonte_terceiro', baseDeDireito: 'licenca' } }))).toBe(true);
    expect(hasBlockers(checkVersion(valid))).toBe(false);
  });
  it('fluxo: rascunho → checagem → aprovado com quatro olhos e versão vigente', () => {
    const s = service();
    const c = s.create('autor', valid);
    if (!c.ok) throw new Error('create');
    const id = c.value.id;
    const sub = s.submitForReview('autor', id);
    expect(sub.ok).toBe(true);
    expect(s.approve('autor', id, 1)).toMatchObject({ ok: false, code: 'QUATRO_OLHOS' });
    expect(s.approve('revisor', id, 7)).toMatchObject({ ok: false, code: 'ESTADO_INVALIDO' });
    const ok = s.approve('revisor', id, 1);
    expect(ok.ok && ok.value.status === 'aprovado' && ok.value.aprovacao?.por === 'revisor' && ok.value.aprovacao.versao === 1).toBe(true);
  });
  it('editar após aprovação invalida a aprovação (volta a rascunho)', () => {
    const s = service();
    const c = s.create('autor', valid);
    if (!c.ok) throw new Error('create');
    s.submitForReview('autor', c.value.id);
    s.approve('revisor', c.value.id, 1);
    const e = s.edit('autor', c.value.id, { ...valid, corpo: 'Mudou.' });
    expect(e.ok && e.value.status === 'rascunho' && e.value.aprovacao === undefined).toBe(true);
    expect(s.approve('revisor', c.value.id, 1)).toMatchObject({ ok: false });
  });
  it('envio para checagem recusa rascunho com bloqueio e bloqueio exige motivo', () => {
    const s = service();
    const c = s.create('autor', { ...valid, fontes: [] });
    if (!c.ok) throw new Error('create');
    expect(s.submitForReview('autor', c.value.id)).toMatchObject({ ok: false, code: 'VALIDACAO' });
    const d = s.create('autor', valid);
    if (!d.ok) throw new Error('create');
    s.submitForReview('autor', d.value.id);
    expect(s.block('revisor', d.value.id, '  ')).toMatchObject({ ok: false, code: 'MOTIVO_OBRIGATORIO' });
    const b = s.block('revisor', d.value.id, 'Fonte não confirma o número');
    expect(b.ok && b.value.status).toBe('bloqueado');
    const r = s.reopen('autor', d.value.id);
    expect(r.ok && r.value.status === 'rascunho' && r.value.versoes.length === 2).toBe(true);
  });
  it('registra histórico de cada ação com identidade', () => {
    const s = service();
    const c = s.create('autor', valid);
    if (!c.ok) throw new Error('create');
    s.submitForReview('autor', c.value.id);
    s.approve('revisor', c.value.id, 1);
    expect(s.get(c.value.id)!.historico.map((h) => `${h.quem}:${h.acao}`)).toEqual(['autor:criada', 'autor:enviada_para_checagem', 'revisor:aprovada']);
  });
});
