import { describe, expect, it } from 'vitest';
import { ACCOUNTS, run } from '../../bin/ln-openbot-agent.mjs';

// Emenda de 26/11 à DP-41: a lane opencode (DeepSeek) é legítima. O cliente tem de aceitá-la e relatar o `lane`
// correspondente; a conta claude/codex continua na faixa `subscription`.
const env = (account: string) => ({
  LN_API_BASE: 'https://staging.example.test/api/openbot',
  LN_AGENT_ACCOUNT: account,
  LN_HMAC_SECRET_FILE: 'C:/segredo/hmac',
});

function io() {
  const seen: { url?: string; body?: { usage?: { lane?: string; account?: string; model?: string; costMicro?: number } } } = {};
  return {
    readFile: () => 'segredo-de-teste',
    now: () => Date.parse('2026-11-25T18:00:00.000Z'),
    fetchImpl: async (url: string, init: { body: string }) => {
      seen.url = url;
      seen.body = JSON.parse(init.body);
      return { ok: true, status: 200, text: async () => '{"ok":true}' } as never;
    },
    seen,
  };
}

const done = ['done', '--task', 'task-1', '--lease', 'lease-1', '--result-ref', 'res-task-1-a1', '--model', 'deepseek-v4.1-flash', '--stage', 'draft', '--started-at', '2026-11-25T17:59:00.000Z', '--packet-chars', '100', '--prompt-version', 'editorial-0.3'];

describe('cliente do agente: lane opencode', () => {
  it('aceita opencode entre as contas', () => {
    expect(ACCOUNTS).toEqual(['claude', 'codex', 'opencode']);
  });

  it('opencode declara lane opencode, conta opencode e o modelo DeepSeek realmente usado', async () => {
    const i = io();
    await run(done, env('opencode'), i as never);
    expect(i.seen.body!.usage).toMatchObject({ lane: 'opencode', account: 'opencode', model: 'deepseek-v4.1-flash', costMicro: 0 });
  });

  it('claude continua na lane subscription (controle negativo da lane, não da conta)', async () => {
    const i = io();
    await run(done, { ...env('claude'), LN_AGENT_ACCOUNT: 'claude' }, i as never);
    expect(i.seen.body!.usage).toMatchObject({ lane: 'subscription', account: 'claude' });
  });

  it('antigravity continua recusada pelo cliente', async () => {
    await expect(run(done, env('antigravity'), io() as never)).rejects.toMatchObject({ code: 'config' });
  });
});
