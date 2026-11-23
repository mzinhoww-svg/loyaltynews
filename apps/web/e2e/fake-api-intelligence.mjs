// MOCK de teste (e2e do portal, PORTAL_MODE=api): rotas públicas do Entity Intelligence. Nada aqui é real.
// GET /api/publico/intelligence/empresas[/:id] — formato de fast-track/decisoes/contrato-publico-intelligence-portal.md (MOCK).
const orgId = (n) => `10000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const fonte = (n) => ({ nome: `Fonte de teste ${n} (MOCK)`, url: `https://fonte-${n}.invalid/pagina`, coletadoEm: '2026-11-23T00:00:00.000Z' });
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

export function intelligence(u) {
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
  const o = orgs.find((x) => x.id === decodeURIComponent(m[1]));
  if (!o) return [404, { error: { code: 'NOT_FOUND', message: 'empresa não encontrada' } }];
  const relacoes = rels
    .filter((r) => r.from === o.id || r.to === o.id)
    .map((r) => {
      const other = orgs.find((x) => x.id === (r.from === o.id ? r.to : r.from));
      // `trecho`/`quote` NUNCA vêm no contrato; o campo extra aqui prova que o portal não renderiza o que recebe a mais.
      return { id: r.id, tipo: r.tipo, sentido: r.from === o.id ? 'origem' : 'destino', empresa: { id: other.id, nome: other.nome, tipo: other.tipo },
        vigenteDesde: '2026-11-23', validadoEm: '2026-11-23T00:00:00.000Z', mock: true, fonte: fonte(r.id.slice(-3)), quote: 'TRECHO LITERAL QUE NÃO PODE APARECER' };
    });
  return [200, { data: { ...o, mock: true, fonte: fonte(o.id.slice(-1)), relacoes, pessoas: { disponivel: false, itens: [] } } }];
}

