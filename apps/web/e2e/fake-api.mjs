// MOCK de teste: servidor mínimo que imita as rotas públicas do Backend (GET /api/publico/materias[/slug], /agenda[/id], /site),
// com o mesmo formato de apps/web/app/api/_lib/articles.ts. Só serve ao e2e do portal em PORTAL_MODE=api.
// Nenhum conteúdo aqui é real.
import http from 'node:http';
import { intelligence } from './fake-api-intelligence.mjs';

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

// Matéria com título/resumo hostis: só existe na rota de detalhe (não aparece nas listagens).
const hostil = { ...base, slug: 'api-xss', titulo: '[MOCK API] </script><script>window.__xss_titulo=1</script> Matéria hostil', resumo: 'Resumo </script><script>window.__xss_resumo=1</script> (MOCK).', tipoConteudo: 'noticia', tempoLeituraMin: 1, editoria: 'global', corpo: 'Texto de teste (MOCK).\n\nFontes:\n- https://fonte.example/mock', imagem: { url: '/api/publico/midia/xss-1', origem: 'fonte_terceiro', credito: '</script><script>window.__xss_credito=1</script>', baseDeDireito: 'licenca', edicoes: [], textoAlternativo: 'Foto </script><script>window.__xss_alt=1</script>' }, publicadoEm: '2026-11-17T10:00:00-03:00' };

const listItem = (a) => ({
  slug: a.slug, titulo: a.titulo, subtitulo: a.subtitulo, resumo: a.resumo, tipoConteudo: a.tipoConteudo,
  tempoLeituraMin: a.tempoLeituraMin, editoria: a.editoria, assinatura: a.assinatura, patrocinado: a.patrocinado,
  rotuloPublieditorial: a.rotuloPublieditorial, publicadoEm: a.publicadoEm, corrigida: Boolean(a.corrigida),
  imagem: a.imagem ? { url: a.imagem.url, textoAlternativo: a.imagem.textoAlternativo, credito: a.imagem.credito, rotulo: a.imagem.origem === 'ilustracao_gerada' ? 'Ilustração conceitual' : null } : null,
});

// Agenda (formato de apps/web/app/api/_lib/agenda.ts, publicView): datas só com dia, relativas a hoje (nunca ficam "passadas").
const day = (n) => new Date(Date.now() - 3 * 3600e3 + n * 864e5).toISOString().slice(0, 10);
const agendaEvents = [
  { id: 'ev-1', titulo: '[MOCK] Congresso publicado', inicio: day(10), fim: day(11), local: 'São Paulo (MOCK)', url: 'https://evento.example/mock', editorias: [], patrocinado: false, fonteUrl: 'https://fonte.example/evento-mock' },
  { id: 'ev-2', titulo: '[MOCK] Fórum patrocinado', inicio: day(20), fim: day(20), local: 'Rio de Janeiro (MOCK)', url: null, editorias: ['bancos'], patrocinado: true, fonteUrl: 'https://fonte.example/forum-mock' },
];
// Evento encerrado: só a rota por id (Backend: aprovado em qualquer data) o devolve; a lista pública traz só os que não terminaram.
const eventoPassado = { id: 'ev-passado', titulo: '[MOCK] Evento encerrado', inicio: day(-30), fim: day(-29), local: 'Belo Horizonte (MOCK)', url: 'https://evento.example/passado', editorias: [], patrocinado: false, fonteUrl: 'https://fonte.example/passado-mock' };
const agendaMode = process.env.FAKE_API_AGENDA ?? 'ok'; // ok | vazia

// GET /api/publico/site (formato de apps/web/app/api/_lib/site/index.ts). FAKE_API_SITE: full (padrão) | vazio | noindex | invalido | malicioso.
const siteMode = process.env.FAKE_API_SITE ?? 'full';
const siteFull = () => ({
  home: {
    versao: 2,
    blocos: [
      { tipo: 'destaque', id: 'foco', titulo: 'Em foco do dia (MOCK)', materiaSlugs: ['api-ilustracao-corrigida', 'api-foto-terceiro'], materias: [articles[0], articles[2]].map(listItem) },
      { tipo: 'lista_editoria', id: 'pontos', editoria: 'pontos', limite: 6, titulo: 'Pontos publicados (MOCK)', materias: [articles[1]].map(listItem) },
      { tipo: 'ultimas', id: 'ultimas', limite: 10, materias: articles.map(listItem) },
      {
        tipo: 'agenda',
        id: 'agenda',
        limite: 5,
        titulo: 'Agenda do Studio (MOCK)',
        eventos: [agendaEvents[0]],
      },
      { tipo: 'publicidade', id: 'pub-topo', posicao: 'TOP', dimensao: { largura: 1280, altura: 150 } },
    ],
  },
  menus: {
    principal: { itens: [{ rotulo: 'Agenda', destino: '/agenda', filhos: [] }, { rotulo: 'Parceiro MOCK', destino: 'https://parceiro.example/mock', filhos: [] }] },
    rodape: {
      itens: [
        { rotulo: 'Institucional MOCK', destino: '/sobre', filhos: [{ rotulo: 'Sobre nós', destino: '/sobre' }, { rotulo: 'Nossa metodologia', destino: '/metodologia' }] },
        { rotulo: 'Fale com a redação', destino: '/contato', filhos: [] },
      ],
    },
  },
  seo: {
    tituloPadrao: 'Loyalty News — SEO publicado (MOCK)',
    descricaoPadrao: 'Descrição publicada no Studio (MOCK).',
    imagemOgUrl: 'https://cdn.example/og-mock.png',
    indexacao: siteMode === 'noindex' ? 'noindex' : 'indexar',
    jsonLd: { '@context': 'https://schema.org', '@type': 'Organization', name: 'Loyalty News MOCK', url: 'https://loyaltynews.example', sameAs: ['https://linkedin.example/mock'] },
  },
  linksInternos: [{ termo: 'matéria corrigida', destino: '/correcoes' }],
});
// Conteúdo HOSTIL (achado do QA 4 em 4bc0f69): texto do Studio com </script> e destinos que tentam sair do portal.
// O portal nunca pode executar script nem aceitar os destinos reservados. Nenhum valor aqui é real.
const XSS = (n) => `</script><script>window.__xss_${n}=1</script>`;
const siteMalicioso = () => {
  const base = siteFull();
  return {
    ...base,
    seo: { ...base.seo, tituloPadrao: `Loyalty News ${XSS('titulo')}`.slice(0, 70), jsonLd: { '@context': 'https://schema.org', '@type': 'Organization', name: XSS('name'), url: `https://x.example/?q=${XSS('url')}#${XSS('hash')}`, logo: `https://x.example/l.png?a=${XSS('logo')}`, sameAs: [`https://y.example/?q=${XSS('sameas')}`] } },
    menus: {
      principal: { itens: [{ rotulo: 'Bom MOCK', destino: '/agenda', filhos: [] }, { rotulo: 'Dots studio', destino: '/../studio/x', filhos: [] }, { rotulo: 'Dots api', destino: '/%2e%2e/api/x', filhos: [] }, { rotulo: 'Dots next', destino: '/a/../_next/x', filhos: [] }, { rotulo: 'Cru', destino: `https://z.example/?q=${XSS('menu')}`, filhos: [{ rotulo: 'Filho dots', destino: '/%2E%2E/studio', filhos: [] }] }] },
      rodape: { itens: [{ rotulo: 'Grupo MOCK', destino: '/sobre', filhos: [{ rotulo: 'Sobre MOCK', destino: '/sobre' }, { rotulo: 'Filho studio', destino: '/./studio/y' }] }, { rotulo: 'Rodapé api', destino: '/api/x', filhos: [] }] },
    },
  };
};
const sitePayload = () =>
  siteMode === 'malicioso'
    ? { data: siteMalicioso() }
    : siteMode === 'vazio'
    ? { data: { home: null, menus: { principal: null, rodape: null }, seo: null, linksInternos: [] } }
    : siteMode === 'invalido'
      ? { data: 'isto não é a configuração do site' }
      : { data: siteFull() };

const send = (res, status, body) => {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

http
  .createServer(async (req, res) => {
    const u = new URL(req.url ?? '/', `http://localhost:${port}`);
    if (u.pathname === '/health') return send(res, 200, { ok: true });
    if (forcedStatus && u.pathname.startsWith('/api/publico/')) return send(res, forcedStatus, { error: { code: 'NOT_CONFIGURED', message: 'Banco não configurado (detalhe interno de teste).' } });
    if (u.pathname === '/api/publico/site') return send(res, 200, sitePayload());
    if (u.pathname === '/api/publico/agenda') return send(res, 200, { data: agendaMode === 'vazia' ? [] : agendaEvents });
    const ev = /^\/api\/publico\/agenda\/([^/]+)$/.exec(u.pathname);
    if (ev) {
      const id = decodeURIComponent(ev[1]);
      const found = [...agendaEvents, eventoPassado].find((e) => e.id === id);
      return found ? send(res, 200, { data: found }) : send(res, 404, { error: { code: 'NOT_FOUND', message: 'Evento não encontrado.' } });
    }
    const intel = intelligence(u);
    if (intel) return send(res, intel[0], intel[1]);
    if (u.pathname === '/api/publico/materias') {
      // Gatilhos de teste dos estados de carregando e de erro (busca): q=lento atrasa a resposta; q=falha responde 503.
      const q0 = u.searchParams.get('q');
      if (q0 === 'lento') await sleep(2500);
      if (q0 === 'falha') return send(res, 503, { error: { code: 'NOT_CONFIGURED', message: 'Banco não configurado (detalhe interno de teste).' } });
      const limit = Number(u.searchParams.get('limit') ?? 20);
      const offset = Number(u.searchParams.get('offset') ?? 0);
      const ed = u.searchParams.get('editoria');
      const q = u.searchParams.get('q')?.toLowerCase();
      const all = articles.filter((a) => (!ed || a.editoria === ed) && (!q || a.titulo.toLowerCase().includes(q)));
      return send(res, 200, { data: all.slice(offset, offset + limit).map(listItem), total: all.length, limit, offset });
    }
    const m = /^\/api\/publico\/materias\/([^/]+)$/.exec(u.pathname);
    if (m) {
      if (decodeURIComponent(m[1]) === 'api-falha') return send(res, 503, { error: { code: 'NOT_CONFIGURED', message: 'detalhe interno de teste' } });
      const a = [...articles, hostil].find((x) => x.slug === decodeURIComponent(m[1]));
      if (!a) return send(res, 404, { error: { code: 'NOT_FOUND', message: 'Matéria não encontrada.' } });
      const pub = { ...a };
      delete pub.corrigida;
      if (pub.imagem) pub.imagem = { ...pub.imagem, rotulo: pub.imagem.origem === 'ilustracao_gerada' ? 'Ilustração conceitual' : null };
      return send(res, 200, { data: pub });
    }
    return send(res, 404, { error: { code: 'NOT_FOUND' } });
  })
  .listen(port, () => console.log(`fake-api (MOCK) em http://localhost:${port}`));
