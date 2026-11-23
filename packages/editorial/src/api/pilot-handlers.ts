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
  achados: Array<z.infer<typeof Achado>>; checklist: z.infer<typeof LeituraIn>['checklist']; veredito: 'aprovado' | 'bloqueado';
  unsupportedFacts: number; altas: number; medias: number; baixas: number;
}
export interface PilotoItem {
  materia: string; articleId: string | null; fonte: { id: string; nome: string } | null; leitor2: boolean;
  estado: 'nao_gerada' | 'aguardando_leitura' | 'leitor1_registrou' | 'leitor2_registrou' | 'lida';
  /** Só indica que o leitor registrou (nunca o conteúdo): serve à tela, não quebra a cegueira. */
  leituras: { leitor1: boolean; leitor2: boolean };
}

const isOwner = (a: Actor) => a.roles.some((r) => r === 'admin' || r === 'editor_chefe');
const isReviewer = (a: Actor) => a.roles.includes('revisor');

async function readState(ctx: HandlerCtx) {
  const log = await ctx.store.listAudit();
  const mapa = new Map<string, string>();
  const leituras: PilotoLeitura[] = [];
  for (const e of log) {
    if (e.action === MAPPED && e.detail && !mapa.has(e.target)) { try { mapa.set(e.target, (JSON.parse(e.detail) as { articleId: string }).articleId); } catch { /* linha inválida */ } }
    if (e.action === LEITURA && e.detail) { try { leituras.push(JSON.parse(e.detail) as PilotoLeitura); } catch { /* linha inválida */ } }
  }
  return { mapa, leituras };
}

async function fonteOf(ctx: HandlerCtx, articleId: string) {
  const art = await ctx.store.getArticle(articleId);
  const sid = art?.evidences[0]?.sourceId;
  if (!sid) return null;
  return { id: sid, nome: ctx.sources?.get(sid)?.name ?? sid };
}

/** GET /piloto: as 10 matérias, o artigo de cada uma (null até ser gerada) e o estado da leitura. Adjudicadores veem o fechamento. */
export async function listPiloto(ctx: HandlerCtx, _input: unknown): Promise<ApiResponse<{ items: PilotoItem[]; fechamento?: Fechamento }>> {
  const a = authorize(ctx, 'piloto.read'); if (isErr(a)) return fail(a);
  const { mapa, leituras } = await readState(ctx);
  const items: PilotoItem[] = [];
  for (const m of PILOTO_MATERIAS) {
    const articleId = mapa.get(m) ?? null;
    const l1 = leituras.some((l) => l.materia === m && l.leitor === 1);
    const l2 = leituras.some((l) => l.materia === m && l.leitor === 2);
    const need2 = PILOTO_LEITOR2.has(m);
    const estado: PilotoItem['estado'] = !articleId ? 'nao_gerada' : l1 && (!need2 || l2) ? 'lida' : l1 ? 'leitor1_registrou' : l2 ? 'leitor2_registrou' : 'aguardando_leitura';
    items.push({ materia: m, articleId, fonte: articleId ? await fonteOf(ctx, articleId) : null, leitor2: need2, estado, leituras: { leitor1: l1, leitor2: l2 } });
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
  const evs = new Set(art.evidences.map((e) => e.id));
  const semEvid = d.achados.filter((x) => x.evidenciaId && !evs.has(x.evidenciaId));
  if (semEvid.length) return fail(apiError('INVALID_INPUT', 'evidenciaId não pertence ao artigo', semEvid.map((x) => ({ path: 'achados.evidenciaId', message: x.evidenciaId! }))));
  const altas = d.achados.filter((x) => x.gravidade === 'alta').length;
  if (d.veredito === 'aprovado' && (altas > 0 || !d.checklist.fatosNasEvidencias || !d.checklist.tom || !d.checklist.nadaInventado)) {
    return fail(apiError('INVALID_INPUT', 'veredito "aprovado" é incompatível com achado de gravidade alta ou checklist incompleto'));
  }
  const medias = d.achados.filter((x) => x.gravidade === 'media').length; const baixas = d.achados.length - altas - medias;
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
