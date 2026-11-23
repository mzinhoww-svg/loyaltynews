// MOCK — implementa EM MEMÓRIA do processo o contrato fast-track/contratos/fonte-rapida-evidencia-api.md (Backend 3) enquanto as rotas reais
// não entram no ft/studio. Só existe no build de e2e (alias @ln-studio/e2e-backend); o build de produção nunca o inclui (e2e-backend.prod.ts
// exporta nulo) e chama o Backend de verdade. Quando o SHA real do Backend 3 entrar, este arquivo sai e o e2e roda contra as rotas reais.
// A matéria é conferida no banco de e2e (rascunho ou não); nada é buscado na rede.
import { randomBytes, randomUUID } from 'node:crypto';
import { EDITORIAS } from '@ln/contracts';
import { criarClientePglite } from './dev-db.e2e.mock';

const TIPOS = ['site', 'rss', 'api', 'comunicado'];
const LICENCAS = ['aberta', 'creative_commons', 'termos_do_site', 'direitos_reservados', 'desconhecida'];
const CHAVE = /^[A-Za-z0-9:_.-]{8,100}$/;

interface Estado {
  fontes: Map<string, Record<string, unknown>>;
  porUrl: Map<string, string>;
  chaves: Map<string, { assinatura: string; registro: Record<string, unknown> }>;
  evidencias: Record<string, unknown>[];
}
const KEY = Symbol.for('ln.studio.e2e.fonteRapida');
const estado = (): Estado => {
  const g = globalThis as unknown as Record<symbol, Estado | undefined>;
  return (g[KEY] ??= { fontes: new Map(), porUrl: new Map(), chaves: new Map(), evidencias: [] });
};

const resp = (status: number, corpo: unknown): Response => new Response(JSON.stringify(corpo), { status, headers: { 'content-type': 'application/json' } });
const erro = (status: number, code: string, message: string, details?: unknown): Response => resp(status, { error: { code, message, ...(details ? { details } : {}), requestId: 'mock' } });
const invalido = (campo: string, mensagem: string): Response => erro(400, 'VALIDATION_ERROR', 'Entrada inválida.', [{ path: campo, message: mensagem }]);

function httpsLimpa(v: unknown): string | null {
  if (typeof v !== 'string' || v.length > 2000) return null;
  try {
    const u = new URL(v);
    if (u.protocol !== 'https:' || u.username || u.password) return null;
    return u.toString();
  } catch {
    return null;
  }
}

function estrito(corpo: Record<string, unknown>, permitidos: string[]): Response | null {
  const extra = Object.keys(corpo).find((k) => !permitidos.includes(k));
  return extra ? invalido(extra, 'Unrecognized key') : null;
}

async function lerCorpo(req: Request): Promise<Record<string, unknown> | null> {
  const x: unknown = await req.json().catch(() => null);
  return x && typeof x === 'object' && !Array.isArray(x) ? (x as Record<string, unknown>) : null;
}

function idempotente(chave: string, assinatura: string): Response | { existe: Record<string, unknown> } | null {
  const e = estado().chaves.get(chave);
  if (!e) return null;
  return e.assinatura === assinatura ? { existe: e.registro } : erro(409, 'IDEMPOTENCY_MISMATCH', 'A chave já foi usada com outros dados.');
}

export async function despacharFonteRapida(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const metodo = req.method.toUpperCase();
  const e = estado();

  if (metodo === 'POST' && url.pathname.endsWith('/fontes/rapida')) {
    const c = await lerCorpo(req);
    if (!c) return invalido('corpo', 'Invalid input');
    const extra = estrito(c, ['chave', 'url', 'nome', 'tipo', 'licenca', 'editoria']);
    if (extra) return extra;
    if (typeof c.chave !== 'string' || !CHAVE.test(c.chave)) return invalido('chave', 'Invalid string: must match pattern');
    const u = httpsLimpa(c.url);
    if (!u) return invalido('url', 'Invalid URL');
    const nome = typeof c.nome === 'string' ? c.nome.trim() : '';
    if (nome.length < 1 || nome.length > 120) return invalido('nome', 'Too small: expected string to have >=1 characters');
    if (typeof c.tipo !== 'string' || !TIPOS.includes(c.tipo)) return invalido('tipo', 'Invalid option');
    if (typeof c.licenca !== 'string' || !LICENCAS.includes(c.licenca)) return invalido('licenca', 'Invalid option');
    if (typeof c.editoria !== 'string' || !EDITORIAS.some((x) => x.slug === c.editoria)) return invalido('editoria', 'Invalid option');
    const assinatura = JSON.stringify([u, nome, c.tipo, c.licenca, c.editoria]);
    const rep = idempotente(c.chave, assinatura);
    if (rep instanceof Response) return rep;
    if (rep) return resp(200, { data: rep.existe, existente: true });
    const jaTem = e.porUrl.get(u);
    if (jaTem) return erro(409, 'SOURCE_EXISTS', 'Já existe fonte com esta URL.', { id: jaTem });
    const fonte = { id: `rapida-${randomBytes(4).toString('hex')}`, nome, url: u, tipo: c.tipo, licenca: c.licenca, revisao: 'a_confirmar', ativo: false, termosRevisados: false, acesso: 'publico' };
    e.fontes.set(fonte.id, fonte);
    e.porUrl.set(u, fonte.id);
    e.chaves.set(c.chave, { assinatura, registro: fonte });
    return resp(201, { data: fonte, existente: false });
  }

  if (metodo === 'POST' && url.pathname.endsWith('/evidencias')) {
    const c = await lerCorpo(req);
    if (!c) return invalido('corpo', 'Invalid input');
    const extra = estrito(c, ['chave', 'articleId', 'url', 'trecho', 'sourceId']);
    if (extra) return extra;
    if (typeof c.chave !== 'string' || !CHAVE.test(c.chave)) return invalido('chave', 'Invalid string: must match pattern');
    if (typeof c.articleId !== 'string' || !c.articleId) return invalido('articleId', 'Required');
    const u = httpsLimpa(c.url);
    if (!u) return invalido('url', 'Invalid URL');
    const trecho = typeof c.trecho === 'string' ? c.trecho.trim() : '';
    if (trecho.length < 1) return invalido('trecho', 'Too small: expected string to have >=1 characters');
    if (trecho.length > 500) return invalido('trecho', 'Too big: expected string to have <=500 characters');
    const assinatura = JSON.stringify([c.articleId, u, trecho, c.sourceId ?? null]);
    const rep = idempotente(c.chave, assinatura);
    if (rep instanceof Response) return rep;
    if (rep) return resp(200, { data: rep.existe, existente: true });
    const client = (await criarClientePglite()) as unknown as { query: (sql: string, p: unknown[]) => Promise<{ rows: { status: string }[] }> };
    const art = (await client.query('SELECT status FROM articles WHERE id = $1', [c.articleId])).rows[0];
    if (!art) return erro(404, 'NOT_FOUND', 'Matéria não encontrada.');
    if (art.status !== 'rascunho') return erro(409, 'ARTICLE_NOT_DRAFT', 'Só matéria em rascunho recebe evidência.');
    if (typeof c.sourceId === 'string' && !e.fontes.has(c.sourceId)) return erro(404, 'SOURCE_NOT_FOUND', 'Fonte não encontrada.');
    const ev = { id: randomUUID(), articleId: c.articleId, sourceId: typeof c.sourceId === 'string' ? c.sourceId : null, url: u, trecho, estado: 'a_confirmar', criadoPor: 'mock-e2e', criadoEm: new Date().toISOString() };
    e.evidencias.push(ev);
    e.chaves.set(c.chave, { assinatura, registro: ev });
    return resp(201, { data: ev, existente: false });
  }

  if (metodo === 'GET' && url.pathname.endsWith('/evidencias')) {
    const articleId = url.searchParams.get('articleId');
    if (!articleId) return invalido('articleId', 'Required');
    const lista = e.evidencias.filter((x) => x.articleId === articleId);
    return resp(200, { data: lista, total: lista.length });
  }

  return erro(404, 'NOT_FOUND', 'Rota inexistente.');
}
