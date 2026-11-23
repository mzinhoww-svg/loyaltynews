// MOCK de teste: servidor mínimo que imita as rotas públicas do Backend (GET /api/publico/materias[/slug]),
// com o mesmo formato de apps/web/app/api/_lib/articles.ts. Só serve ao e2e do portal em PORTAL_MODE=api.
// Nenhum conteúdo aqui é real.
import http from 'node:http';

const port = Number(process.env.FAKE_API_PORT ?? 3104);
// FAKE_API_STATUS=503 simula a API pública sem banco (NOT_CONFIGURED) ou com erro: toda rota /api/publico responde esse status.
const forcedStatus = Number(process.env.FAKE_API_STATUS ?? 0);

const corpoCorrigido =
  'Parágrafo de teste da matéria corrigida (MOCK).\n\n## Subtítulo de teste\n\nSegundo parágrafo de teste (MOCK).\n\nAvisos:\n- Corrigimos o valor citado (MOCK).\n  Segunda linha do aviso.\n\nFontes:\n- https://fonte.example/mock';

const base = {
  subtitulo: null,
  assinatura: 'Redação Loyalty News',
  patrocinado: false,
  rotuloPublieditorial: null,
  fontes: [{ sourceId: 's1', url: 'https://www.fonte.example/mock', capturadoEm: '2026-11-19T10:00:00-03:00', sha256: 'a'.repeat(64) }],
  erratas: [],
};

const articles = [
  {
    ...base,
    slug: 'api-ilustracao-corrigida',
    titulo: '[MOCK API] Matéria com ilustração conceitual e errata',
    resumo: 'Resumo de teste (MOCK).',
    tipoConteudo: 'analise',
    tempoLeituraMin: 2,
    editoria: 'bancos',
    corpo: corpoCorrigido,
    imagem: {
      url: '/api/publico/midia/ilustracao-1',
      origem: 'ilustracao_gerada',
      credito: 'Loyalty News',
      baseDeDireito: 'gerada_ia',
      edicoes: [],
      textoAlternativo: 'Ilustração conceitual: cena abstrata de teste',
    },
    publicadoEm: '2026-11-20T10:00:00-03:00',
    erratas: [{ nota: 'Corrigimos o valor citado (MOCK).\nSegunda linha do aviso.', em: '2026-11-21T09:00:00-03:00' }],
    corrigida: true,
  },
  {
    ...base,
    slug: 'api-sem-imagem',
    titulo: '[MOCK API] Matéria cuja imagem venceu (imagem null)',
    resumo: 'Resumo de teste sem imagem (MOCK).',
    tipoConteudo: 'noticia',
    tempoLeituraMin: 1,
    editoria: 'pontos',
    corpo: 'Texto simples de teste (MOCK).\n\nFontes:\n- https://fonte.example/mock',
    imagem: null,
    publicadoEm: '2026-11-19T10:00:00-03:00',
  },
  {
    ...base,
    slug: 'api-foto-terceiro',
    titulo: '[MOCK API] Matéria com foto de terceiro',
    resumo: 'Resumo de teste com foto (MOCK).',
    tipoConteudo: 'flash',
    tempoLeituraMin: 1,
    editoria: 'bancos',
    corpo: 'Texto de teste com foto (MOCK).\n\nFontes:\n- https://fonte.example/mock',
    imagem: {
      url: '/api/publico/midia/foto-1',
      origem: 'fonte_terceiro',
      credito: 'Agência de teste (MOCK)',
      link: 'https://agencia.example/mock',
      baseDeDireito: 'licenca',
      edicoes: [],
      textoAlternativo: 'Foto de teste (MOCK)',
    },
    publicadoEm: '2026-11-18T10:00:00-03:00',
  },
];

const listItem = (a) => ({
  slug: a.slug, titulo: a.titulo, subtitulo: a.subtitulo, resumo: a.resumo, tipoConteudo: a.tipoConteudo,
  tempoLeituraMin: a.tempoLeituraMin, editoria: a.editoria, assinatura: a.assinatura, patrocinado: a.patrocinado,
  rotuloPublieditorial: a.rotuloPublieditorial, publicadoEm: a.publicadoEm, corrigida: Boolean(a.corrigida),
  imagem: a.imagem ? { url: a.imagem.url, textoAlternativo: a.imagem.textoAlternativo, credito: a.imagem.credito, rotulo: a.imagem.origem === 'ilustracao_gerada' ? 'Ilustração conceitual' : null } : null,
});

const send = (res, status, body) => {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
};

// MOCK de GET /api/commercial/mediakit (formato do handler getMediaKit do @ln/commercial). Só para o e2e do portal em modo api.
const unavailable = (label, source) => ({ label, value: null, state: 'unavailable', source });
const MEDIAKIT = {
  generatedAt: '2026-12-05T12:00:00-03:00',
  // cobertura coletada: a de 30 dias é real; a de 90 dias vem marcada como demonstração (seed de staging) e NUNCA pode virar número
  coverage: [
    { id: 'articles_published_30d', label: 'Matérias publicadas (30 dias)', value: '12', state: 'ok', source: 'CMS', window: '05/11/2026 a 04/12/2026', collectedAt: '2026-12-05T08:00:00-03:00' },
    { id: 'articles_published_90d', label: '[DEMO · staging] Matérias publicadas (90 dias)', value: '20', state: 'ok', source: 'CMS', window: '05/09/2026 a 04/12/2026', collectedAt: '2026-12-05T08:00:00-03:00', demo: true },
    unavailable('Eventos futuros', 'CMS'),
  ],
  audience: {
    realtime: [unavailable('Usuários ativos agora (últimos 30 min)', 'GA4 (tempo real)')],
    historical: [
      { label: 'Sessões (30 dias)', value: '1.234', state: 'ok', source: 'GA4', window: '05/11/2026 a 04/12/2026', collectedAt: '2026-12-05T08:00:00-03:00' },
      unavailable('Usuários ativos (30 dias)', 'GA4'),
    ],
  },
  blocks: {
    catalogo: {
      formats: [
        { id: 'banners--banner-topo', section: 'Banners', name: 'Banner topo', price: 'R$ 3.000/mês', scope: '1280 × 150; 4 cotas; mínimo 3 meses', status: 'sob_consulta' },
        { id: 'banners--retangulo-sidebar', section: 'Banners', name: 'Retângulo sidebar', price: 'R$ 1.750/mês', scope: '336 × 280; 3 posições; 10 cotas por posição', status: 'sob_consulta' },
        { id: 'the-loyal--banner-meio', section: 'The Loyal', name: 'Banner meio', price: 'R$ 1.250/mês', scope: 'Todas as edições contratadas', status: 'indisponivel' },
      ],
    },
  },
  deliveryIntegrity: { gaps: [], note: null },
};

http
  .createServer((req, res) => {
    const u = new URL(req.url ?? '/', `http://localhost:${port}`);
    if (u.pathname === '/health') return send(res, 200, { ok: true });
    if (u.pathname === '/api/commercial/mediakit') {
      if (forcedStatus) return send(res, forcedStatus, { error: { code: 'NOT_CONFIGURED', message: 'Banco não configurado (detalhe interno de teste).' } });
      return send(res, 200, MEDIAKIT);
    }
    if (forcedStatus && u.pathname.startsWith('/api/publico/')) return send(res, forcedStatus, { error: { code: 'NOT_CONFIGURED', message: 'Banco não configurado (detalhe interno de teste).' } });
    if (u.pathname === '/api/publico/materias') {
      const limit = Number(u.searchParams.get('limit') ?? 20);
      const offset = Number(u.searchParams.get('offset') ?? 0);
      const ed = u.searchParams.get('editoria');
      const q = u.searchParams.get('q')?.toLowerCase();
      const all = articles.filter((a) => (!ed || a.editoria === ed) && (!q || a.titulo.toLowerCase().includes(q)));
      return send(res, 200, { data: all.slice(offset, offset + limit).map(listItem), total: all.length, limit, offset });
    }
    const m = /^\/api\/publico\/materias\/([^/]+)$/.exec(u.pathname);
    if (m) {
      const a = articles.find((x) => x.slug === decodeURIComponent(m[1]));
      if (!a) return send(res, 404, { error: { code: 'NOT_FOUND', message: 'Matéria não encontrada.' } });
      const pub = { ...a };
      delete pub.corrigida;
      if (pub.imagem) pub.imagem = { ...pub.imagem, rotulo: pub.imagem.origem === 'ilustracao_gerada' ? 'Ilustração conceitual' : null };
      return send(res, 200, { data: pub });
    }
    return send(res, 404, { error: { code: 'NOT_FOUND' } });
  })
  .listen(port, () => console.log(`fake-api (MOCK) em http://localhost:${port}`));
