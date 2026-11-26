// MOCK de teste (e2e do portal, PORTAL_MODE=api): rotas públicas do Entity Intelligence. Nada aqui é real.
// GET /api/publico/intelligence/empresas[/:id] — formato de fast-track/decisoes/contrato-publico-intelligence-portal.md (MOCK).
// FAKE_API_INTEL=seed serve a SEED REAL v3 (29 organizações e 28 vínculos declarados) por seed-v3-fixture.mjs: mesmo
// contrato, conjunto real, sem acesso ao staging. Os demais modos (full/vazio/sem-flag/retido) continuam MOCK.
import { empresaDetalhe, listaEmpresas } from './seed-v3-fixture.mjs';
const orgId = (n) => `10000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const fonte = (n) => ({ nome: `Fonte de teste ${n} (MOCK)`, url: `https://fonte-${n}.invalid/pagina`, coletadoEm: '2026-11-23T00:00:00.000Z' });
// Vínculo/cargo: `fonte` sem data (a coleta vai no topo, como na rota real).
const fonteBase = (n) => ({ nome: `Fonte de teste ${n} (MOCK)`, url: `https://fonte-${n}.invalid/pagina` });
const orgs = [
  { id: orgId(1), nome: '[MOCK API] Programa Alfa', nomeLegal: '[MOCK API] Programa Alfa', tipo: 'company' },
  { id: orgId(2), nome: '[MOCK API] Banco Beta', nomeLegal: '[MOCK API] Banco Beta S.A.', tipo: 'company' },
  { id: orgId(3), nome: '[MOCK API] Associação Gama', nomeLegal: '[MOCK API] Associação Gama', tipo: 'association' },
  { id: orgId(4), nome: '[MOCK API] Clube Delta', nomeLegal: '[MOCK API] Clube Delta', tipo: 'other' },
  { id: orgId(5), nome: '[MOCK API] Coalizão Épsilon', nomeLegal: '[MOCK API] Coalizão Épsilon', tipo: 'program' },
];
const rels = [
  { id: orgId(101), tipo: 'other', from: orgId(2), to: orgId(1) },
  { id: orgId(102), tipo: 'partner_of', from: orgId(1), to: orgId(4) },
  { id: orgId(103), tipo: 'other', from: orgId(1), to: orgId(3) },
  { id: orgId(104), tipo: 'other', from: orgId(4), to: orgId(3) },
];
const orgFull = (o) => ({ ...o, mock: true, validadoEm: '2026-11-23T00:00:00.000Z', relacoes: rels.filter((r) => r.from === o.id || r.to === o.id).length });
const intelMode = process.env.FAKE_API_INTEL ?? 'full';

// Pessoas, cargos e Moves (contrato-publico-intelligence-pessoas-moves.md). FAKE_API_INTEL: full | vazio | sem-flag.
// Contrato 92d79c8: `disponivel` descreve o RECURSO (ao menos um item publicável no universo), não o resultado do filtro.
// Em `vazio` e `sem-flag` não há dado publicável; em `full` há, mesmo quando o filtro devolve total 0.
const disponivel = intelMode === 'full';
const ref = (o) => ({ id: o.id, nome: o.nome });
const cargo = (id, titulo, org, desde, ate, n) => ({ id: orgId(id), titulo, empresa: ref(org), vigenteDesde: desde, vigenteAte: ate,
  coletadoEm: '2026-11-23T00:00:00.000Z', validadoEm: '2026-11-23T00:00:00.000Z', naoConfirmado: false, fonte: fonteBase(`c${n}`), mock: true, quote: 'TRECHO LITERAL QUE NÃO PODE APARECER' });
const leitura = (c) => ({ titulo: c.titulo, empresa: c.empresa, vigenteDesde: c.vigenteDesde, vigenteAte: c.vigenteAte, coletadoEm: c.coletadoEm, validadoEm: c.validadoEm, fonte: c.fonte });
const ana = { id: orgId(201), nome: '[MOCK API] Ana Teste' };
const bia = { id: orgId(202), nome: '[MOCK API] Bia Teste' };
const anaAntes = cargo(301, 'Diretora Comercial (MOCK)', orgs[1], '2026-09-01', '2026-11-20', 1);
// Igual à rota real: correção do titular sobrepõe o período (texto) e marca corrigidoPeloTitular.
const anaDepois = { ...cargo(302, 'CEO (MOCK)', orgs[0], '2026-11-20', null, 2), periodo: 'desde nov. 2026 (MOCK, corrigido)', corrigidoPeloTitular: true };
// Cargo VIGENTE com fim no futuro: a rota real o manda na lista de vigentes (valid_to > hoje).
// inicioDeclarado: false, como a rota real manda quando a fonte não traz o início (vigenteDesde = dia da coleta).
const biaCargo = { ...cargo(303, 'Presidente (MOCK)', orgs[2], '2026-11-23', '2030-12-31', 3), inicioDeclarado: false };
const moves = [
  { id: orgId(401), tipo: 'org_change', base: 'observed_diff', pessoa: ref(ana), dataEfetiva: null, observadoEm: '2026-11-20',
    antes: leitura(anaAntes), depois: leitura(anaDepois), mock: true, quote: 'TRECHO LITERAL QUE NÃO PODE APARECER' },
  // Mudança sem a leitura "antes": viola o modelo (Move = duas leituras); o portal precisa descartá-la.
  { id: orgId(402), tipo: 'title_change', base: 'observed_diff', pessoa: ref(bia), dataEfetiva: null, observadoEm: '2026-11-22',
    antes: null, depois: leitura(biaCargo), mock: true },
];
const pessoas = [
  { ...ana, cargosAtuais: [anaDepois], historico: [anaAntes], corrigidoPeloTitular: true },
  { ...bia, cargosAtuais: [biaCargo], historico: [] },
];
// Igual à API real (publico.ts / publico-pessoas.ts): id fora do formato UUID = 400 invalid_input, ANTES da flag; códigos em minúsculas.
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const idInvalido = () => [400, { error: { code: 'invalid_input', message: 'id deve ser UUID.' } }];
const vazioOuSemFlag = () => intelMode === 'vazio' || intelMode === 'sem-flag';

function pessoasEMoves(u) {
  if (u.pathname === '/api/publico/intelligence/pessoas') {
    if (vazioOuSemFlag()) return [200, { data: [], total: 0, disponivel }];
    const q = u.searchParams.get('q')?.toLowerCase();
    const emp = u.searchParams.get('empresa');
    const data = pessoas
      .filter((p) => (!q || p.nome.toLowerCase().includes(q)) && (!emp || p.cargosAtuais.some((c) => c.empresa.id === emp)))
      .map((p) => ({ id: p.id, nome: p.nome, cargos: p.cargosAtuais, mock: true }));
    return [200, { data, total: data.length, disponivel }];
  }
  if (u.pathname === '/api/publico/intelligence/moves') {
    if (vazioOuSemFlag()) return [200, { data: [], total: 0, disponivel }];
    const emp = u.searchParams.get('empresa');
    const pes = u.searchParams.get('pessoa');
    const data = moves.filter((m) => (!pes || m.pessoa.id === pes) && (!emp || [m.antes?.empresa.id, m.depois?.empresa.id].includes(emp)));
    return [200, { data, total: data.length, disponivel }];
  }
  const p = /^\/api\/publico\/intelligence\/pessoas\/([^/]+)$/.exec(u.pathname);
  if (p) {
    if (!UUID.test(decodeURIComponent(p[1]))) return idInvalido();
    const x = !vazioOuSemFlag() && pessoas.find((y) => y.id === decodeURIComponent(p[1]));
    if (!x) return [404, { error: { code: 'not_found', message: 'pessoa não encontrada' } }];
    return [200, { data: { id: x.id, nome: x.nome, ...(x.corrigidoPeloTitular ? { corrigidoPeloTitular: true } : {}), perfilPublico: null, fonte: fonte(`p${x.id.slice(-1)}`), mock: true, cargosAtuais: x.cargosAtuais, historico: x.historico,
      moves: moves.filter((m) => m.pessoa.id === x.id) }, disponivel }];
  }
  const mv = /^\/api\/publico\/intelligence\/moves\/([^/]+)$/.exec(u.pathname);
  if (mv) {
    if (!UUID.test(decodeURIComponent(mv[1]))) return idInvalido();
    const x = !vazioOuSemFlag() && moves.find((y) => y.id === decodeURIComponent(mv[1]));
    return x ? [200, { data: x }] : [404, { error: { code: 'not_found', message: 'move não encontrado' } }];
  }
  return null;
}

// FAKE_API_INTEL=seed: seed v3 real (29 organizações, 28 vínculos). Pessoas e Moves seguem vazios e indisponíveis:
// a seed não tem pessoas (flag J-01) nem Moves, e dizer outra coisa seria inventar dado.
function seed(u) {
  if (u.pathname === '/api/publico/intelligence/empresas') {
    return [200, listaEmpresas({
      q: u.searchParams.get('q') ?? undefined,
      tipo: u.searchParams.get('tipo') ?? undefined,
      limit: Number(u.searchParams.get('limit') ?? 100),
      offset: Number(u.searchParams.get('offset') ?? 0),
    })];
  }
  const m = /^\/api\/publico\/intelligence\/empresas\/([^/]+)$/.exec(u.pathname);
  if (m) {
    const id = decodeURIComponent(m[1]);
    if (!UUID.test(id)) return idInvalido();
    const corpo = empresaDetalhe(id);
    return corpo ? [200, corpo] : [404, { error: { code: 'not_found', message: 'empresa não encontrada' } }];
  }
  if (u.pathname === '/api/publico/intelligence/pessoas' || u.pathname === '/api/publico/intelligence/moves') {
    return [200, { data: [], total: 0, disponivel: false }];
  }
  const item = /^\/api\/publico\/intelligence\/(pessoas|moves)\/([^/]+)$/.exec(u.pathname);
  if (item) {
    const id = decodeURIComponent(item[2]);
    if (!UUID.test(id)) return idInvalido();
    return [404, { error: { code: 'not_found', message: `${item[1] === 'pessoas' ? 'pessoa' : 'move'} não encontrado` } }];
  }
  return null;
}

export function intelligence(u) {
  if (intelMode === 'seed') return seed(u);
  const pm = pessoasEMoves(u);
  if (pm) return pm;
  if (u.pathname === '/api/publico/intelligence/empresas') {
    if (intelMode === 'vazio') return [200, { data: [], total: 0, tipos: [] }];
    const q = u.searchParams.get('q')?.toLowerCase();
    const tipo = u.searchParams.get('tipo');
    const byQ = orgs.filter((o) => !q || o.nome.toLowerCase().includes(q));
    const tipos = [...new Set(byQ.map((o) => o.tipo))].map((t) => ({ tipo: t, total: byQ.filter((o) => o.tipo === t).length }));
    const data = byQ.filter((o) => !tipo || o.tipo === tipo).map(orgFull);
    return [200, { data, total: data.length, tipos }];
  }
  const m = /^\/api\/publico\/intelligence\/empresas\/([^/]+)$/.exec(u.pathname);
  if (!m) return null;
  if (!UUID.test(decodeURIComponent(m[1]))) return idInvalido();
  const o = orgs.find((x) => x.id === decodeURIComponent(m[1]));
  if (!o) return [404, { error: { code: 'not_found', message: 'empresa não encontrada' } }];
  const relacoes = rels
    .filter((r) => r.from === o.id || r.to === o.id)
    .map((r) => {
      const other = orgs.find((x) => x.id === (r.from === o.id ? r.to : r.from));
      // `trecho`/`quote` NUNCA vêm no contrato; o campo extra aqui prova que o portal não renderiza o que recebe a mais.
      return { id: r.id, tipo: r.tipo, sentido: r.from === o.id ? 'origem' : 'destino', empresa: { id: other.id, nome: other.nome, tipo: other.tipo },
        vigenteDesde: '2026-11-23', coletadoEm: '2026-11-23T00:00:00.000Z', validadoEm: '2026-11-23T00:00:00.000Z', naoConfirmado: false,
        mock: true, fonte: fonteBase(r.id.slice(-3)), quote: 'TRECHO LITERAL QUE NÃO PODE APARECER' };
    });
  return [200, { data: { ...o, mock: true, fonte: fonte(o.id.slice(-1)), relacoes, pessoas: { disponivel: false, itens: [] } } }];
}

