#!/usr/bin/env node
// Prova de caixa-preta do cache do portal (só leitura; HEAD/GET sem credencial): páginas SEM pessoas têm `s-maxage=60` + stale-while-revalidate; páginas e rotas COM pessoas
// (Intelligence, Moves, sitemap) e a página de matéria/evento (até existir purge automático) ficam `no-store`. Rodar em `next start` local, no staging e na produção.
// Uso: node infra/scripts/verificar-cache-headers.mjs --url https://host [--editoria mercado] [--materia <slug>] [--evento <slug>] [--empresa <id>] [--pessoa <id>] [--move <id>]
//        [--artigo-cache]   (só DEPOIS de existir purge por caminho na correção/despublicação: passa a exigir s-maxage também em /noticia/<slug> e /agenda/<slug>)
// Regras (decisão do PM, 24/11):
//   CACHE_60S  = home, listas e editorias: `Cache-Control` com `public` e `s-maxage=60` (e `stale-while-revalidate`), sem `no-store`/`private` e SEM `Set-Cookie`.
//   NO_STORE   = tudo com pessoas e o que ainda não tem purge: o `Cache-Control` tem de conter `no-store`. Rota fora das duas listas NÃO é testada aqui: o padrão do Next para páginas dinâmicas já é no-store.
// Saída: uma linha JSON por rota + resumo. Código 0 = tudo conforme; 1 = alguma violação; 2 = uso errado.
import { parseArgs } from './lib/util.mjs';
import { pathToFileURL } from 'node:url';

export const CACHE_60S = ['/', '/noticias', '/editoria/{editoria}', '/analises', '/entrevistas', '/opiniao', '/flash', '/em-alta', '/agenda'];
export const NO_STORE = ['/noticia/{materia}', '/agenda/{evento}', '/intelligence', '/intelligence/empresas', '/intelligence/empresas/{empresa}', '/intelligence/pessoas', '/intelligence/pessoas/{pessoa}', '/moves', '/moves/{move}', '/sitemap.xml'];

/** Pura: avalia um cabeçalho Cache-Control contra a regra. `regra` = '60s' | 'no-store'. */
export function avaliar(regra, cacheControl, setCookie) {
  const cc = String(cacheControl ?? '').toLowerCase();
  if (regra === 'no-store') return /\bno-store\b/.test(cc) ? [] : [`esperado no-store, veio "${cc || '(sem Cache-Control)'}"`];
  const p = [];
  if (!/\bpublic\b/.test(cc)) p.push('falta public');
  if (!/\bs-maxage=60\b/.test(cc)) p.push('falta s-maxage=60');
  if (!/\bstale-while-revalidate=\d+/.test(cc)) p.push('falta stale-while-revalidate');
  if (/\b(no-store|private)\b/.test(cc)) p.push('tem no-store/private');
  if (setCookie) p.push('resposta com Set-Cookie não pode ir para cache compartilhado');
  return p;
}

export async function verificar({ url, valores = {}, artigoCache = false, timeout = 20000 }) {
  const base = url.replace(/\/+$/, '');
  const preencher = (r) => r.replace(/\{(\w+)\}/g, (_, k) => encodeURIComponent(valores[k] ?? 'x'));
  const itens = [
    ...CACHE_60S.map((r) => ({ rota: r, regra: '60s' })),
    ...NO_STORE.map((r) => ({ rota: r, regra: artigoCache && /^\/(noticia|agenda)\/\{/.test(r) ? '60s' : 'no-store' })),
  ];
  const resultados = [];
  for (const { rota, regra } of itens) {
    const caminho = preencher(rota);
    try {
      const r = await fetch(base + caminho, { method: 'HEAD', redirect: 'manual', signal: AbortSignal.timeout(timeout), headers: { 'user-agent': 'ln-cache-check/1' } });
      const problemas = avaliar(regra, r.headers.get('cache-control'), r.headers.get('set-cookie'));
      resultados.push({ rota: caminho, regra, status: r.status, ok: problemas.length === 0, ...(problemas.length ? { problemas } : {}) });
    } catch (e) {
      resultados.push({ rota: caminho, regra, ok: false, problemas: [`a sonda falhou (${e?.name ?? 'Erro'})`] });
    }
  }
  return { url: base, total: resultados.length, violacoes: resultados.filter((x) => !x.ok).length, resultados };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = parseArgs(process.argv.slice(2));
  const url = String(args.url ?? '');
  if (!/^https:\/\/|^http:\/\/127\.0\.0\.1[:/]/.test(url)) { console.error('use --url https://host'); process.exit(2); }
  const v = (k) => (args[k] && args[k] !== true ? String(args[k]) : undefined);
  const r = await verificar({ url, valores: { editoria: v('editoria') ?? 'mercado', materia: v('materia'), evento: v('evento'), empresa: v('empresa'), pessoa: v('pessoa'), move: v('move') }, artigoCache: Boolean(args['artigo-cache']) });
  for (const x of r.resultados) console.log(JSON.stringify(x));
  console.log(JSON.stringify({ resumo: true, total: r.total, violacoes: r.violacoes }));
  process.exit(r.violacoes ? 1 : 0);
}
