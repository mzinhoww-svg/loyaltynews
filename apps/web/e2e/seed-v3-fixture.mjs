// Fixture derivada da SEED REAL v3 (packages/intelligence/data/seed.public.v3.json) no formato da API pública
// (apps/web/app/api/_lib/intelligence/publico.ts). Serve para o e2e do portal rodar com o CONJUNTO REAL do staging
// (29 organizações, 28 vínculos declarados) sem depender de acesso ao banco nem inventar conteúdo.
//
// O que é real aqui: nome/razão social, tipo, vínculos, fonte (nome e URL https) — tudo lido da seed.
// O que é derivado: a data de coleta vem de seed.public.v3.verification.json (fetched_at da fonte), a MESMA regra do
// carregador (packages/intelligence/src/seed-load.ts: retrieved_at = fetched_at; valid_from/validated_at = data da
// evidência). Nenhuma data é inventada: se uma fonte da seed não tiver fetched_at verificado, o módulo FALHA em vez de
// preencher um valor plausível. IDs são UUIDs determinísticos derivados da chave da seed (mesma chave = mesmo id).
//
// Citação (`quote`) nunca entra na fixture: o contrato público não publica trecho literal.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const RAIZ = path.resolve(HERE, '../../..');
const SEED = path.join(RAIZ, 'packages/intelligence/data/seed.public.v3.json');
const VERIFICACAO = path.join(RAIZ, 'packages/intelligence/data/seed.public.v3.verification.json');

const uuid = (chave) => {
  const h = createHash('sha1').update(`seed.public.v3:${chave}`).digest('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}`;
};

let cache = null;

/** Prova do vínculo como a rota real a devolve (api/_lib/intelligence/publico.ts): fonte sem data aninhada; datas no topo. */
const prova = (ev) => ({
  fonte: { nome: ev.nome, url: ev.url }, coletadoEm: ev.coletadoEm, validadoEm: ev.coletadoEm, naoConfirmado: false,
});

/** Monta { orgs, relacoes } no formato de detalhe da API pública, na ordem de nome que a API usa. */
export function seedV3() {
  if (cache) return cache;
  const ds = JSON.parse(readFileSync(SEED, 'utf8'));
  const ver = JSON.parse(readFileSync(VERIFICACAO, 'utf8'));
  const fonte = new Map(ds.sources.map((s) => [s.id, s]));
  const coletadoEm = new Map(ver.sources.map((s) => [s.id, s.fetched_at]));

  const fonteDe = (sourceId) => {
    const s = fonte.get(sourceId);
    const quando = coletadoEm.get(sourceId);
    if (!s || !quando) {
      throw new Error(`fixture seed v3: fonte "${sourceId}" sem URL ou sem fetched_at verificado — não invento data`);
    }
    return { nome: s.name, url: s.url, coletadoEm: quando };
  };

  const porKey = new Map();
  const orgs = ds.organizations.map((o) => {
    const ev = fonteDe(o.sourceId);
    const org = {
      id: uuid(`org:${o.key}`),
      nome: o.legalName,
      nomeLegal: o.legalName,
      tipo: o.kind,
      mock: false,
      fonte: ev,
      relacoes: [],
      pessoas: { disponivel: false, itens: [] },
    };
    porKey.set(o.key, org);
    return org;
  });

  for (const r of ds.relations) {
    const de = porKey.get(r.from);
    const para = porKey.get(r.to);
    if (!de || !para) throw new Error(`fixture seed v3: vínculo ${r.from} → ${r.to} aponta organização inexistente`);
    const ev = fonteDe(r.sourceId);
    // seed-load.ts usa a data da evidência como vigência e validação declarada (não há coluna própria na seed).
    const dia = ev.coletadoEm.slice(0, 10);
    const id = uuid(`rel:${r.from}>${r.to}:${r.type}`);
    de.relacoes.push({
      id, tipo: r.type, sentido: 'origem', empresa: { id: para.id, nome: para.nome, tipo: para.tipo },
      vigenteDesde: dia, ...prova(ev), mock: false,
    });
    para.relacoes.push({
      id, tipo: r.type, sentido: 'destino', empresa: { id: de.id, nome: de.nome, tipo: de.tipo },
      vigenteDesde: dia, ...prova(ev), mock: false,
    });
  }

  orgs.sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR') || a.id.localeCompare(b.id));
  cache = { orgs, totalOrganizacoes: ds.organizations.length, totalRelacoes: ds.relations.length, datasetId: ds.datasetId };
  return cache;
}

/** Item da lista: sem as relações, com a contagem de vínculos (como o SELECT da rota real). */
export function itemLista(org) {
  return {
    id: org.id, nome: org.nome, nomeLegal: org.nomeLegal, tipo: org.tipo,
    relacoes: org.relacoes.length, validadoEm: org.fonte.coletadoEm, mock: org.mock,
  };
}

/** Resposta de GET /api/publico/intelligence/empresas?q=&tipo=&limit=&offset= (envelope data/total/tipos). */
export function listaEmpresas({ q, tipo, limit = 100, offset = 0 } = {}) {
  const { orgs } = seedV3();
  const termo = (q ?? '').trim().toLowerCase();
  const porTermo = orgs.filter((o) => !termo || o.nome.toLowerCase().includes(termo) || o.nomeLegal.toLowerCase().includes(termo));
  const tipos = [...new Set(porTermo.map((o) => o.tipo))].sort().map((t) => ({ tipo: t, total: porTermo.filter((o) => o.tipo === t).length }));
  const filtrados = porTermo.filter((o) => !tipo || o.tipo === tipo);
  const pagina = filtrados.slice(offset, offset + limit).map(itemLista);
  return { data: pagina, total: filtrados.length, tipos };
}

/** Corpo de GET /api/publico/intelligence/empresas/:id, ou null para 404. */
export function empresaDetalhe(id) {
  const org = seedV3().orgs.find((o) => o.id === id);
  return org ? { data: org } : null;
}
