import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createIntelligenceSlice, filterDirectory, mapCompany, mapCompanyItem, mapMove, mapPerson, mapPersonItem, mapRelation, mapRole, relationLabel, sortMoves,
} from '../app/(portal)/_lib/intelligence-source';
import { emptySource } from '../app/(portal)/_lib/empty-source';
import { mockSource } from '../app/(portal)/_lib/fixtures/portal.mock';

// Payloads no formato de fast-track/decisoes/contrato-publico-intelligence-portal.md.
const ID = (n: number) => `20000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const COLETA = '2026-11-23T00:00:00.000Z';
// Organização ainda manda a coleta dentro de `fonte`; vínculo e cargo mandam no topo (contrato de proveniência).
const fonteOrg = { nome: 'Fonte de teste', url: 'https://fonte.invalid/p', coletadoEm: COLETA };
const fonte = { nome: 'Fonte de teste', url: 'https://fonte.invalid/p' };
const item = (n: number, tipo: string, nome = `Org ${n}`) => ({ id: ID(n), nome, nomeLegal: nome, tipo, relacoes: n % 3, validadoEm: '2026-11-23T00:00:00.000Z', mock: false });
const relacao = (over: Record<string, unknown> = {}) => ({
  id: ID(90), tipo: 'partner_of', sentido: 'origem', empresa: { id: ID(2), nome: 'Banco', tipo: 'company' },
  vigenteDesde: '2026-11-23', coletadoEm: COLETA, validadoEm: '2026-11-23T00:00:00.000Z', naoConfirmado: false, fonte, quote: 'trecho literal', ...over,
});
const empresa = (over: Record<string, unknown> = {}) => ({
  id: ID(1), nome: 'Livelo', nomeLegal: 'Livelo S.A.', tipo: 'company', fonte: fonteOrg, relacoes: [relacao()], pessoas: { disponivel: false, itens: [] }, ...over,
});

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

describe('mapeamento do contrato', () => {
  it('item válido; tipo desconhecido ou data inválida é descartado', () => {
    expect(mapCompanyItem(item(1, 'program'))).toMatchObject({ id: ID(1), kind: 'program', relationCount: 1 });
    expect(mapCompanyItem(item(1, 'banco'))).toBeNull();
    expect(mapCompanyItem({ ...item(1, 'company'), validadoEm: 'ontem' })).toBeNull();
    expect(mapCompanyItem(null)).toBeNull();
  });

  it('relação sem fonte não é publicada; o trecho literal nunca é copiado', () => {
    const r = mapRelation(relacao());
    expect(r).toMatchObject({ direction: 'from', type: 'partner_of', source: { name: 'Fonte de teste', url: 'https://fonte.invalid/p' } });
    expect(JSON.stringify(r)).not.toContain('trecho literal');
    expect(mapRelation(relacao({ fonte: null }))).toBeNull();
    expect(mapRelation(relacao({ fonte: { ...fonte, url: 'javascript:alert(1)' } }))).toBeNull();
    expect(mapRelation(relacao({ sentido: 'lado' }))).toBeNull();
  });

  it('proveniência do vínculo: coleta no topo, validação real e controle negativo', () => {
    const ok = mapRelation(relacao());
    expect(ok).toMatchObject({ collectedAt: COLETA, validatedAt: '2026-11-23T00:00:00.000Z' });
    expect(ok?.unconfirmed).toBeUndefined();
    // sem validadoEm: sai marcado como não confirmado, nunca como fato
    const semValidacao = mapRelation(relacao({ validadoEm: null, naoConfirmado: true }));
    expect(semValidacao).toMatchObject({ validatedAt: null, collectedAt: COLETA, unconfirmed: true });
    // data de validação inválida: não inventa data nem publica
    expect(mapRelation(relacao({ validadoEm: 'ontem' }))).toBeNull();
    // coleta ausente: não publica (sem saber quando foi coletado, não há prova)
    expect(mapRelation(relacao({ coletadoEm: null }))).toBeNull();
    expect(mapRelation(relacao({ coletadoEm: undefined }))).toBeNull();
  });

  it('empresa: relações inválidas saem, ordem por nome, pessoas indisponíveis com a flag desligada', () => {
    const c = mapCompany(empresa({ relacoes: [relacao({ empresa: { id: ID(3), nome: 'Zeta', tipo: 'other' } }), relacao(), { lixo: true }] }));
    expect(c?.relations.map((r) => r.other.name)).toEqual(['Banco', 'Zeta']);
    expect(c?.peopleAvailable).toBe(false);
    expect(mapCompany(empresa({ fonte: undefined }))).toBeNull();
  });

  it('rótulo da relação depende do sentido', () => {
    expect(relationLabel({ type: 'parent_of', direction: 'from' })).toBe('Controla');
    expect(relationLabel({ type: 'parent_of', direction: 'to' })).toBe('Controlada por');
    expect(relationLabel({ type: 'other', direction: 'to' })).toBe('Vínculo declarado com');
    expect(relationLabel({ type: 'partner_of', direction: 'from' })).toBe('Parceria declarada com');
  });

  it('filtro por tipo mantém a contagem de todos os tipos; busca ignora acento', () => {
    const all = [item(1, 'company', 'Ônibus'), item(2, 'company', 'Banco'), item(3, 'other', 'Clube')].map((i) => mapCompanyItem(i)!);
    const d = filterDirectory(all, { kind: 'company' });
    expect(d.items.map((i) => i.name)).toEqual(['Banco', 'Ônibus']);
    expect(d.kinds).toEqual([{ kind: 'company', total: 2 }, { kind: 'other', total: 1 }]);
    expect(filterDirectory(all, { q: 'onibus' }).items).toHaveLength(1);
  });
});

describe('createIntelligenceSlice (HTTP)', () => {
  let err: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    err = vi.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(() => err.mockRestore());

  it('lista e filtra por tipo localmente', async () => {
    const f = vi.fn(async () => json(200, { data: [item(1, 'company'), item(2, 'other'), { id: 'x' }], total: 3, tipos: [] }));
    const s = createIntelligenceSlice('http://api.test/', f as unknown as typeof fetch);
    const d = await s.getCompanyDirectory({ kind: 'other', q: ' org ' });
    expect(f).toHaveBeenCalledWith('http://api.test/api/publico/intelligence/empresas?limit=100&q=org', expect.anything());
    expect(d).toMatchObject({ status: 'ok', total: 1, kinds: [{ kind: 'company', total: 1 }, { kind: 'other', total: 1 }] });
  });

  it.each([
    ['status 503', async () => json(503, { error: {} })],
    ['formato inválido', async () => json(200, { data: 'x' })],
    ['rede', async () => { throw new TypeError('fetch failed'); }],
  ])('falha (%s) vira indisponível, nunca vazio', async (_n, impl) => {
    const s = createIntelligenceSlice('http://api.test', vi.fn(impl) as unknown as typeof fetch);
    expect(await s.getCompanyDirectory()).toEqual({ status: 'unavailable' });
    expect(await s.getCompany(ID(1))).toEqual({ status: 'unavailable' });
    expect(await s.listCompanies()).toEqual([]);
  });

  it('empresa: 404 é não encontrada; id fora do formato nem chega à API', async () => {
    const f = vi.fn(async () => json(404, { error: { code: 'not_found' } }));
    const s = createIntelligenceSlice('http://api.test', f as unknown as typeof fetch);
    expect(await s.getCompany(ID(1))).toEqual({ status: 'not_found' });
    expect(await s.getCompany('../../materias')).toEqual({ status: 'not_found' });
    expect(f).toHaveBeenCalledTimes(1);
  });

  it('empresa válida', async () => {
    const s = createIntelligenceSlice('http://api.test', (async () => json(200, { data: empresa() })) as unknown as typeof fetch);
    const r = await s.getCompany(ID(1));
    expect(r.status === 'ok' && r.company.relations[0]?.other.name).toBe('Banco');
  });
});

const cargo = (over: Record<string, unknown> = {}) => ({
  id: ID(50), titulo: 'CEO', empresa: { id: ID(1), nome: 'Livelo' }, vigenteDesde: '2026-11-01', vigenteAte: null,
  coletadoEm: COLETA, validadoEm: '2026-11-23T00:00:00.000Z', naoConfirmado: false, fonte, mock: false, quote: 'trecho literal', ...over,
});
const leitura = (titulo: string) => ({ titulo, empresa: { id: ID(1), nome: 'Livelo' }, vigenteDesde: '2026-11-01', vigenteAte: null, coletadoEm: COLETA, validadoEm: '2026-11-23T00:00:00.000Z', fonte });
const move = (over: Record<string, unknown> = {}) => ({
  id: ID(60), tipo: 'title_change', base: 'observed_diff', pessoa: { id: ID(70), nome: 'Ana' }, dataEfetiva: null, observadoEm: '2026-11-20',
  antes: leitura('Diretora'), depois: leitura('CEO'), mock: false, ...over,
});

describe('pessoas, cargos e Moves', () => {
  it('inicioDeclarado da API (M-04) é mapeado; ausente fica indefinido (API antiga)', () => {
    expect(mapRole(cargo({ inicioDeclarado: false }))?.startDeclared).toBe(false);
    expect(mapRole(cargo({ inicioDeclarado: true }))?.startDeclared).toBe(true);
    expect(mapRole(cargo())?.startDeclared).toBeUndefined();
    expect(mapRole(cargo({ inicioDeclarado: 'sim' }))?.startDeclared).toBeUndefined();
  });

  it('cargo exige fonte e datas válidas; nunca copia o trecho', () => {
    const r = mapRole(cargo());
    expect(r).toMatchObject({ title: 'CEO', company: { name: 'Livelo' }, validTo: null });
    expect(JSON.stringify(r)).not.toContain('trecho literal');
    expect(mapRole(cargo({ fonte: undefined }))).toBeNull();
    expect(mapRole(cargo({ vigenteDesde: '23/11/2026' }))).toBeNull();
  });

  it('proveniência do cargo: coleta no topo, validação real e controle negativo', () => {
    expect(mapRole(cargo())).toMatchObject({ collectedAt: COLETA, validatedAt: '2026-11-23T00:00:00.000Z' });
    expect(mapRole(cargo({ validadoEm: null, naoConfirmado: true }))).toMatchObject({ validatedAt: null, unconfirmed: true });
    expect(mapRole(cargo({ validadoEm: 'ontem' }))).toBeNull();
    expect(mapRole(cargo({ coletadoEm: null }))).toBeNull();
  });

  it('Move precisa da evidência de cada lado que o tipo exige (Move = duas leituras)', () => {
    expect(mapMove(move())).toMatchObject({ kind: 'title_change', before: { title: 'Diretora' }, after: { title: 'CEO' } });
    expect(mapMove(move({ antes: null }))).toBeNull(); // mudança sem "antes"
    expect(mapMove(move({ tipo: 'org_change', depois: null }))).toBeNull();
    expect(mapMove(move({ tipo: 'departure', depois: null }))).toMatchObject({ after: null });
    expect(mapMove(move({ tipo: 'departure', antes: null, depois: null }))).toBeNull();
    expect(mapMove(move({ tipo: 'appointment', antes: null }))).toMatchObject({ before: null });
    expect(mapMove(move({ antes: { ...leitura('X'), fonte: null } }))).toBeNull(); // leitura sem fonte não vale
    expect(mapMove(move({ tipo: 'promoção' }))).toBeNull();
    expect(mapMove(move({ dataEfetiva: 'ontem' }))?.effectiveDate).toBeNull();
  });

  it('lista confia no Backend para "vigente" (cargo com fim futuro fica); correção do titular é mapeada', () => {
    const p = mapPersonItem({ id: ID(70), nome: 'Ana', corrigidoPeloTitular: true, cargos: [cargo(), cargo({ id: ID(51), vigenteAte: '2030-12-31' })] });
    expect(p?.roles).toHaveLength(2);
    expect(p?.correctedByHolder).toBe(true);
    expect(mapRole(cargo({ periodo: 'desde 2024', corrigidoPeloTitular: true }))).toMatchObject({ periodText: 'desde 2024', correctedByHolder: true });
    expect(mapRole(cargo({ periodo: 'x'.repeat(300) }))?.periodText).toHaveLength(120);
  });

  it('perfil separa atuais e histórico', () => {
    const prof = mapPerson({ id: ID(70), nome: 'Ana', fonte: fonteOrg, perfilPublico: 'javascript:alert(1)', cargosAtuais: [cargo()], historico: [cargo({ vigenteAte: '2026-11-10' })], moves: [move(), move({ antes: null })] });
    expect(prof).toMatchObject({ profileUrl: null, currentRoles: [{ title: 'CEO' }], history: [{ validTo: '2026-11-10' }] });
    expect(prof?.moves).toHaveLength(1);
  });

  it('Moves em ordem do mais recente', () => {
    const a = mapMove(move({ id: ID(61), observadoEm: '2026-11-01' }))!;
    const b = mapMove(move({ id: ID(62), observadoEm: '2026-11-21' }))!;
    expect(sortMoves([a, b]).map((m) => m.id)).toEqual([ID(62), ID(61)]);
  });

  describe('HTTP', () => {
    let err: ReturnType<typeof vi.spyOn>;
    beforeEach(() => {
      err = vi.spyOn(console, 'error').mockImplementation(() => {});
    });
    afterEach(() => err.mockRestore());

    it('flag desligada com itens no dado: nada é exibido, mas os itens viram `withheld` (não somem em silêncio)', async () => {
      // P3 do QA 8: disponivel=false com 2 pessoas no dado não pode virar "ainda não há perfis" sem aviso.
      const s = createIntelligenceSlice('http://api.test', (async () => json(200, { data: [move({ id: ID(61) }), move({ id: ID(62) })], total: 2, disponivel: false })) as unknown as typeof fetch);
      expect(await s.getMovesFeed()).toEqual({ status: 'ok', items: [], total: 0, available: false, withheld: 2 });
    });

    it('contrato 92d79c8: disponivel descreve o recurso; total 0 com disponivel=true é filtro sem resultado', async () => {
      // Recurso com dado, filtro sem resultado: a tela precisa dizer "nenhuma pessoa para este filtro", não "ainda não há".
      const filtro = createIntelligenceSlice('http://api.test', (async () => json(200, { data: [], total: 0, disponivel: true })) as unknown as typeof fetch);
      expect(await filtro.getPeopleDirectory({ q: 'ninguem' })).toEqual({ status: 'ok', items: [], total: 0, available: true });
      expect(await filtro.getMovesFeed()).toEqual({ status: 'ok', items: [], total: 0, available: true });
    });

    it('recurso sem dado publicável: disponivel=false, total 0 e sem `withheld`', async () => {
      const semDado = createIntelligenceSlice('http://api.test', (async () => json(200, { data: [], total: 0, disponivel: false })) as unknown as typeof fetch);
      expect(await semDado.getPeopleDirectory()).toEqual({ status: 'ok', items: [], total: 0, available: false });
      expect(await semDado.getMovesFeed()).toEqual({ status: 'ok', items: [], total: 0, available: false });
    });
    it('pessoas: disponivel=false com perfis no dado devolve withheld (2) e nada publicável', async () => {
      const s = createIntelligenceSlice('http://api.test', (async () => json(200, {
        data: [{ id: ID(70), nome: 'Ana', cargos: [] }, { id: ID(71), nome: 'Bia', cargos: [] }], total: 2, disponivel: false,
      })) as unknown as typeof fetch);
      expect(await s.getPeopleDirectory()).toEqual({ status: 'ok', items: [], total: 0, available: false, withheld: 2 });
    });
    it('pessoas: disponivel=false sem itens não tem withheld (não há nada retido)', async () => {
      const s = createIntelligenceSlice('http://api.test', (async () => json(200, { data: [], total: 0, disponivel: false })) as unknown as typeof fetch);
      expect(await s.getPeopleDirectory()).not.toHaveProperty('withheld');
    });

    it('disponivel=true com total>0 é disponível e mantém o total do servidor', async () => {
      const cheio = createIntelligenceSlice('http://api.test', (async () => json(200, { data: [move()], total: 1, disponivel: true })) as unknown as typeof fetch);
      const feed = await cheio.getMovesFeed();
      expect(feed).toMatchObject({ status: 'ok', total: 1, available: true });
      expect(feed.status === 'ok' && feed.items).toHaveLength(1);
    });

    it('envelope sem `disponivel` é inválido; 503 é indisponível; 404 é não encontrado', async () => {
      const bad = createIntelligenceSlice('http://api.test', (async () => json(200, { data: [] })) as unknown as typeof fetch);
      expect(await bad.getPeopleDirectory()).toEqual({ status: 'unavailable' });
      const down = createIntelligenceSlice('http://api.test', (async () => json(503, {})) as unknown as typeof fetch);
      expect(await down.getMovesFeed()).toEqual({ status: 'unavailable' });
      expect(await down.getPerson(ID(70))).toEqual({ status: 'unavailable' });
      const nf = createIntelligenceSlice('http://api.test', (async () => json(404, {})) as unknown as typeof fetch);
      expect(await nf.getMove(ID(60))).toEqual({ status: 'not_found' });
      // Move com id certo mas fora do modelo (sem "antes"): 404, não "indisponível".
      const fora = createIntelligenceSlice('http://api.test', (async () => json(200, { data: move({ antes: null }) })) as unknown as typeof fetch);
      expect(await fora.getMove(ID(60))).toEqual({ status: 'not_found' });
    });

    it('filtros vão na query só quando são UUID; descarta Move inválido', async () => {
      const f = vi.fn(async () => json(200, { data: [move(), move({ id: ID(63), antes: null })], total: 2, disponivel: true }));
      const s = createIntelligenceSlice('http://api.test', f as unknown as typeof fetch);
      const r = await s.getMovesFeed({ companyId: ID(1), personId: 'x' });
      expect(f).toHaveBeenCalledWith(`http://api.test/api/publico/intelligence/moves?limit=100&empresa=${ID(1)}`, expect.anything());
      expect(r).toMatchObject({ status: 'ok', total: 1, available: true });
    });
  });
});

describe('fontes vazia e MOCK', () => {
  it('vazia: pessoas e Moves vazios e indisponíveis por flag; perfis inexistentes', async () => {
    expect(await emptySource.getPeopleDirectory()).toEqual({ status: 'ok', items: [], total: 0, available: false });
    expect(await emptySource.getMovesFeed()).toEqual({ status: 'ok', items: [], total: 0, available: false });
    expect(await emptySource.getPerson(ID(1))).toEqual({ status: 'not_found' });
    expect(await emptySource.getMove(ID(1))).toEqual({ status: 'not_found' });
  });

  it('MOCK: Moves e pessoas rotulados, com antes e depois e links para entidades existentes', async () => {
    const feed = await mockSource.getMovesFeed();
    if (feed.status !== 'ok') throw new Error('mock');
    for (const m of feed.items) {
      expect(m.mock).toBe(true);
      expect(m.before && m.after).toBeTruthy();
      expect((await mockSource.getPerson(m.person.id)).status).toBe('ok');
      expect((await mockSource.getCompany(m.after!.company.id)).status).toBe('ok');
    }
    const people = await mockSource.getPeopleDirectory();
    if (people.status !== 'ok') throw new Error('mock');
    expect(people.items.every((p) => p.mock && p.name.includes('MOCK'))).toBe(true);
  });

  it('vazia: diretório vazio honesto e empresa inexistente', async () => {
    expect(await emptySource.getCompanyDirectory()).toEqual({ status: 'ok', items: [], total: 0, kinds: [] });
    expect(await emptySource.getCompany(ID(1))).toEqual({ status: 'not_found' });
  });

  it('MOCK: tudo rotulado e as relações apontam para empresas existentes', async () => {
    const d = await mockSource.getCompanyDirectory();
    if (d.status !== 'ok') throw new Error('mock indisponível');
    expect(d.items.every((c) => c.mock && c.name.includes('MOCK'))).toBe(true);
    for (const c of d.items) {
      const r = await mockSource.getCompany(c.id);
      if (r.status !== 'ok') throw new Error(c.id);
      for (const rel of r.company.relations) expect((await mockSource.getCompany(rel.other.id)).status).toBe('ok');
      expect(r.company.source.url).toMatch(/\.invalid\//);
    }
  });
});
