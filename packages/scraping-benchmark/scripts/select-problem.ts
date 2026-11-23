/**
 * Dataset v1.2 (ressalva QA 3, M1): troca as 20 entradas "problema" (que vinham de feeds RSS) por URLs de fontes SEM feed ou
 * BLOQUEADAS, descobertas pela busca Exa (data/problem-candidates.json). Fintech 5 (1 por host) + restritivo 15 (round-robin).
 * IDs novos u201+; as trocas ficam em data/dataset-v1.2-changes.json. Categorias e totais não mudam.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

// Linhas JSON de dataset/candidatos (script de uso único; campos heterogêneos).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = Record<string, any>;
const DATA = join(dirname(fileURLToPath(import.meta.url)), '..', 'data');
const ds = JSON.parse(readFileSync(join(DATA, 'dataset.json'), 'utf8')) as Row[];
const cands = JSON.parse(readFileSync(join(DATA, 'problem-candidates.json'), 'utf8')) as Row[];
const norm = (u: string) => u.replace(/[?#].*$/, '').replace(/\/$/, '').toLowerCase();
const used = new Set(ds.filter((d) => d.recency !== 'problema').map((d) => norm(d.url)));
const looksArticle = (u: string) => {
  try {
    const p = new URL(u).pathname;
    const last = p.split('/').filter(Boolean).pop() ?? '';
    // matéria = último trecho longo com hífens (slug); listagens ('comunicados', 'sala-de-imprensa', 'mailing') ficam fora
    return last.length >= 25 && (last.match(/-/g) ?? []).length >= 3 && !/\.(pdf|jpg|png)$/i.test(p) && !/(cadastre|mailing|relatorio-anual|comunicados-e-fatos|noticias-podcasts|file-manager|central-de-resultados)/i.test(p);
  } catch {
    return false;
  }
};

function pick(category: string, n: number, perHostMax: number) {
  const pool = cands.filter((c) => c.category === category && c.title && looksArticle(c.url));
  const hosts = [...new Set(pool.map((c) => c.host))];
  const chosen: Row[] = [];
  for (let round = 0; chosen.length < n && round < perHostMax; round++)
    for (const h of hosts) {
      if (chosen.length >= n) break;
      const c = pool.filter((x) => x.host === h && !used.has(norm(x.url)))[0];
      if (!c) continue;
      used.add(norm(c.url));
      chosen.push(c);
    }
  return chosen;
}

const fin = pick('fintech', 5, 3);
const res = pick('restritivo', 15, 4);
const olds = ds.filter((d) => d.recency === 'problema');
const swaps: Array<{ out: string; in: string; host: string; feed: string }> = [];
let next = 201;
const replaceWith = (oldCat: string, list: Row[]) => {
  const slots = olds.filter((o) => o.category === oldCat);
  list.forEach((c, i) => {
    const o = slots[i];
    if (!o) return;
    const id = `u${next++}`;
    const domain = new URL(c.url).hostname.replace(/^www\./, '');
    ds[ds.indexOf(o)] = {
      id, url: c.url, domain, category: oldCat, recency: 'problema', country: c.country, language: c.language, publishedAt: c.publishedAt,
      contentType: /ri\.|bradescori|santander.*\/ri/.test(c.url) ? 'release' : 'noticia', difficulty: 'alta',
      discoveryMethod: 'exa-search', discoverySource: `exa-search site:${c.host}`, feedStatus: c.feed,
      accessCondition: 'bloqueio-tecnico', paywall: false, needsJs: c.host === 'gov.br/anpd' ? true : null,
      errorHistory: c.problem, referenceTitle: c.title, replaces: o.id,
    };
    swaps.push({ out: o.id, in: id, host: c.host, feed: c.feed });
  });
};
replaceWith('fintech', fin);
replaceWith('restritivo', res);
if (fin.length < 5 || res.length < 15) console.error(`FALTOU: fintech ${fin.length}/5, restritivo ${res.length}/15`);
writeFileSync(join(DATA, 'dataset.json'), JSON.stringify(ds, null, 2));
writeFileSync(join(DATA, 'dataset-v1.2-changes.json'), JSON.stringify({ reason: 'ressalva QA 3 (M1): problema/restritivo de fontes sem feed ou bloqueadas', swaps }, null, 2));
console.log(JSON.stringify({ trocas: swaps.length, total: ds.length, unicas: new Set(ds.map((d) => norm(d.url))).size, hosts: [...new Set(swaps.map((s) => s.host))] }));
