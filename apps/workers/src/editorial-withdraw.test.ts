import { describe, expect, it } from 'vitest';
import { INBOX_FINDING, InMemoryEditorialStore } from '@ln/editorial';
import { parseWithdrawArgs, runWithdraw } from './editorial-withdraw';

describe('comando de retirada', () => {
  it('aceita um alvo só; sem alvo, com dois ou com argumento estranho recusa', () => {
    expect(parseWithdrawArgs(['--ambiente', 'staging', '--fonte', 'mestre-das-milhas'])).toEqual({ what: { sourceId: 'mestre-das-milhas' }, confirm: false, environment: 'staging' });
    expect(parseWithdrawArgs(['--url', 'https://x.example/a', '--ambiente', 'production', '--confirmar'])).toEqual({ what: { url: 'https://x.example/a' }, confirm: true, environment: 'production' });
    expect(parseWithdrawArgs(['--fonte', 'mestre-das-milhas'])).toBeNull();
    expect(parseWithdrawArgs(['--ambiente', 'prod', '--fonte', 'a'])).toBeNull();
    for (const ruim of [[], ['--confirmar'], ['--fonte'], ['--fonte', '--confirmar'], ['--fonte', 'a', '--url', 'https://x.example/a'], ['--url', 'http://x.example/a'], ['--fonte', 'a', '--tudo']]) {
      expect(parseWithdrawArgs(['--ambiente', 'staging', ...ruim]), ruim.join(' ')).toBeNull();
    }
  });
  it('sem --confirmar só conta; com --confirmar apaga', async () => {
    const store = new InMemoryEditorialStore();
    await store.putArticle({
      articleId: 'a', editoria: 'pontos', status: 'rascunho', blockers: [], reviews: [], recheckCount: 0, updatedAt: '2026-11-28T00:00:00.000Z',
      findings: [{ code: INBOX_FINDING, message: 'item coletado sem modelo' }],
      evidences: [{ id: 'ev', sourceId: 'mestre-das-milhas', url: 'https://x.example/a', canonicalUrl: 'https://x.example/a', fetchedAt: '2026-11-28T00:00:00.000Z', contentSha256: 'a'.repeat(64), title: 'MOCK', text: 'Texto MOCK', publishedAt: null, suspicious: false, suspiciousReasons: [] }],
    });
    const args = parseWithdrawArgs(['--ambiente', 'staging', '--fonte', 'mestre-das-milhas'])!;
    expect(await runWithdraw(store, { ...args, what: { sourceId: 'abemf' }, confirm: true }, new Date())).toContain('nada casou');
    expect(await runWithdraw(store, args, new Date())).toContain('1 item(ns) seriam apagados');
    expect((await store.getArticle('a'))!.evidences[0]!.text).toBe('Texto MOCK');
    expect(await store.listAudit()).toEqual([]);
    expect(await runWithdraw(store, { ...args, confirm: true }, new Date())).toContain('retirada feita: 1');
    expect((await store.getArticle('a'))!.evidences[0]!.text).toBe('');
  });
});
