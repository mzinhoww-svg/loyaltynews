// MOCK — executa o ENSAIO do piloto em dry-run: 5 fontes do checklist (cadastro real, habilitação SIMULADA em memória), web simulada,
// 10 matérias roteirizadas, todos os gates reais da Fábrica, nenhuma rede e nenhum modelo. Só o teste e o gerador do relatório usam.
import { Collector } from '../src/collector/collector';
import { InMemoryEditorialStore } from '../src/api/store';
import type { HandlerCtx, Actor } from '../src/api/handlers';
import { reviewSource, setSourceEnabled } from '../src/api/source-handlers';
import { applyPublication } from '../src/api/publication';
import { runFactory } from '../src/factory/run';
import { InMemoryAuditLog } from '../src/pipeline/stages';
import type { PilotRowSink, PilotRowPatch } from '../src/pipeline/pilot-sink';
import { SourceRegistry } from '../src/sources/registry';
import { SEED_SOURCES } from '../src/sources/seed';
import { FACTORY_PROMPT_VERSION } from '../src/factory/prompts';
import {
  checkAnchoring, checkAttribution, checkAutoral, checkBodyGrounding, checkClaims, checkEvidenceTrust, checkImage, checkNoFabricatedReporting,
  checkNotices, checkOriginality, checkPublishable, checkSignature, checkToneBlocking, isSimulatedContent,
} from '../src/rules/rules';
import type { Draft, Evidence } from '../src/types';
import { COLLECT_ON } from './mock-web.mock';
import { DRYRUN_PAGES, DRYRUN_SOURCE_IDS, RehearsalGateway, TimedMockFetcher, dryrunResolver, dryrunRoutes } from './piloto-dryrun.mock';
import type { ScenarioKind } from './piloto-dryrun.mock';

export const DRYRUN_NOW = '2026-11-26T12:00:00.000Z';

/** O que cada cenário DEVE produzir (o ensaio falha se o gate real divergir). */
export const EXPECTED: Record<ScenarioKind, { status: 'aprovado' | 'bloqueado'; blockers: string[]; finding: string | null }> = {
  limpa: { status: 'aprovado', blockers: [], finding: null },
  copia_literal: { status: 'bloqueado', blockers: ['copy_literal'], finding: 'copy_literal' },
  numero_sem_fonte: { status: 'bloqueado', blockers: ['unsupported_claim'], finding: 'unsupported_metric' },
  tom_exclamacao: { status: 'bloqueado', blockers: ['tone_lint'], finding: 'tone_title_exclamation' },
  checagem_reprova: { status: 'bloqueado', blockers: ['unsupported_claim'], finding: 'unsupported_claim' },
  mesmo_provedor: { status: 'bloqueado', blockers: ['cross_provider_check_failed'], finding: 'same_provider' },
};

/** Gate (nome do relatório) que cada código de achado representa; usado quando o rascunho barrado não chega a ser gravado. */
export const GATE_OF_FINDING: Array<[RegExp, string]> = [
  [/^copy_literal$/, 'copy_literal'], [/^unsupported_metric$/, 'afirmacoes_nas_evidencias'], [/^unsupported_claim$/, 'checagem_de_fatos (veredito do checador)'], [/^tone_/, 'tom_lint'],
  [/^same_provider$/, 'checagem_em_provedor_distinto'], [/^(needs_primary_anchor|unanchored_claim)$/, 'ancora_primaria'],
];

export interface GateResult { gate: string; verdict: 'pass' | 'fail'; codes: string[] }
export interface DryrunArticle {
  slot: string; fonte: string; cenario: ScenarioKind; titulo: string;
  esperado: { status: string; bloqueios: string[]; achado: string | null };
  gatesQueBarraram: string[];
  status: string; estagios: string[]; bloqueios: string[]; achados: string[];
  gates: GateResult[] | null;
  checagem: { provedor: string; independente: boolean } | null;
  publicacao: string;
  linhasPiloto: Array<{ etapa: string; gate_verdict?: string; gate_reasons?: string[]; output_valid?: boolean; cross_provider_ok?: boolean }>;
  conforme: boolean;
}
export interface DryrunReport {
  versao: string; relogioDoEnsaio: string; prompt: string;
  chamadasModeloReal: 0; chamadasSimuladas: number; chamadasSimuladasPorClasse: Record<string, number>;
  fontes: Array<{ id: string; coleta: string; evidencias: number; recusadas: Array<{ codigo: string; url: string }> }>;
  espacamento: Array<{ host: string; requisicoes: number; menorIntervaloSeg: number | null }>;
  /** URLs que o ensaio plantou para o coletor RECUSAR (robots, fora do prefixo do sitemap) e que foram requisitadas: tem de ser vazio. */
  requisicoesProibidas: string[];
  habilitacao: string;
  materias: DryrunArticle[];
  resumo: { total: number; aprovadas: number; bloqueadas: number; conformes: number; porBloqueio: Record<string, number>; publicadas: number; recusadasPorSimulado: number };
}

const GATES: Array<[string, (d: Draft, e: Evidence[]) => { verdict: string; findings: Array<{ code: string }> }]> = [
  ['assinatura', (d) => checkSignature(d)],
  ['sem_apuracao_inventada', (d) => checkNoFabricatedReporting(d)],
  ['evidencia_confiavel', (d, e) => checkEvidenceTrust(d, e)],
  ['afirmacoes_nas_evidencias', (d, e) => checkClaims(d, e)],
  ['corpo_ancorado', (d, e) => checkBodyGrounding(d, e)],
  ['copy_literal', (d, e) => checkOriginality(d, e)],
  ['ancora_primaria', (d, e) => checkAnchoring(d, e)],
  ['autoral', (d, e) => checkAutoral(d, e)],
  ['atribuicao_fontes', (d, e) => checkAttribution(d, e)],
  ['imagem_direitos', (d) => checkImage(d.image)],
  ['publicavel_slug_resumo', (d) => checkPublishable(d)],
  ['avisos', (d) => checkNotices(d, [])],
  ['tom_lint', (d) => checkToneBlocking(d)],
];

export async function runPilotoDryrun(): Promise<DryrunReport> {
  let t = Date.parse(DRYRUN_NOW);
  const now = () => new Date(t);
  const sleep = async (ms: number) => { t += ms; };
  const store = new InMemoryEditorialStore();
  const registry = new SourceRegistry(SEED_SOURCES.filter((s) => (DRYRUN_SOURCE_IDS as readonly string[]).includes(s.id)));
  const chefe: Actor = { userId: 'ensaio-editor-chefe', roles: ['editor_chefe'], mfa: true };
  const admin: Actor = { userId: 'ensaio-admin', roles: ['admin'], mfa: true };
  const hctx = (actor: Actor): HandlerCtx => ({ actor, store, sources: registry, now, newId: () => 'ensaio' });
  // Habilitação SIMULADA (em memória, por atores de ensaio): o ensaio nunca habilita nada no cadastro real.
  for (const id of DRYRUN_SOURCE_IDS) {
    const rv = await reviewSource(hctx(chefe), { sourceId: id, termsStatus: 'approved', termsNote: 'ENSAIO: revisão SIMULADA em memória; nenhum ato humano real foi registrado.', urlVerified: true, robotsChecked: true, paywall: 'none' });
    if (rv.status !== 200) throw new Error(`revisão simulada de ${id} falhou: ${JSON.stringify(rv.body).slice(0, 200)}`);
    const en = await setSourceEnabled(hctx(admin), { sourceId: id, enabled: true });
    if (en.status !== 200) throw new Error(`habilitação simulada de ${id} falhou: ${JSON.stringify(en.body).slice(0, 200)}`);
  }

  const fetcher = new TimedMockFetcher(dryrunRoutes(), () => t);
  // Espaçamento REAL do coletor (3 s por host): o "sleep" do ensaio só avança o relógio simulado.
  const collector = new Collector(fetcher, { now, sleep, resolver: dryrunResolver(), flags: COLLECT_ON });
  const gateway = new RehearsalGateway((sourceId) => registry.get(sourceId)?.editorias[0] ?? 'mercado');
  const rows: Array<{ taskId: string; stage: string; patch: PilotRowPatch }> = [];
  const pilotSink: PilotRowSink = { async patch(p) { rows.push({ taskId: p.taskId, stage: p.stage, patch: p.patch }); } };

  const run = await runFactory({ store, registry, collector, gateway, audit: new InMemoryAuditLog(), flags: { editorialCollector: true, editorialPipeline: true }, pilotSink, now }, {});

  // Provedores vistos pelo gateway do ensaio (a checagem barrada não grava registro de checagem na matéria).
  const checkOf = (slot: string): { provedor: string; independente: boolean } | null => {
    const mine = gateway.calls.filter((c) => c.articleSlot === slot);
    const fc = [...mine].reverse().find((c) => c.taskClass === 'factcheck');
    const dr = [...mine].reverse().find((c) => c.taskClass === 'draft');
    return fc && dr ? { provedor: fc.provider, independente: fc.provider !== dr.provider } : null;
  };
  const materias: DryrunArticle[] = [];
  for (const page of DRYRUN_PAGES) {
    const rep = run.articles.find((a) => a.url === page.url);
    const rec = rep ? await store.getArticle(rep.articleId) : null;
    const exp = EXPECTED[page.scenario];
    const gates = rec?.draft ? GATES.map(([gate, fn]) => { const r = fn(rec.draft!, rec.evidences); return { gate, verdict: (r.verdict === 'pass' ? 'pass' : 'fail') as 'pass' | 'fail', codes: r.findings.map((f) => f.code) }; }) : null;
    let publicacao = 'sem rascunho';
    if (rec?.draft) {
      const pub = await applyPublication(store, { articleId: rec.articleId, receiptId: 'ensaio-sem-recibo', url: 'https://ensaio.invalid/nao-publicar', publishedAt: DRYRUN_NOW });
      publicacao = pub.ok ? 'PUBLICOU (defeito)' : `recusada: ${pub.code}`;
      if (!isSimulatedContent(rec.draft)) publicacao += ' (SEM marca SIMULADO: defeito)';
    }
    const ownRows = rows.filter((r) => r.taskId.startsWith(`ensaio-${page.slot}-`));
    const status = rec?.status ?? 'não coletada';
    const blockers = rec?.blockers ?? [];
    materias.push({
      slot: page.slot, fonte: page.sourceId, cenario: page.scenario, titulo: page.title,
      esperado: { status: exp.status, bloqueios: exp.blockers, achado: exp.finding },
      gatesQueBarraram: [...new Set((rec?.findings ?? []).flatMap((f) => GATE_OF_FINDING.filter(([re]) => re.test(f.code)).map(([, g]) => g)))],
      status, estagios: rep?.stages ?? [], bloqueios: blockers, achados: (rec?.findings ?? []).map((f) => `${f.code}: ${f.message}`),
      gates,
      checagem: checkOf(page.slot),
      publicacao,
      linhasPiloto: ownRows.map((r) => ({ etapa: r.stage, ...(r.patch.gate_verdict ? { gate_verdict: r.patch.gate_verdict, gate_reasons: r.patch.gate_reasons ?? [] } : {}), ...(r.patch.output_valid !== undefined ? { output_valid: r.patch.output_valid } : {}), ...(r.patch.cross_provider_ok !== undefined ? { cross_provider_ok: r.patch.cross_provider_ok } : {}) })),
      conforme: status === exp.status && exp.blockers.every((b) => (blockers as string[]).includes(b)) && (exp.finding === null || (rec?.findings ?? []).some((f) => f.code === exp.finding)),
    });
  }

  const hosts = [...new Set(fetcher.log.map((l) => l.host))].sort();
  const espacamento = hosts.map((host) => {
    const ts = fetcher.log.filter((l) => l.host === host).map((l) => l.atMs).sort((a, b) => a - b);
    const gaps = ts.slice(1).map((x, i) => x - ts[i]!);
    return { host, requisicoes: ts.length, menorIntervaloSeg: gaps.length ? Math.min(...gaps) / 1000 : null };
  });
  const porClasse: Record<string, number> = {};
  for (const c of gateway.calls) porClasse[c.taskClass] = (porClasse[c.taskClass] ?? 0) + 1;
  const porBloqueio: Record<string, number> = {};
  for (const m of materias) for (const b of m.bloqueios) porBloqueio[b] = (porBloqueio[b] ?? 0) + 1;

  return {
    versao: '2026-11-23', relogioDoEnsaio: DRYRUN_NOW, prompt: FACTORY_PROMPT_VERSION,
    chamadasModeloReal: 0, chamadasSimuladas: gateway.calls.length, chamadasSimuladasPorClasse: porClasse,
    fontes: run.sources.map((s) => ({
      id: s.sourceId, coleta: s.status, evidencias: s.evidences,
      recusadas: s.skipped.map((k) => ({ codigo: k.code, url: k.url })),
    })),
    espacamento,
    requisicoesProibidas: fetcher.log.map((l) => l.url).filter((u) => /\/produto\/|\/noticias\/interno\//.test(u)),
    habilitacao: 'SIMULADA em memória (atores de ensaio); nenhuma fonte foi habilitada no cadastro real nem no banco',
    materias,
    resumo: {
      total: materias.length, aprovadas: materias.filter((m) => m.status === 'aprovado').length, bloqueadas: materias.filter((m) => m.status === 'bloqueado').length,
      conformes: materias.filter((m) => m.conforme).length, porBloqueio,
      publicadas: materias.filter((m) => m.publicacao.startsWith('PUBLICOU')).length,
      recusadasPorSimulado: materias.filter((m) => m.publicacao.startsWith('recusada: simulated_content')).length,
    },
  };
}
