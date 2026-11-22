import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeAll, describe, test } from 'vitest';
import assert from 'node:assert/strict';
import { generatePackages, getDashboardSummary, getPackage, InMemoryPackageStore, listQueue, PERMISSIONS, requestSimulatedPublish, type DashboardDeps, type DashboardSummary, type QueueResult, type SocialPackageRecord } from '../dashboard';
import { DEFAULT_FLAGS } from '../flags';
import { createSocialPublisher } from '../publisher/publisher';
import { renderPost } from '../creative/post';
import {
  BlockersList, CopyPreview, CreativePreview, DashboardSummaryCards, MockBadge, PackageCard, PackageQueue, ReceiptList, StatusBadge,
} from '../ui/components';
import { blockerInfo, copyStats, queueRowVm, splitCopy, svgDataUri } from '../ui/view-models';
import * as uiEntry from '../ui';
import { MOCK_ARTICLE } from '../../fixtures/article.mock';

const html = (el: Parameters<typeof renderToStaticMarkup>[0]) => renderToStaticMarkup(el);
const now = () => '2026-11-22T12:00:00.000Z';
const CALLER = { id: 'u', permissions: [PERMISSIONS.read, PERMISSIONS.generate, PERMISSIONS.requestPublish] };

describe('view-models', () => {
  test('blockerInfo: rótulo em português e escopo (real x sempre)', () => {
    assert.deepEqual(blockerInfo('mock_nao_publicavel'), { code: 'mock_nao_publicavel', label: 'Matéria de demonstração (MOCK): não publicável', scope: 'real' });
    assert.equal(blockerInfo('brandkit_proposal_not_approved').scope, 'real');
    assert.equal(blockerInfo('sem_imagem_aprovada').scope, 'sempre');
    assert.equal(blockerInfo('canal_desligado:instagram').label, 'Instagram desligado (flag)');
    assert.equal(blockerInfo('regra:numero_sem_evidencia').label, 'Regra violada: numero_sem_evidencia');
    assert.equal(blockerInfo('desconhecido').label, 'desconhecido');
  });

  test('splitCopy: menção, link, hashtag e texto; reconstrói o conteúdo sem perda', () => {
    const t = 'Oi @[Empresa Exemplo] veja https://x.invalid/a?utm_source=linkedin #Fidelidade fim';
    const segs = splitCopy(t);
    assert.deepEqual(segs.map((s) => s.type), ['text', 'mention', 'text', 'link', 'text', 'hashtag', 'text']);
    assert.equal(segs.find((s) => s.type === 'mention')?.value, 'Empresa Exemplo');
    assert.equal(segs.map((s) => (s.type === 'mention' ? `@[${s.value}]` : s.value)).join(''), t);
  });

  test('copyStats e svgDataUri', () => {
    assert.deepEqual(copyStats('a\nb'), { chars: 3, charsMax: 3000, hookChars: 1, hookMax: 210 });
    assert.equal(copyStats('x', 'instagram').charsMax, 2200);
    assert.ok(!svgDataUri('<svg onload="x"/>').includes('<'));
  });
});

describe('componentes de prévia', () => {
  test('CreativePreview: <img> com data URI, alt, MOCK escrito e status do brandkit', () => {
    const a = renderPost(MOCK_ARTICLE, { format: 'open_graph' });
    const out = html(createElement(CreativePreview, { svg: a.svg, alt: 'Criativo da matéria', mock: true, brandStatus: a.brandStatus, caption: '1200×627' }));
    assert.ok(out.includes('<img'));
    assert.ok(out.includes('src="data:image/svg+xml;charset=utf-8,'));
    assert.ok(out.includes('alt="Criativo da matéria"'));
    assert.ok(out.includes('MOCK'));
    assert.ok(out.includes('Brandkit: proposta, não aprovada'));
    assert.ok(!out.includes('<script'));
    assert.ok(!out.includes('<svg'), 'o SVG vai só como imagem (data URI), nunca inline');
  });

  test('CreativePreview sem SVG: estado vazio honesto, com papel e rótulo', () => {
    const out = html(createElement(CreativePreview, { alt: 'Sem criativo' }));
    assert.ok(out.includes('Prévia indisponível'));
    assert.ok(out.includes('role="img"') && out.includes('aria-label="Sem criativo"'));
  });

  test('CreativePreview com brandkit aprovado não mostra aviso de proposta', () => {
    const out = html(createElement(CreativePreview, { svg: '<svg/>', alt: 'x', brandStatus: 'approved' }));
    assert.ok(out.includes('Brandkit aprovado'));
    assert.ok(!out.includes('proposta'));
  });

  test('CopyPreview: destaca menção, link e hashtag; contadores; escapa HTML do texto', () => {
    const text = 'Gancho <img src=x onerror=alert(1)>\n• fato\nCitados: @[Empresa Exemplo]\nhttps://x.invalid/a?utm_source=linkedin\nRedação Loyalty News · #Fidelidade';
    const out = html(createElement(CopyPreview, { text, textOnlyFallback: false }));
    assert.ok(out.includes('data-mention="Empresa Exemplo"'));
    assert.ok(out.includes('data-link'));
    assert.ok(out.includes('#Fidelidade'));
    assert.ok(out.includes('data-counter="chars"'));
    assert.ok(out.includes('&lt;img src=x onerror=alert(1)&gt;'));
    assert.ok(!out.includes('<img src=x'));
    assert.ok(!out.includes('data-fallback'));
  });

  test('CopyPreview: aviso de texto puro quando não há menção marcável', () => {
    assert.ok(html(createElement(CopyPreview, { text: 'x', textOnlyFallback: true })).includes('texto puro'));
  });

  test('BlockersList: vazio e com itens; escopo explicado em texto (não só cor)', () => {
    assert.ok(html(createElement(BlockersList, { blockers: [] })).includes('Sem bloqueios.'));
    const out = html(createElement(BlockersList, { blockers: ['mock_nao_publicavel', 'sem_imagem_aprovada'] }));
    assert.ok(out.includes('impede só a publicação real'));
    assert.ok(out.includes('impede também a simulação'));
    assert.ok(out.includes('data-blocker="sem_imagem_aprovada"'));
  });

  test('ReceiptList: recibo simulado marcado SIMULADO; real marcado REAL; vazio', () => {
    assert.ok(html(createElement(ReceiptList, { receipts: [] })).includes('Nenhum recibo.'));
    const base = { channel: 'linkedin' as const, createdAt: 't', status: 'scheduled' as const, idempotencyKey: 'k' };
    const out = html(createElement(ReceiptList, { receipts: [
      { ...base, id: 'SIM-000001', mode: 'simulated', simulated: true },
      { ...base, id: 'LIVE-1', mode: 'live', simulated: false },
    ] }));
    assert.ok(out.includes('SIM-000001') && out.includes('SIMULADO'));
    assert.ok(out.includes('LIVE-1') && out.includes('REAL'));
  });

  test('StatusBadge e MockBadge mostram texto', () => {
    assert.ok(html(createElement(StatusBadge, { status: 'simulado' })).includes('Publicado (simulado)'));
    assert.ok(html(createElement(MockBadge)).includes('MOCK'));
  });
});

describe('Social Dashboard: telas com dados dos handlers', () => {
  let deps: DashboardDeps;
  let queue: QueueResult;
  let rec: SocialPackageRecord;
  let summary: DashboardSummary;
  let simulated: SocialPackageRecord;

  beforeAll(async () => {
    deps = {
      store: new InMemoryPackageStore(),
      articles: { get: async (id) => (id === MOCK_ARTICLE.id ? structuredClone(MOCK_ARTICLE) : null) },
      publisher: createSocialPublisher({ mode: 'simulated', now }),
      flags: DEFAULT_FLAGS,
      now,
    };
    await generatePackages(deps, CALLER, { articleId: MOCK_ARTICLE.id, channels: ['linkedin', 'instagram'] });
    await requestSimulatedPublish(deps, CALLER, 'MOCK-2026-0001:linkedin:v1');
    queue = (await listQueue(deps, CALLER, {})).body as QueueResult;
    rec = (await getPackage(deps, CALLER, 'MOCK-2026-0001:instagram:v1')).body as SocialPackageRecord;
    simulated = (await getPackage(deps, CALLER, 'MOCK-2026-0001:linkedin:v1')).body as SocialPackageRecord;
    summary = (await getDashboardSummary(deps, CALLER)).body as DashboardSummary;
  });

  test('PackageQueue: tabela com legenda, cabeçalhos de coluna/linha, links e MOCK visível', () => {
    const out = html(createElement(PackageQueue, { result: queue, hrefFor: (i: { id: string }) => `/studio/social/${i.id}` }));
    assert.ok(out.includes('<caption'));
    assert.ok(out.includes('scope="col"') && out.includes('scope="row"'));
    assert.ok(out.includes('href="/studio/social/MOCK-2026-0001:linkedin:v1"'));
    assert.ok(out.includes('MOCK'));
    assert.ok(out.includes('Publicado (simulado)'));
    assert.ok(out.includes('Instagram desligado (flag)'));
  });

  test('PackageQueue vazio: mensagem honesta, sem tabela', () => {
    const out = html(createElement(PackageQueue, { result: { items: [], total: 0, nextCursor: null, counts: queue.counts } }));
    assert.ok(out.includes('Nenhum pacote social gerado ainda.'));
    assert.ok(!out.includes('<table'));
  });

  test('queueRowVm resume a linha', () => {
    const vm = queueRowVm(queue.items.find((i) => i.channel === 'linkedin')!);
    assert.equal(vm.statusLabel, 'Publicado (simulado)');
    assert.equal(vm.receipts, 1);
    assert.equal(vm.mock, true);
  });

  test('PackageCard (Instagram bloqueado): criativo, legenda, bloqueios; sem menção marcável', () => {
    const out = html(createElement(PackageCard, { record: rec }));
    assert.ok(out.includes('<article'));
    assert.ok(out.includes('aria-labelledby'));
    assert.ok(out.includes('Instagram'));
    assert.ok(out.includes('data:image/svg+xml'));
    assert.ok(out.includes('Instagram desligado (flag)'));
    assert.ok(out.includes('Nenhum recibo.'));
    assert.ok(out.includes('MOCK'));
  });

  test('PackageCard (LinkedIn simulado): recibo SIMULADO e menção destacada', () => {
    const out = html(createElement(PackageCard, { record: simulated }));
    assert.ok(out.includes('SIM-000001'));
    assert.ok(out.includes('SIMULADO'));
    assert.ok(out.includes('data-mention="Empresa Exemplo"'));
  });

  test('PackageCard com falha: alerta com as regras e sem prévia', () => {
    const failed: SocialPackageRecord = { id: 'A:linkedin:v1', articleId: 'A', channel: 'linkedin', version: 1, status: 'falhou', createdAt: 't', updatedAt: 't', blockers: ['regra:numero_sem_evidencia'], failure: { rules: ['numero_sem_evidencia'], detail: 'd' }, receipts: [], mock: false };
    const out = html(createElement(PackageCard, { record: failed }));
    assert.ok(out.includes('role="alert"'));
    assert.ok(out.includes('numero_sem_evidencia'));
    assert.ok(!out.includes('data:image/svg+xml'));
  });

  test('DashboardSummaryCards: modo simulado, chaves desligadas, métricas indisponíveis (sem números fictícios)', () => {
    const out = html(createElement(DashboardSummaryCards, { summary }));
    assert.ok(out.includes('Modo simulado'));
    assert.ok(out.includes('Chave desligada'));
    assert.ok(out.includes('modo simulado'));
    assert.ok(out.includes('Métricas: indisponíveis'));
    assert.ok(out.includes('Brandkit: proposta, não aprovada'));
    assert.ok(out.includes('2 pacote(s)'));
  });
});

describe('entrada client-safe', () => {
  test('exporta componentes e view-models; nunca o adaptador real nem o publisher', () => {
    for (const k of ['CreativePreview', 'CopyPreview', 'PackageCard', 'PackageQueue', 'DashboardSummaryCards', 'blockerInfo', 'splitCopy']) {
      assert.ok(k in uiEntry, k);
    }
    for (const k of ['createLiveMlabsAdapter', 'SocialPublisher', 'SimulatedMlabsAdapter', 'PUBLISHER_SOCIAL']) {
      assert.equal(k in uiEntry, false, k);
    }
  });
});
