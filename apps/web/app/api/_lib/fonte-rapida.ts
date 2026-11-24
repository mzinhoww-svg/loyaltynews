// P2-05 (auditoria do Studio): cadastrar fonte e evidência dentro da Nova matéria, sem sair da tela.
// - Fonte rápida: pública, mínima (URL https, nome, tipo, licença, editoria), sempre 'a_confirmar', inativa e sem termos revisados:
//   nunca habilitada para coleta até alguém revisar (PATCH /api/fontes/:id com termosRevisados=true a confirma; o banco recusa ativar
//   fonte 'a_confirmar' — CHECK sources_a_confirmar_inativa).
// - Evidência: liga URL https + trecho (até 500 caracteres) a uma matéria EM RASCUNHO. Não busca a URL (nenhuma chamada de rede) e não
//   guarda nada além do trecho; fica 'a_confirmar' e não conta para os gates de publicação (não é uma `evidences` capturada).
// Idempotência por `chave` (texto do cliente, 8–100): a mesma chave com o mesmo conteúdo devolve o registro (200); com outro, 409.
import { createHash } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import { schema } from '@ln/db';
import { EditoriaSlug, Source } from '@ln/contracts';
import { HttpError, json, newId, readBody, type RouteFn } from './http';
import { sourceRegistry } from './editorial';

const HttpsUrl = z
  .string()
  .trim()
  .max(2000)
  .pipe(z.url())
  .refine((u) => new URL(u).protocol === 'https:', 'apenas https')
  .refine((u) => { const x = new URL(u); return !x.username && !x.password; }, 'URL sem usuário ou senha');
const Chave = z.string().trim().regex(/^[A-Za-z0-9:_.-]{8,100}$/, 'chave de 8 a 100 caracteres (letras, números, : _ . -)');
export const LICENCAS = ['aberta', 'creative_commons', 'termos_do_site', 'direitos_reservados', 'desconhecida'] as const;

export const FonteRapidaIn = z.strictObject({
  chave: Chave,
  url: HttpsUrl,
  nome: z.string().trim().min(1).max(120),
  tipo: Source.shape.tipo,
  licenca: z.enum(LICENCAS),
  editoria: EditoriaSlug,
});
export const EvidenciaIn = z.strictObject({
  chave: Chave,
  articleId: z.string().min(1).max(128),
  url: HttpsUrl,
  trecho: z.string().trim().min(1).max(500),
  sourceId: z.string().min(1).max(128).optional(),
});

const sha = (s: string) => createHash('sha256').update(s, 'utf8').digest('hex');
const canon = (u: string) => new URL(u).toString(); // normaliza host em minúsculas, porta padrão etc. (sem rede)

const fonteView = (s: typeof schema.sources.$inferSelect) => ({
  id: s.id, nome: s.nome, url: s.url, tipo: s.tipo, licenca: s.licenca, revisao: s.revisao, ativo: s.ativo, termosRevisados: s.termosRevisados, acesso: s.acesso,
});

export const createFonteRapida: RouteFn = async (req, c) => {
  const b = await readBody(req, FonteRapidaIn);
  const url = canon(b.url);
  const same = (s: typeof schema.sources.$inferSelect) => s.url === url && s.nome === b.nome && s.tipo === b.tipo && s.licenca === b.licenca;
  const [prev] = await c.deps.db.select().from(schema.sources).where(eq(schema.sources.chaveIdem, b.chave));
  if (prev) {
    if (!same(prev)) throw new HttpError(409, 'IDEMPOTENCY_MISMATCH', 'Esta chave já foi usada com outros dados.');
    return json({ data: fonteView(prev), existente: true }, 200);
  }
  // mesma URL já cadastrada (fonte confirmada ou outra fonte rápida): a tela escolhe a existente em vez de duplicar
  const [byUrl] = await c.deps.db.select({ id: schema.sources.id }).from(schema.sources).where(eq(schema.sources.url, url));
  if (byUrl) throw new HttpError(409, 'SOURCE_EXISTS', 'Já existe fonte com esta URL.', { id: byUrl.id });
  let id = `rapida-${newId().slice(0, 8)}`;
  while (sourceRegistry.get(id)) id = `rapida-${newId().slice(0, 8)}`; // id do registro da Fábrica é reservado
  try {
    await c.deps.db.transaction(async (tx) => {
      await tx.insert(schema.sources).values({
        id, nome: b.nome, url, tipo: b.tipo, acesso: 'publico', termosRevisados: false, ativo: false, origem: 'cms',
        revisao: 'a_confirmar', licenca: b.licenca, chaveIdem: b.chave, criadoPor: c.session!.userId,
      });
      await tx.insert(schema.sourceEditorias).values({ sourceId: id, editoria: b.editoria });
    });
  } catch (e) {
    // corrida com a mesma chave: a primeira gravação vence; esta devolve a que ficou (ou 409 se os dados diferem)
    const [won] = await c.deps.db.select().from(schema.sources).where(eq(schema.sources.chaveIdem, b.chave));
    if (!won) throw e;
    if (!same(won)) throw new HttpError(409, 'IDEMPOTENCY_MISMATCH', 'Esta chave já foi usada com outros dados.');
    return json({ data: fonteView(won), existente: true }, 200);
  }
  const [s] = await c.deps.db.select().from(schema.sources).where(eq(schema.sources.id, id));
  return json({ data: fonteView(s!), existente: false }, 201);
};

const evidView = (e: typeof schema.editorialEvidencias.$inferSelect) => ({
  id: e.id, articleId: e.articleId, sourceId: e.sourceId, url: e.url, trecho: e.trecho, estado: e.estado, criadoPor: e.criadoPor, criadoEm: e.criadoEm.toISOString(),
});

export const createEvidencia: RouteFn = async (req, c) => {
  const b = await readBody(req, EvidenciaIn);
  const url = canon(b.url);
  const tsha = sha(b.trecho);
  const same = (e: typeof schema.editorialEvidencias.$inferSelect) => e.articleId === b.articleId && e.url === url && e.trechoSha256 === tsha && e.sourceId === (b.sourceId ?? null);
  const [prev] = await c.deps.db.select().from(schema.editorialEvidencias).where(eq(schema.editorialEvidencias.chaveIdem, b.chave));
  if (prev) {
    if (!same(prev)) throw new HttpError(409, 'IDEMPOTENCY_MISMATCH', 'Esta chave já foi usada com outros dados.');
    return json({ data: evidView(prev), existente: true }, 200);
  }
  const [art] = await c.deps.db.select({ status: schema.articles.status }).from(schema.articles).where(eq(schema.articles.id, b.articleId));
  if (!art) throw new HttpError(404, 'NOT_FOUND', 'Matéria não encontrada.');
  if (art.status !== 'rascunho') throw new HttpError(409, 'ARTICLE_NOT_DRAFT', 'Evidência rápida só em matéria em rascunho.', { status: art.status });
  if (b.sourceId) {
    const [s] = await c.deps.db.select({ id: schema.sources.id }).from(schema.sources).where(eq(schema.sources.id, b.sourceId));
    if (!s) throw new HttpError(404, 'SOURCE_NOT_FOUND', 'Fonte não encontrada.');
  }
  const id = newId();
  const inserted = await c.deps.db
    .insert(schema.editorialEvidencias)
    .values({ id, articleId: b.articleId, sourceId: b.sourceId ?? null, url, trecho: b.trecho, trechoSha256: tsha, estado: 'a_confirmar', chaveIdem: b.chave, criadoPor: c.session!.userId, criadoEm: c.deps.now() })
    .onConflictDoNothing({ target: schema.editorialEvidencias.chaveIdem })
    .returning({ id: schema.editorialEvidencias.id });
  const [row] = await c.deps.db.select().from(schema.editorialEvidencias).where(eq(schema.editorialEvidencias.chaveIdem, b.chave));
  if (!inserted.length) {
    if (!same(row!)) throw new HttpError(409, 'IDEMPOTENCY_MISMATCH', 'Esta chave já foi usada com outros dados.');
    return json({ data: evidView(row!), existente: true }, 200);
  }
  return json({ data: evidView(row!), existente: false }, 201);
};

/** Evidências rápidas de uma matéria (para a tela listar o que já foi anotado). */
export const listEvidencias: RouteFn = async (_req, c) => {
  const articleId = c.url.searchParams.get('articleId');
  if (!articleId || articleId.length > 128) throw new HttpError(400, 'VALIDATION_ERROR', 'articleId obrigatório.');
  const rows = await c.deps.db.select().from(schema.editorialEvidencias).where(and(eq(schema.editorialEvidencias.articleId, articleId))).orderBy(schema.editorialEvidencias.criadoEm, schema.editorialEvidencias.id);
  return json({ data: rows.map(evidView), total: rows.length });
};
