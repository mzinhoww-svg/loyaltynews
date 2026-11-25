// CAPACITY_RELEASES: um formato só vira 'disponivel' no ambiente em que tem o id da decisão do proprietário.
// DP-43 (23/11): staging, só 3 formatos. DP-54 (24/11): produção, os 47 formatos, para proposta.
import { describe, expect, it } from 'vitest';
import { DECISION_ID } from '@ln/contracts';
import {
  CAPACITY_RELEASES, CATALOG, POSITIONS, buildCatalog, capacityDecision, capacityFor, catalogFor, createCommercialState, evaluateActivation, makeCtx,
  resolveFormatStatus, type Campaign,
} from './index';
import * as h from './api/index';

const LIBERADOS = ['banners--banner-topo', 'banners--retangulo-sidebar', 'banners--banner-rodape'];
const status = (env: 'staging' | 'production' | null) => Object.fromEntries(catalogFor(env).map((f) => [f.id, f.status]));

describe('liberação de venda por formato (DP-43 no staging, DP-54 na produção)', () => {
  it('registro: os 47 formatos do catálogo, todos com DP-54 na produção; no staging só Topo, Laterais e Rodapé, com DP-43', () => {
    expect(Object.keys(CAPACITY_RELEASES).sort()).toEqual(CATALOG.map((f) => f.id).sort());
    expect(Object.keys(CAPACITY_RELEASES)).toHaveLength(47);
    for (const [id, rel] of Object.entries(CAPACITY_RELEASES)) {
      expect(rel.production, id).toBe('DP-54');
      expect(rel.staging, id).toBe(LIBERADOS.includes(id) ? 'DP-43' : null);
    }
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
  it('staging (DP-43): exatamente os 3 formatos ficam disponivel, com o motivo citando a DP-43; os outros 44 não mudam', () => {
    const s = status('staging');
    expect(Object.entries(s).filter(([, v]) => v === 'disponivel').map(([k]) => k).sort()).toEqual([...LIBERADOS].sort());
    const base = Object.fromEntries(CATALOG.map((f) => [f.id, f.status]));
    for (const f of CATALOG) if (!LIBERADOS.includes(f.id)) expect(s[f.id], f.id).toBe(base[f.id]);
    expect(Object.values(s).filter((v) => v === 'sob_consulta').length).toBe(33 - 3);
    expect(Object.values(s).filter((v) => v === 'indisponivel').length).toBe(14);
    for (const f of catalogFor('staging').filter((x) => x.status === 'disponivel')) expect(f.statusReason).toContain('DP-43');
  });
  it('produção (DP-54): os 47 ficam disponivel; os 14 que o código dava como indisponivel levam a ressalva do canal desligado; o motivo cita a DP-54', () => {
    const p = catalogFor('production');
    expect(p).toHaveLength(47);
    expect(p.every((f) => f.status === 'disponivel')).toBe(true);
    expect(Object.keys(capacityFor('production'))).toHaveLength(47);
    for (const f of p) expect(f.statusReason, f.id).toContain('DP-54');
    const antes = CATALOG.filter((f) => f.status === 'indisponivel').map((f) => f.id).sort();
    expect(antes).toHaveLength(14);
    expect(p.filter((f) => f.statusReason.includes('Ressalva')).map((f) => f.id).sort()).toEqual(antes);
    // o motivo original do canal desligado continua visível ao Studio
    expect(p.find((f) => f.id === 'redes-e-canais--envio-whatsapp')!.statusReason).toContain('Canal WhatsApp sem operação definida.');
    // sem ressalva nos que já eram sob consulta ou liberados
    expect(p.find((f) => f.id === 'banners--banner-topo')!.statusReason).not.toContain('Ressalva');
  });
  it('local, CI e ambiente ausente: nenhum formato disponível, o catálogo é o do código', () => {
    expect(Object.values(status(null)).filter((v) => v === 'disponivel')).toEqual([]);
    expect(capacityFor(null)).toEqual({});
    expect(catalogFor(null).map((f) => [f.id, f.status])).toEqual(CATALOG.map((f) => [f.id, f.status]));
  });
  it('sem liberação nada é promovido; formato fora do catálogo não aparece; só a liberação explícita promove um indisponivel', () => {
    expect(buildCatalog({}).map((f) => [f.id, f.status])).toEqual(CATALOG.map((f) => [f.id, f.status]));
    const forcada = buildCatalog({ 'formato-que-nao-existe': true });
    expect(forcada.some((f) => f.id === 'formato-que-nao-existe')).toBe(false);
    expect(forcada.map((f) => f.status)).toEqual(CATALOG.map((f) => f.status));
    const liberada = buildCatalog({ 'redes-e-canais--envio-whatsapp': true });
    const w = liberada.find((f) => f.id === 'redes-e-canais--envio-whatsapp')!;
    expect(w.status).toBe('disponivel');
    expect(w.statusReason).toContain('Ressalva');
    // só ele mudou
    expect(liberada.filter((f, i) => f.status !== CATALOG[i]!.status).map((f) => f.id)).toEqual(['redes-e-canais--envio-whatsapp']);
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
  const ctxDe = (env: 'staging' | 'production' | null, adServerVendas = true) => {
    const state = createCommercialState();
    return makeCtx({ ...state, catalog: catalogFor(env) }, { now: '2026-12-05T12:00:00-03:00', today: '2026-12-05', flags: { adServerVendas } });
  };
  const evid = (ctx: ReturnType<typeof ctxDe>, formatId: string) => {
    const camp = { id: 'k', name: 'x', accountId: 'a', opportunityId: null, formatId, positionIds: ['TOP'], positionId: 'TOP', startDate: '2026-12-10', endDate: '2027-03-10', status: 'approved', reservationIds: [], sponsoredLabel: true, history: [] } as unknown as Campaign;
    const reservations = [{ id: 'r', positionId: 'TOP', advertiserId: 'a', campaignId: 'k', startDate: '2026-12-10', endDate: '2027-03-10', status: 'confirmed' as const, createdAt: '' }] as never;
    const fmt = ctx.catalog.find((f) => f.id === formatId)!;
    return evaluateActivation(camp, { saleEnabled: true, formatStatus: fmt.status, reservations, approvedCreativeCount: 1, creativePositions: ['TOP'] }).map((f) => f.code);
  };
  it('portão do formato na ativação: staging só passa nos 3 liberados (DP-43); produção passa em qualquer um (DP-54); ambiente ausente em nenhum', () => {
    expect(evid(ctxDe('staging'), 'banners--banner-topo')).toEqual([]);
    expect(evid(ctxDe('staging'), 'banners--banner-dentro-do-artigo')).toEqual(['FORMAT_NOT_AVAILABLE']);
    expect(evid(ctxDe('production'), 'banners--banner-topo')).toEqual([]);
    expect(evid(ctxDe('production'), 'banners--banner-dentro-do-artigo')).toEqual([]);
    expect(evid(ctxDe(null), 'banners--banner-topo')).toEqual(['FORMAT_NOT_AVAILABLE']);
  });
  it('confirmar reserva (venda) exige o formato disponível E a flag adServerVendas: staging confirma; produção, com a flag desligada, segue só em pré-reserva (409)', () => {
    const tenta = (env: 'staging' | 'production', flag: boolean) => {
      const ctx = ctxDe(env, flag); const acc = ctx.crm.createAccount('Acme', ctx.now);
      return h.createReservation({ ...ctx, actor: { id: 'u', canManageCommercial: true } }, { positionId: 'TOP', accountId: acc.id, startDate: '2026-12-10', endDate: '2027-03-10', confirm: true });
    };
    expect(tenta('staging', true).status).toBe(201);
    // DP-54 liberou o catálogo em produção, mas NÃO a venda: a flag adServerVendas continua sem decisão de produção (contrato), então a confirmação segue recusada
    const prod = tenta('production', false);
    expect(prod.status).toBe(409);
    expect(JSON.stringify(prod.body)).toContain('SALE_NOT_ENABLED');
  });
});
