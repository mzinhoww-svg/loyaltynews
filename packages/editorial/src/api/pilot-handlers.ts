import { z } from 'zod';
import { apiError } from '@ln/contracts';
import { audit, authorize, bad, fail, isErr, ok, parse } from './common';
import type { Actor, ApiResponse, HandlerCtx } from './common';

/**
 * Piloto de 10 matérias — leitura humana (folha de leitura: fast-track/piloto/folha-de-leitura.md). Sem tabela nova: o mapa
 * matéria→artigo e as leituras ficam na trilha de auditoria do EditorialStore (somente-acréscimo):
 *   `piloto.mapped`  (alvo = a1..a10, detalhe = {articleId})  e  `piloto.leitura`  (alvo = `<materia>:<leitor>`).
 * Leitor 1 = proprietário (admin ou editor_chefe); leitor 2 = papel revisor (QA 3), só nas matérias 1, 4, 6 e 9, e sempre outra pessoa.
 * CEGUEIRA: quem ainda não registrou a própria leitura de uma matéria não vê a do outro; o adjudicador (admin/editor_chefe que não leu)
 * só vê as duas quando AMBAS existem. Nada aqui publica, aprova ou altera a matéria: só registra a leitura.
 */
export const PILOTO_MATERIAS = ['a1', 'a2', 'a3', 'a4', 'a5', 'a6', 'a7', 'a8', 'a9', 'a10'] as const;
export const PILOTO_LEITOR2 = new Set<string>(['a1', 'a4', 'a6', 'a9']);
const MAPPED = 'piloto.mapped';
const LEITURA = 'piloto.leitura';
const IMPORTADO = 'piloto.importado';
const FOLHA = 'piloto.folha_recebida';
const Materia = z.enum(PILOTO_MATERIAS);

export const ACHADO_TIPOS = ['numero', 'data', 'valor', 'nome', 'condicao', 'causa', 'atribuicao', 'citacao', 'contexto'] as const;
const Achado = z.object({
  trecho: z.string().trim().min(3).max(500),
  tipo: z.enum(ACHADO_TIPOS),
  gravidade: z.enum(['alta', 'media', 'baixa']),
  evidenciaId: z.string().min(1).max(128).optional(),
  nota: z.string().trim().max(500).optional(),
}).strict();
const LeituraIn = z.object({
  leitor: z.union([z.literal(1), z.literal(2)]),
  achados: z.array(Achado).max(50),
  checklist: z.object({ fatosNasEvidencias: z.boolean(), tom: z.boolean(), nadaInventado: z.boolean() }).strict(),
  veredito: z.enum(['aprovado', 'bloqueado']),
}).strict();
const MapaIn = z.partialRecord(Materia, z.string().min(1).max(128)).refine((m) => Object.keys(m).length > 0, { message: 'mapa vazio' });

export interface PilotoLeitura {
  materia: string; articleId: string; leitor: 1 | 2; por: string; em: string;
  /** Leitura do leitor 2 feita FORA do Studio e importada (auditada pelo hash do arquivo). */
  origem?: 'importacao'; importadoPor?: string; leitor2Nome?: string; arquivo?: { nome: string; sha256: string; linhas: number };
  achados: Array<z.infer<typeof Achado>>; checklist: z.infer<typeof LeituraIn>['checklist']; veredito: 'aprovado' | 'bloqueado';
  unsupportedFacts: number; altas: number; medias: number; baixas: number;
}
export interface FolhaRegistro { sha256: string; nome: string; linhas: number; leitor2Nome: string; materias: string[]; por: string; em: string }
export interface PilotoItem {
  materia: string; articleId: string | null; fonte: { id: string; nome: string } | null; leitor2: boolean;
  estado: 'nao_gerada' | 'aguardando_leitura' | 'leitor1_registrou' | 'leitor2_registrou' | 'lida';
  /** Só indica que o leitor registrou (nunca o conteúdo): serve à tela, não quebra a cegueira. */
  leituras: { leitor1: boolean; leitor2: boolean };
  /** Hash e data da PRIMEIRA folha do leitor 2 registrada para a matéria (só hash e data, nunca o conteúdo); null se nenhuma. */
  folha: { sha256: string; em: string } | null;
}

const isOwner = (a: Actor) => a.roles.some((r) => r === 'admin' || r === 'editor_chefe');
const isReviewer = (a: Actor) => a.roles.includes('revisor');

async function readState(ctx: HandlerCtx) {
  const log = await ctx.store.listAudit();
  const mapa = new Map<string, string>();
  const leituras: PilotoLeitura[] = [];
  const folhas: FolhaRegistro[] = [];
  for (const e of log) {
    if (e.action === FOLHA && e.detail) { try { folhas.push({ sha256: e.target, ...(JSON.parse(e.detail) as Omit<FolhaRegistro, 'sha256'>) }); } catch { /* linha inválida */ } }
    if (e.action === MAPPED && e.detail && !mapa.has(e.target)) { try { mapa.set(e.target, (JSON.parse(e.detail) as { articleId: string }).articleId); } catch { /* linha inválida */ } }
    if (e.action === LEITURA && e.detail) { try { leituras.push(JSON.parse(e.detail) as PilotoLeitura); } catch { /* linha inválida */ } }
  }
  return { mapa, leituras, folhas };
}

/** Primeira folha registrada que cobre a matéria (a que vale: prova que o arquivo não mudou depois que o leitor 1 o viu). */
const primeiraFolha = (folhas: FolhaRegistro[], materia: string): FolhaRegistro | undefined => folhas.find((x) => x.materias.includes(materia));

async function fonteOf(ctx: HandlerCtx, articleId: string) {
  const art = await ctx.store.getArticle(articleId);
  const sid = art?.evidences[0]?.sourceId;
  if (!sid) return null;
  return { id: sid, nome: ctx.sources?.get(sid)?.name ?? sid };
}

/** GET /piloto: as 10 matérias, o artigo de cada uma (null até ser gerada) e o estado da leitura. Adjudicadores veem o fechamento. */
export async function listPiloto(ctx: HandlerCtx, _input: unknown): Promise<ApiResponse<{ items: PilotoItem[]; fechamento?: Fechamento }>> {
  const a = authorize(ctx, 'piloto.read'); if (isErr(a)) return fail(a);
  const { mapa, leituras, folhas } = await readState(ctx);
  const items: PilotoItem[] = [];
  for (const m of PILOTO_MATERIAS) {
    const articleId = mapa.get(m) ?? null;
    const l1 = leituras.some((l) => l.materia === m && l.leitor === 1);
    const l2 = leituras.some((l) => l.materia === m && l.leitor === 2);
    const need2 = PILOTO_LEITOR2.has(m);
    const estado: PilotoItem['estado'] = !articleId ? 'nao_gerada' : l1 && (!need2 || l2) ? 'lida' : l1 ? 'leitor1_registrou' : l2 ? 'leitor2_registrou' : 'aguardando_leitura';
    items.push({ materia: m, articleId, fonte: articleId ? await fonteOf(ctx, articleId) : null, leitor2: need2, estado, leituras: { leitor1: l1, leitor2: l2 }, folha: (() => { const x = primeiraFolha(folhas, m); return x ? { sha256: x.sha256, em: x.em } : null; })() });
  }
  return ok({ items, ...(isOwner(a) ? { fechamento: fechamento(leituras) } : {}) });
}

export interface Fechamento {
  lidas: number; altas: number; medias: number; baixas: number; unsupportedFacts: number;
  /** Critério do PM: 0 altas e no máximo 1 média nas 10 matérias (leitor 1). `em_andamento` até as 10 terem leitura do leitor 1. */
  criterio: 'em_andamento' | 'aprovado' | 'reprovado';
  divergencias: string[];
}
export function fechamento(leituras: PilotoLeitura[]): Fechamento {
  const l1 = PILOTO_MATERIAS.map((m) => leituras.find((l) => l.materia === m && l.leitor === 1)).filter((l): l is PilotoLeitura => !!l);
  const altas = l1.reduce((n, l) => n + l.altas, 0); const medias = l1.reduce((n, l) => n + l.medias, 0); const baixas = l1.reduce((n, l) => n + l.baixas, 0);
  const divergencias: string[] = [];
  for (const m of PILOTO_LEITOR2) {
    const x = leituras.find((l) => l.materia === m && l.leitor === 1); const y = leituras.find((l) => l.materia === m && l.leitor === 2);
    if (x && y && (x.veredito !== y.veredito || x.altas !== y.altas || x.medias !== y.medias)) divergencias.push(m);
  }
  const criterio: Fechamento['criterio'] = altas > 0 || medias > 1 ? 'reprovado' : l1.length === PILOTO_MATERIAS.length ? 'aprovado' : 'em_andamento';
  return { lidas: l1.length, altas, medias, baixas, unsupportedFacts: altas + medias + baixas, criterio, divergencias };
}

/** POST /piloto/mapa: fixa matéria→artigo (admin/editor_chefe). Imutável depois de fixado; o artigo precisa existir e ser de uma só matéria. */
export async function mapPiloto(ctx: HandlerCtx, input: unknown): Promise<ApiResponse<{ mapa: Record<string, string> }>> {
  const a = authorize(ctx, 'piloto.map'); if (isErr(a)) return fail(a);
  const p = parse(MapaIn, input); if (bad(p)) return fail(p);
  const { mapa } = await readState(ctx);
  const novos = Object.entries(p.data) as Array<[string, string]>;
  const usados = new Set(mapa.values());
  const vistos = new Set<string>();
  for (const [m, id] of novos) {
    if (mapa.has(m)) return fail(apiError('CONFLICT', `${m} já está mapeada (imutável)`));
    if (usados.has(id) || vistos.has(id)) return fail(apiError('CONFLICT', `o artigo ${id} já está em outra matéria do piloto`));
    vistos.add(id);
    if (!(await ctx.store.getArticle(id))) return fail(apiError('NOT_FOUND', `artigo ${id} não encontrado`));
  }
  for (const [m, id] of novos) { await audit(ctx, a.userId, MAPPED, m, JSON.stringify({ articleId: id })); mapa.set(m, id); }
  return ok({ mapa: Object.fromEntries(mapa) }, 201);
}

/** Regras de uma leitura (as mesmas para o registro direto e para a importação): evidenciaId do artigo; "aprovado" sem alta e com checklist completo. */
function checkLeitura(d: { achados: Array<z.infer<typeof Achado>>; checklist: z.infer<typeof LeituraIn>['checklist']; veredito: 'aprovado' | 'bloqueado' }, evidenceIds: Set<string>):
  { error: ReturnType<typeof apiError> } | { altas: number; medias: number; baixas: number } {
  const semEvid = d.achados.filter((x) => x.evidenciaId && !evidenceIds.has(x.evidenciaId));
  if (semEvid.length) return { error: apiError('INVALID_INPUT', 'evidenciaId não pertence ao artigo', semEvid.map((x) => ({ path: 'achados.evidenciaId', message: x.evidenciaId! }))) };
  const altas = d.achados.filter((x) => x.gravidade === 'alta').length;
  if (d.veredito === 'aprovado' && (altas > 0 || !d.checklist.fatosNasEvidencias || !d.checklist.tom || !d.checklist.nadaInventado)) {
    return { error: apiError('INVALID_INPUT', 'veredito "aprovado" é incompatível com achado de gravidade alta ou checklist incompleto') };
  }
  const medias = d.achados.filter((x) => x.gravidade === 'media').length;
  return { altas, medias, baixas: d.achados.length - altas - medias };
}

/** POST /piloto/:materia/leitura: registra a leitura de UM leitor (uma por leitor e matéria; imutável). */
export async function registerLeitura(ctx: HandlerCtx, input: unknown): Promise<ApiResponse<{ materia: string; leitor: 1 | 2; unsupportedFacts: number; altas: number; medias: number; baixas: number }>> {
  const a = authorize(ctx, 'piloto.leitura'); if (isErr(a)) return fail(a);
  const m = parse(z.object({ materia: Materia }), input && typeof input === 'object' ? { materia: (input as Record<string, unknown>)['materia'] } : {}); if (bad(m)) return fail(m);
  const { materia: _m, ...rest } = input as Record<string, unknown>; void _m;
  const p = parse(LeituraIn, rest); if (bad(p)) return fail(p);
  const d = p.data; const materia = m.data.materia;
  if (d.leitor === 1 && !isOwner(a)) return fail(apiError('FORBIDDEN', 'o leitor 1 é o proprietário (admin ou editor-chefe)'));
  if (d.leitor === 2 && !isReviewer(a)) return fail(apiError('FORBIDDEN', 'o leitor 2 é o revisor (QA 3)'));
  if (d.leitor === 2 && !PILOTO_LEITOR2.has(materia)) return fail(apiError('INVALID_INPUT', `${materia} não tem leitor 2 (só a1, a4, a6 e a9)`));
  const { mapa, leituras } = await readState(ctx);
  const articleId = mapa.get(materia);
  if (!articleId) return fail(apiError('NOT_FOUND', `${materia} ainda não foi gerada (sem artigo mapeado)`));
  if (leituras.some((l) => l.materia === materia && l.leitor === d.leitor)) return fail(apiError('CONFLICT', `o leitor ${d.leitor} já registrou a leitura de ${materia}`));
  if (leituras.some((l) => l.materia === materia && l.por === a.userId)) return fail(apiError('CONFLICT', 'a mesma pessoa não pode ser os dois leitores da mesma matéria'));
  const art = await ctx.store.getArticle(articleId);
  if (!art) return fail(apiError('NOT_FOUND', `artigo ${articleId} não encontrado`));
  const chk = checkLeitura(d, new Set(art.evidences.map((e) => e.id)));
  if ('error' in chk) return fail(chk.error);
  const { altas, medias, baixas } = chk;
  const reg: PilotoLeitura = { materia, articleId, leitor: d.leitor, por: a.userId, em: ctx.now().toISOString(), achados: d.achados, checklist: d.checklist, veredito: d.veredito, unsupportedFacts: d.achados.length, altas, medias, baixas };
  await audit(ctx, a.userId, LEITURA, `${materia}:${d.leitor}`, JSON.stringify(reg));
  return ok({ materia, leitor: d.leitor, unsupportedFacts: reg.unsupportedFacts, altas, medias, baixas }, 201);
}

/** GET /piloto/:materia/leituras: com a regra de cegueira (ver o cabeçalho). */
export async function listLeituras(ctx: HandlerCtx, input: unknown): Promise<ApiResponse<{ materia: string; articleId: string | null; leituras: PilotoLeitura[]; ocultas: number }>> {
  const a = authorize(ctx, 'piloto.read'); if (isErr(a)) return fail(a);
  const m = parse(z.object({ materia: Materia }), input && typeof input === 'object' ? { materia: (input as Record<string, unknown>)['materia'] } : {}); if (bad(m)) return fail(m);
  const materia = m.data.materia;
  const { mapa, leituras } = await readState(ctx);
  const todas = leituras.filter((l) => l.materia === materia);
  const minha = todas.some((l) => l.por === a.userId);
  const completas = todas.some((l) => l.leitor === 1) && (!PILOTO_LEITOR2.has(materia) || todas.some((l) => l.leitor === 2));
  const adjudicador = isOwner(a) && completas;
  const vistas = todas.filter((l) => l.por === a.userId || minha || adjudicador);
  return ok({ materia, articleId: mapa.get(materia) ?? null, leituras: vistas, ocultas: todas.length - vistas.length });
}

const ImportIn = z.object({
  arquivo: z.object({ nome: z.string().trim().min(1).max(200), sha256: z.string().regex(/^[0-9a-f]{64}$/), linhas: z.number().int().min(1).max(10_000) }).strict(),
  leitor2Nome: z.string().trim().min(2).max(80),
  leituras: z.array(z.object({ materia: Materia, achados: z.array(Achado).max(50), checklist: LeituraIn.shape.checklist, veredito: z.enum(['aprovado', 'bloqueado']) }).strict()).min(1).max(PILOTO_LEITOR2.size),
}).strict();

/**
 * POST /piloto/importacao (admin/editor_chefe = o leitor 1): importa a leitura do LEITOR 2 feita fora do Studio (folha do QA 3).
 * TUDO OU NADA: se qualquer matéria for inválida nada é gravado. Cada leitura entra como leitor 2 com origem "importacao" (por = quem importou e de
 * quem é a folha; hash, nome e linhas do arquivo na trilha). CEGUEIRA: recusa (409 LEITOR1_PENDENTE) a matéria em que o leitor 1 ainda não registrou
 * a leitura dele, para que a dele esteja gravada antes de ele ver a prévia do outro. Imutável (409 se o leitor 2 daquela matéria já existe).
 * A resposta traz só as contagens, nunca o conteúdo das leituras.
 */
export async function importLeitura2(ctx: HandlerCtx, input: unknown): Promise<ApiResponse<{ importadas: Array<{ materia: string; unsupportedFacts: number; altas: number; medias: number; baixas: number }> }>> {
  const a = authorize(ctx, 'piloto.import'); if (isErr(a)) return fail(a);
  const p = parse(ImportIn, input); if (bad(p)) return fail(p);
  const d = p.data;
  const vistas = new Set<string>();
  for (const l of d.leituras) {
    if (!PILOTO_LEITOR2.has(l.materia)) return fail(apiError('INVALID_INPUT', `${l.materia} não tem leitor 2 (só a1, a4, a6 e a9)`));
    if (vistas.has(l.materia)) return fail(apiError('INVALID_INPUT', `${l.materia} repetida no arquivo`));
    vistas.add(l.materia);
  }
  const { mapa, leituras, folhas } = await readState(ctx);
  // FOLHA_DIFERENTE: já há folha registrada para a matéria com OUTRO hash (a folha mudou depois que o leitor 1 a viu)
  const diferente = d.leituras.map((l) => ({ materia: l.materia, f: primeiraFolha(folhas, l.materia) })).filter((x) => x.f && x.f.sha256 !== d.arquivo.sha256);
  if (diferente.length) return fail(apiError('CONFLICT', `FOLHA_DIFERENTE: já existe folha registrada com outro sha256 para ${diferente.map((x) => x.materia).join(', ')}`, diferente.map((x) => ({ path: x.materia, message: `FOLHA_DIFERENTE (registrada em ${x.f!.em})` }))));
  // O hash é gravado no PRIMEIRO envio, mesmo que a importação fique bloqueada (ex.: LEITOR1_PENDENTE): prova que a folha não mudou depois.
  if (!folhas.some((x) => x.sha256 === d.arquivo.sha256)) {
    await audit(ctx, a.userId, FOLHA, d.arquivo.sha256, JSON.stringify({ nome: d.arquivo.nome, linhas: d.arquivo.linhas, leitor2Nome: d.leitor2Nome, materias: d.leituras.map((l) => l.materia), por: a.userId, em: ctx.now().toISOString() }));
  }
  // o mesmo arquivo (hash) não entra duas vezes
  if ((await ctx.store.listAudit()).some((e) => e.action === IMPORTADO && e.target === d.arquivo.sha256)) return fail(apiError('CONFLICT', 'este arquivo (sha256) já foi importado'));
  const prontas: PilotoLeitura[] = [];
  const em = ctx.now().toISOString();
  for (const l of d.leituras) {
    const articleId = mapa.get(l.materia);
    if (!articleId) return fail(apiError('NOT_FOUND', `${l.materia} ainda não foi gerada (sem artigo mapeado)`));
    if (!leituras.some((x) => x.materia === l.materia && x.leitor === 1)) return fail(apiError('CONFLICT', `LEITOR1_PENDENTE: o leitor 1 ainda não registrou a leitura de ${l.materia}; registre a sua antes de importar a do leitor 2`, [{ path: l.materia, message: 'LEITOR1_PENDENTE' }]));
    if (leituras.some((x) => x.materia === l.materia && x.leitor === 2)) return fail(apiError('CONFLICT', `o leitor 2 já registrou a leitura de ${l.materia}`));
    const art = await ctx.store.getArticle(articleId);
    if (!art) return fail(apiError('NOT_FOUND', `artigo ${articleId} não encontrado`));
    const chk = checkLeitura(l, new Set(art.evidences.map((e) => e.id)));
    if ('error' in chk) return fail(apiError('INVALID_INPUT', `${l.materia}: ${chk.error.error.message}`, chk.error.error.details));
    prontas.push({
      materia: l.materia, articleId, leitor: 2, por: `importado por ${a.userId} da folha de ${d.leitor2Nome}`, em, achados: l.achados, checklist: l.checklist, veredito: l.veredito,
      unsupportedFacts: l.achados.length, altas: chk.altas, medias: chk.medias, baixas: chk.baixas,
      origem: 'importacao', importadoPor: a.userId, leitor2Nome: d.leitor2Nome, arquivo: d.arquivo,
    });
  }
  // tudo validado: grava (o arquivo primeiro, depois cada leitura)
  await audit(ctx, a.userId, IMPORTADO, d.arquivo.sha256, JSON.stringify({ nome: d.arquivo.nome, linhas: d.arquivo.linhas, leitor2Nome: d.leitor2Nome, materias: prontas.map((r) => r.materia), por: a.userId, em }));
  for (const r of prontas) await audit(ctx, a.userId, LEITURA, `${r.materia}:2`, JSON.stringify(r));
  return ok({ importadas: prontas.map((r) => ({ materia: r.materia, unsupportedFacts: r.unsupportedFacts, altas: r.altas, medias: r.medias, baixas: r.baixas })) }, 201);
}

const FolhaIn = z.object({
  arquivo: ImportIn.shape.arquivo,
  leitor2Nome: ImportIn.shape.leitor2Nome,
  materias: z.array(Materia).min(1).max(PILOTO_LEITOR2.size),
}).strict();

/**
 * POST /piloto/importacao/registro (admin/editor_chefe): grava SÓ o hash da folha do leitor 2 (nome, sha256, linhas, matérias; sem conteúdo)
 * assim que o arquivo é carregado, antes de qualquer prévia. Idempotente por sha256 (200 com o registro original); se já houver folha com OUTRO
 * hash para alguma das matérias, 409 FOLHA_DIFERENTE (a folha mudou depois do primeiro envio).
 */
export async function registerFolha(ctx: HandlerCtx, input: unknown): Promise<ApiResponse<{ registradoEm: string; sha256: string }>> {
  const a = authorize(ctx, 'piloto.import'); if (isErr(a)) return fail(a);
  const p = parse(FolhaIn, input); if (bad(p)) return fail(p);
  const d = p.data;
  for (const m of d.materias) if (!PILOTO_LEITOR2.has(m)) return fail(apiError('INVALID_INPUT', `${m} não tem leitor 2 (só a1, a4, a6 e a9)`));
  const { folhas } = await readState(ctx);
  const igual = folhas.find((x) => x.sha256 === d.arquivo.sha256);
  const diferente = d.materias.map((m) => ({ m, f: primeiraFolha(folhas, m) })).filter((x) => x.f && x.f.sha256 !== d.arquivo.sha256);
  if (diferente.length) return fail(apiError('CONFLICT', `FOLHA_DIFERENTE: já existe folha registrada com outro sha256 para ${diferente.map((x) => x.m).join(', ')}`, diferente.map((x) => ({ path: x.m, message: `FOLHA_DIFERENTE (registrada em ${x.f!.em})` }))));
  if (igual) return ok({ registradoEm: igual.em, sha256: igual.sha256 });
  const em = ctx.now().toISOString();
  await audit(ctx, a.userId, FOLHA, d.arquivo.sha256, JSON.stringify({ nome: d.arquivo.nome, linhas: d.arquivo.linhas, leitor2Nome: d.leitor2Nome, materias: d.materias, por: a.userId, em }));
  return ok({ registradoEm: em, sha256: d.arquivo.sha256 }, 201);
}
