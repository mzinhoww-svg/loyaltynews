import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { schema } from '@ln/db';
import { call, makeApp, type Actor } from '../_lib/testkit';
import { dispatchCommercial as d } from '../_lib/commercial';
import { SALE_DISABLED_IN_ENV, vendaTravadaNaApi } from '../_lib/commercial/index';
import { AVISO_VENDA_DESLIGADA, vendaLiberadaNoAmbiente } from '../../../lib/studio/comercial';

// DP-43 por ambiente na API (defesa em profundidade): onde a venda NÃO foi liberada (FLAG_RELEASES.adServerVendas null: produção;
// ambiente desconhecido, local ou CI), aprovar criativo e levar campanha a approved/active são recusados com 409 SALE_DISABLED_IN_ENV,
// pela MESMA regra das telas. Staging e as demais operações não mudam.
const SHA = 'a'.repeat(64);
const ARQUIVO_TOP = { arquivoRef: `anuncios/${SHA}.png`, arquivoMime: 'image/png', largura: 1280, altura: 150, tamanhoKb: 100, arquivoSha256: SHA, textoAlternativo: 'Oferta do anunciante teste', destinoUrl: 'https://anunciante.example/oferta' } as const;
const P = (p: string) => `/api/commercial${p}`;

let app: Awaited<ReturnType<typeof makeApp>>;
let admin: Actor;
let comercial: Actor;

/** Roda `fn` com APP_ENV = env (undefined = ausente) e restaura depois. A regra lê o ambiente a cada requisição. */
async function emEnv<T>(env: string | undefined, fn: () => Promise<T>): Promise<T> {
  const antes = process.env.APP_ENV;
  if (env === undefined) delete process.env.APP_ENV; else process.env.APP_ENV = env;
  try { return await fn(); } finally { if (antes === undefined) delete process.env.APP_ENV; else process.env.APP_ENV = antes; }
}
const aprovar = (as: Actor | null, creativeId = 'cr-1') => call(d, 'POST', { path: P('/studio/creatives/approve'), body: { creativeId }, as });
const mover = (as: Actor | null, to: string, campaignId = 'cmp-1') => call(d, 'POST', { path: P('/studio/campaigns/transition'), body: { campaignId, to }, as });
const criativo = async () => (await app.db.select().from(schema.adCreatives).where(eq(schema.adCreatives.id, 'cr-1')))[0]!;
const campanha = async () => (await app.db.select().from(schema.campaigns).where(eq(schema.campaigns.id, 'cmp-1')))[0]!;

beforeAll(async () => {
  app = await makeApp({ adServerVendas: true });
  admin = await app.actor('admin');
  comercial = await app.actor('comercial');
  const { seedCommercial } = await import('../_lib/commercial/repo');
  await seedCommercial(app.db);
  await app.db.insert(schema.crmAccounts).values({ id: 'acc-1', nome: 'Anunciante Teste' });
  await app.db.insert(schema.campaigns).values({ id: 'cmp-1', nome: 'Campanha', contaId: 'acc-1', formatoId: 'banners--banner-topo', slotId: 'TOP', inicio: '2026-12-01', fim: '2027-02-28', status: 'draft' });
  await app.db.insert(schema.adCreatives).values({ id: 'cr-1', campanhaId: 'cmp-1', slotId: 'TOP', peso: 1, inicio: '2026-12-01', fim: '2027-02-28', aprovado: false, ...ARQUIVO_TOP });
}, 120_000);
afterAll(async () => { await app.close(); });

const ADMIN = { canManageCommercial: true, canApprove: true };
const COMERCIAL = { canManageCommercial: true, canApprove: false };
const APPROVE = '/api/commercial/studio/creatives/approve';
const TRANSITION = '/api/commercial/studio/campaigns/transition';
describe('regra pura: o que a API trava', () => {
  it('admin: trava aprovar criativo e mover para approved ou active; nada mais', () => {
    expect(vendaTravadaNaApi('POST', APPROVE, {}, ADMIN)).toBe(true);
    expect(vendaTravadaNaApi('POST', TRANSITION, { to: 'approved' }, ADMIN)).toBe(true);
    expect(vendaTravadaNaApi('POST', TRANSITION, { to: 'active' }, ADMIN)).toBe(true);
    for (const to of ['reserved', 'paused', 'completed', 'cancelled', undefined, 7, null]) expect(vendaTravadaNaApi('POST', TRANSITION, { to }, ADMIN), String(to)).toBe(false);
    expect(vendaTravadaNaApi('POST', TRANSITION, undefined, ADMIN)).toBe(false);
    expect(vendaTravadaNaApi('POST', '/api/commercial/studio/creatives/content', {}, ADMIN)).toBe(false); // o comercial prepara
    expect(vendaTravadaNaApi('POST', '/api/commercial/studio/creatives', {}, ADMIN)).toBe(false);
    expect(vendaTravadaNaApi('GET', APPROVE, {}, ADMIN)).toBe(false);
  });
  it('só trava o que PASSARIA pelas checagens de papel: quem não pode aprovar segue no 403 da DP-43; sem sessão, no 401', () => {
    expect(vendaTravadaNaApi('POST', APPROVE, {}, COMERCIAL)).toBe(false); // 403 APPROVAL_FORBIDDEN, em qualquer ambiente
    expect(vendaTravadaNaApi('POST', TRANSITION, { to: 'approved' }, COMERCIAL)).toBe(false);
    expect(vendaTravadaNaApi('POST', TRANSITION, { to: 'active' }, COMERCIAL)).toBe(true); // ativar não exige ser aprovador: o comercial seria aceito
    expect(vendaTravadaNaApi('POST', APPROVE, {}, undefined)).toBe(false);
    expect(vendaTravadaNaApi('POST', TRANSITION, { to: 'active' }, undefined)).toBe(false);
    expect(vendaTravadaNaApi('POST', APPROVE, {}, { canManageCommercial: false, canApprove: true })).toBe(false); // sem acesso ao módulo: 403 FORBIDDEN
    expect(vendaTravadaNaApi('POST', APPROVE, {}, { canManageCommercial: true })).toBe(false); // canApprove ausente = não aprova
  });
  it('é a mesma regra das telas: só onde FLAG_RELEASES.adServerVendas tem decisão (staging hoje)', () => {
    expect(vendaLiberadaNoAmbiente('staging')).toBe(true);
    for (const amb of ['production', 'producao', 'local', 'ci', '', undefined, 'staging-x']) expect(vendaLiberadaNoAmbiente(amb), String(amb)).toBe(false);
  });
});

describe('produção: aprovar e ativar pela API são recusados, para qualquer papel, sem tocar no banco', () => {
  it('admin tenta aprovar o criativo: 409 SALE_DISABLED_IN_ENV com o aviso da DP-43; o criativo segue não aprovado', async () => {
    const r = await emEnv('production', () => aprovar(admin));
    expect([r.status, r.body.error?.code]).toEqual([409, SALE_DISABLED_IN_ENV]);
    expect(r.body.error.message).toBe(AVISO_VENDA_DESLIGADA);
    expect(r.body.error.message).toContain('DP-43');
    expect((await criativo()).aprovado).toBe(false);
  });
  it('o comercial segue recebendo o 403 APPROVAL_FORBIDDEN da DP-43 (o contrato de papel não muda em produção) e, ao aprovar a campanha, o mesmo', async () => {
    const r = await emEnv('production', () => aprovar(comercial));
    expect([r.status, r.body.error?.code]).toEqual([403, 'APPROVAL_FORBIDDEN']);
    const c = await emEnv('production', () => mover(comercial, 'approved'));
    expect([c.status, c.body.error?.code]).toEqual([403, 'APPROVAL_FORBIDDEN']);
    expect((await criativo()).aprovado).toBe(false);
  });
  it('o comercial que tenta ATIVAR (papel permitido) é barrado pela trava de ambiente: 409', async () => {
    const r = await emEnv('production', () => mover(comercial, 'active'));
    expect([r.status, r.body.error?.code]).toEqual([409, SALE_DISABLED_IN_ENV]);
    expect((await campanha()).status).toBe('draft');
  });
  it('admin tenta mover a campanha para approved e para active: 409 nos dois; o status não muda', async () => {
    for (const to of ['approved', 'active']) {
      const r = await emEnv('production', () => mover(admin, to));
      expect([r.status, r.body.error?.code], to).toEqual([409, SALE_DISABLED_IN_ENV]);
    }
    expect((await campanha()).status).toBe('draft');
  });
  it('sem sessão continua 401 (a autenticação vem antes); GET e o resto seguem funcionando', async () => {
    expect((await emEnv('production', () => aprovar(null))).status).toBe(401);
    expect((await emEnv('production', () => call(d, 'GET', { path: P('/mediakit') }))).status).toBe(200);
    expect((await emEnv('production', () => call(d, 'GET', { path: P('/studio/campaigns/detail'), query: { campaignId: 'cmp-1' }, as: comercial }))).status).toBe(200);
  });
  it('o que NÃO é venda segue permitido em produção: o comercial prepara o criativo e a campanha pode ser cancelada', async () => {
    const edita = await emEnv('production', () => call(d, 'POST', { path: P('/studio/creatives/content'), body: { creativeId: 'cr-1', altText: 'Texto revisado pelo comercial' }, as: comercial }));
    expect(edita.status).toBe(200);
    const reserva = await emEnv('production', () => mover(admin, 'reserved'));
    expect(reserva.body.error?.code).not.toBe(SALE_DISABLED_IN_ENV); // quem recusa é o domínio (sem reserva), não a trava de ambiente
  });
});

describe('ambiente desconhecido, local ou CI: desligado, como nas telas', () => {
  it('sem APP_ENV e com APP_ENV=local: aprovar e ativar recusados', async () => {
    for (const env of [undefined, 'local', 'ci']) {
      expect((await emEnv(env, () => aprovar(admin))).body.error?.code, String(env)).toBe(SALE_DISABLED_IN_ENV);
      expect((await emEnv(env, () => mover(admin, 'active'))).body.error?.code, String(env)).toBe(SALE_DISABLED_IN_ENV);
    }
    expect((await criativo()).aprovado).toBe(false);
  });
});

describe('staging: nada muda', () => {
  it('o comercial segue recebendo 403 APPROVAL_FORBIDDEN (a regra de papel da DP-43 continua valendo)', async () => {
    const r = await emEnv('staging', () => aprovar(comercial));
    expect([r.status, r.body.error?.code]).toEqual([403, 'APPROVAL_FORBIDDEN']);
    expect((await criativo()).aprovado).toBe(false);
  });
  it('mover para approved/active em staging não é barrado pela trava de ambiente: quem decide é o domínio', async () => {
    for (const to of ['approved', 'active']) {
      const r = await emEnv('staging', () => mover(admin, to));
      expect(r.body.error?.code, to).not.toBe(SALE_DISABLED_IN_ENV);
    }
  });
  it('o admin aprova o criativo (200) e a aprovação fica gravada', async () => {
    const r = await emEnv('staging', () => aprovar(admin));
    expect([r.status, r.body.approved]).toEqual([200, true]);
    expect((await criativo()).aprovado).toBe(true);
  });
});
