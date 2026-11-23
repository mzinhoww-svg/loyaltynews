import type { FullConfig } from '@playwright/test';

/**
 * Aquecimento global do `next dev` (e2e do portal).
 * Causa: o servidor de desenvolvimento compila cada rota na primeira visita; com workers em paralelo, o `page.goto` do
 * navegador é abortado (net::ERR_ABORTED) ou estoura o timeout enquanto compila. Aqui toda rota do portal é visitada UMA vez,
 * em sequência, esperando a resposta 200 (um pedido por rota, sem retry): quando os testes navegam, tudo já está compilado.
 * Não muda o que nenhum teste verifica. Falha com a rota e o status se alguma não responder 200.
 */
const mode = process.env.PORTAL_MODE ?? 'empty';

const EDITORIAS = ['mercado', 'programas', 'pontos', 'bancos', 'varejo', 'travel', 'tech', 'crm', 'global', 'regulacao'];
const DOCS = ['sobre', 'metodologia', 'politica-editorial', 'correcoes', 'privacidade', 'termos', 'publicidade', 'contato'];
const COMUNS = [
  '/', '/noticias', '/noticias?page=2', '/busca', '/busca?q=teste', '/agenda', '/em-alta', '/flash', '/analises', '/entrevistas', '/opiniao',
  '/moves', '/intelligence', '/intelligence/empresas', '/intelligence/pessoas', '/indicadores', '/podcast', '/the-loyal', '/midia-kit', '/anuncie',
  ...EDITORIAS.map((e) => `/editoria/${e}`),
  ...DOCS.map((d) => `/${d}`),
];
// Matérias e eventos que existem só nas fontes de teste (a fonte vazia não tem nenhum).
const POR_MODO: Record<string, string[]> = {
  mock: ['/noticia/mock-mercado-1', '/noticia/mock-mercado-2', '/noticia/mock-programas-1', '/noticia/mock-bancos-1', '/agenda/mock-evento-1'],
  api: ['/noticia/api-ilustracao-corrigida', '/noticia/api-foto-terceiro', '/noticia/api-sem-imagem'],
  empty: [],
};

export default async function globalSetup(config: FullConfig) {
  // API fora do ar (PORTAL_API_DOWN): as páginas respondem 503 por desenho; não há o que aquecer com 200.
  if (mode === 'api' && process.env.PORTAL_API_DOWN) return;
  const base = (config.projects[0]?.use.baseURL ?? process.env.PORTAL_BASE_URL ?? '').replace(/\/$/, '');
  if (!base) return;
  for (const rota of [...COMUNS, ...(POR_MODO[mode] ?? [])]) {
    const r = await fetch(base + rota, { signal: AbortSignal.timeout(180_000), redirect: 'follow' });
    await r.arrayBuffer();
    if (r.status !== 200) throw new Error(`aquecimento: ${rota} respondeu ${r.status} (esperado 200)`);
  }
}
