// CAPACITY_RELEASES (DP-43, adendo 1 opção 1): um formato só vira 'disponivel' no ambiente em que tem o id da decisão do proprietário.
import { describe, expect, it } from 'vitest';
import { DECISION_ID } from '@ln/contracts';
import {
  CAPACITY_RELEASES, CATALOG, POSITIONS, buildCatalog, capacityDecision, capacityFor, catalogFor, createCommercialState, evaluateActivation, makeCtx,
  resolveFormatStatus, type Campaign,
} from './index';
import * as h from './api/index';

const LIBERADOS = ['banners--banner-topo', 'banners--retangulo-sidebar', 'banners--banner-rodape'];
const status = (env: 'staging' | 'production' | null) => Object.fromEntries(catalogFor(env).map((f) => [f.id, f.status]));

describe('liberação de venda por formato (DP-43)', () => {
  it('só Topo, Laterais (um formato, 3 posições) e Rodapé estão no registro, e todos com DP-43 só no staging', () => {
    expect(Object.keys(CAPACITY_RELEASES).sort()).toEqual([...LIBERADOS].sort());
    for (const id of LIBERADOS) expect(CAPACITY_RELEASES[id]).toEqual({ staging: 'DP-43', production: null });
  });
  it('os 5 espaços do lançamento (TOP, SIDEBAR_1-3, FOOTER) pertencem exatamente aos formatos liberados', () => {
    const doLancamento = POSITIONS.filter((p) => p.desktop !== null);
    expect(doLancamento.map((p) => p.id)).toEqual(['TOP', 'SIDEBAR_1', 'SIDEBAR_2', 'SIDEBAR_3', 'FOOTER']);
    expect([...new Set(doLancamento.map((p) => p.formatId))].sort()).toEqual([...LIBERADOS].sort());
    // as posições sem dimensão não são vendáveis por esta decisão
    for (const p of POSITIONS.filter((x) => x.desktop === null)) expect(LIBERADOS).not.toContain(p.formatId);
  });
  it('todo id do registro existe no catálogo e tem formato DP-NN', () => {
    for (const [id, rel] of Object.entries(CAPACITY_RELEASES)) {
      expect(CATALOG.some((f) => f.id === id), id).toBe(true);
      for (const dp of [rel.staging, rel.production]) if (dp !== null) expect(dp).toMatch(DECISION_ID);
    }
  });
  it('staging: exatamente os 3 formatos ficam disponivel, com o motivo citando a DP-43; os outros 44 não mudam', () => {
    const s = status('staging');
    expect(Object.entries(s).filter(([, v]) => v === 'disponivel').map(([k]) => k).sort()).toEqual([...LIBERADOS].sort());
    const base = Object.fromEntries(CATALOG.map((f) => [f.id, f.status]));
    for (const f of CATALOG) if (!LIBERADOS.includes(f.id)) expect(s[f.id], f.id).toBe(base[f.id]);
    expect(Object.values(s).filter((v) => v === 'sob_consulta').length).toBe(33 - 3);
    expect(Object.values(s).filter((v) => v === 'indisponivel').length).toBe(14);
    for (const f of catalogFor('staging').filter((x) => x.status === 'disponivel')) expect(f.statusReason).toContain('DP-43');
  });
  it('produção, local, CI e ambiente ausente: nenhum formato disponível (produção só com NOVA decisão)', () => {
    for (const env of ['production', null] as const) {
      expect(Object.values(status(env)).filter((v) => v === 'disponivel'), String(env)).toEqual([]);
      expect(capacityFor(env)).toEqual({});
    }
    expect(catalogFor(null).map((f) => [f.id, f.status])).toEqual(CATALOG.map((f) => [f.id, f.status]));
  });
  it('a liberação nunca promove indisponivel nem inventa formato fora do registro', () => {
    const forcada = buildCatalog({ 'redes-e-canais--envio-whatsapp': true, 'the-loyal--banner-meio': true, 'formato-que-nao-existe': true });
    expect(forcada.find((f) => f.id === 'redes-e-canais--envio-whatsapp')!.status).toBe('indisponivel');
    expect(forcada.find((f) => f.id === 'the-loyal--banner-meio')!.status).toBe('indisponivel');
    expect(forcada.some((f) => f.id === 'formato-que-nao-existe')).toBe(false);
  });
  it('decisão inválida no registro (formato de id errado) não libera nada', () => {
    const original = CAPACITY_RELEASES['banners--banner-topo']!;
    (CAPACITY_RELEASES as Record<string, unknown>)['banners--banner-topo'] = { staging: 'DP-?? (piloto)', production: null };
    try { expect(capacityDecision('banners--banner-topo', 'staging')).toBeNull(); expect(status('staging')['banners--banner-topo']).toBe('sob_consulta'); }
    finally { (CAPACITY_RELEASES as Record<string, unknown>)['banners--banner-topo'] = original; }
    expect(capacityDecision('banners--banner-topo', 'staging')).toBe('DP-43');
  });
});

describe('disponibilidade efetiva: código + estado gravado no banco (falha fechada)', () => {
  const code = (status: 'disponivel' | 'sob_consulta' | 'indisponivel') => ({ status, statusReason: `código:${status}` });
  const db = (status: 'disponivel' | 'sob_consulta' | 'indisponivel') => ({ status, reason: `banco:${status}` });
  it('sem linha no banco vale o código', () => {
    expect(resolveFormatStatus(code('disponivel'), undefined)).toEqual(code('disponivel'));
    expect(resolveFormatStatus(code('sob_consulta'), undefined)).toEqual(code('sob_consulta'));
  });
  it("'indisponivel' no banco SEMPRE rebaixa, inclusive formato liberado (retirar da venda não exige deploy)", () => {
    for (const c of ['disponivel', 'sob_consulta', 'indisponivel'] as const) expect(resolveFormatStatus(code(c), db('indisponivel')).status, c).toBe('indisponivel');
  });
  it('o banco nunca promove acima do código: disponivel gravado sem liberação vale o que o código diz', () => {
    expect(resolveFormatStatus(code('sob_consulta'), db('disponivel')).status).toBe('sob_consulta');
    expect(resolveFormatStatus(code('indisponivel'), db('disponivel')).status).toBe('indisponivel');
    expect(resolveFormatStatus(code('indisponivel'), db('sob_consulta')).status).toBe('indisponivel');
  });
  it("formato liberado pelo código fica disponivel mesmo com o 'sob_consulta' do seed (o seed não distingue padrão de escolha)", () => {
    expect(resolveFormatStatus(code('disponivel'), db('sob_consulta'))).toEqual(code('disponivel'));
    expect(resolveFormatStatus(code('disponivel'), db('disponivel'))).toEqual(code('disponivel'));
  });
  it('sem liberação, vence o menor entre banco e código (ex.: banco sob_consulta, código sob_consulta)', () => {
    expect(resolveFormatStatus(code('sob_consulta'), db('sob_consulta')).status).toBe('sob_consulta');
  });
});

describe('ativação de campanha com o catálogo do ambiente', () => {
  const ctxDe = (env: 'staging' | 'production' | null) => {
    const state = createCommercialState();
    return makeCtx({ ...state, catalog: catalogFor(env) }, { now: '2026-12-05T12:00:00-03:00', today: '2026-12-05', flags: { adServerVendas: true } });
  };
  const evid = (ctx: ReturnType<typeof ctxDe>, formatId: string) => {
    const camp = { id: 'k', name: 'x', accountId: 'a', opportunityId: null, formatId, positionIds: ['TOP'], positionId: 'TOP', startDate: '2026-12-10', endDate: '2027-03-10', status: 'approved', reservationIds: [], sponsoredLabel: true, history: [] } as unknown as Campaign;
    const reservations = [{ id: 'r', positionId: 'TOP', advertiserId: 'a', campaignId: 'k', startDate: '2026-12-10', endDate: '2027-03-10', status: 'confirmed' as const, createdAt: '' }] as never;
    const fmt = ctx.catalog.find((f) => f.id === formatId)!;
    return evaluateActivation(camp, { saleEnabled: true, formatStatus: fmt.status, reservations, approvedCreativeCount: 1, creativePositions: ['TOP'] }).map((f) => f.code);
  };
  it('no staging o Topo passa pelo portão do formato; em produção e em formato fora da liberação, não', () => {
    expect(evid(ctxDe('staging'), 'banners--banner-topo')).toEqual([]);
    expect(evid(ctxDe('production'), 'banners--banner-topo')).toEqual(['FORMAT_NOT_AVAILABLE']);
    expect(evid(ctxDe(null), 'banners--banner-topo')).toEqual(['FORMAT_NOT_AVAILABLE']);
    expect(evid(ctxDe('staging'), 'banners--banner-dentro-do-artigo')).toEqual(['FORMAT_NOT_AVAILABLE']);
  });
  it('confirmar reserva (venda) no handler exige o formato disponível do ambiente: staging confirma, produção responde 409', () => {
    const tenta = (env: 'staging' | 'production') => {
      const ctx = ctxDe(env); const acc = ctx.crm.createAccount('Acme', ctx.now);
      return h.createReservation({ ...ctx, actor: { id: 'u', canManageCommercial: true } }, { positionId: 'TOP', accountId: acc.id, startDate: '2026-12-10', endDate: '2027-03-10', confirm: true });
    };
    expect(tenta('staging').status).toBe(201);
    const prod = tenta('production');
    expect(prod.status).toBe(409);
    expect(JSON.stringify(prod.body)).toContain('SALE_NOT_ENABLED');
  });
});
