import { expect, test } from '@playwright/test';
import { entrar } from './helpers';

// Exportação da planilha do piloto (Studio 2; PM-2026-11-23-F). Roda DEPOIS de studio-y-piloto (a1 mapeada e lida pelo leitor 1: 1 alta, bloqueada)
// e de studio-y2-piloto-importacao (leitura do leitor 2 de a1 importada: aprovada). Linhas MOCK da trilha vêm da seed ?seed=piloto.
test.describe.configure({ mode: 'serial' });

const COLUNAS_AGENTOPS = [
  'task_id', 'kind', 'article_id', 'source_id', 'stage', 'account', 'declared_model', 'prompt_version', 'started_at', 'ended_at', 'attempt',
  'reviewed_draft_task_id', 'outcome', 'limit_message', 'limit_at', 'account_resumed_at', 'gate_verdict', 'gate_reasons', 'cross_provider_ok',
  'packet_chars', 'output_valid', 'tokens_measured', 'unsupported_facts', 'unsupported_high', 'unsupported_medium', 'unsupported_low',
  'published_attempt', 'tarifada_api_call', 'secret_in_log', 'tool_outside_contract', 'notes',
];

test('RBAC: sem sessão não baixa; editor e revisor recebem 403 sem dados', async ({ page, context }) => {
  await context.clearCookies();
  const anon = await context.request.get('/studio/piloto/planilha', { maxRedirects: 0 });
  expect([302, 303, 307, 401]).toContain(anon.status());
  expect(await anon.text()).not.toContain('task_id');
  for (const [u, papel] of [['pl-ed', 'editor'], ['pl-rev', 'revisor']] as const) {
    await entrar(context, u, papel);
    const r = await context.request.get('/studio/piloto/planilha');
    expect(r.status()).toBe(403);
    expect(await r.text()).not.toContain('task_id');
  }
  void page;
});

test('conteúdo: colunas do AgentOps na ordem, uma linha por tarefa, unsupported_* do leitor 1, leitor 2 visível, fórmula neutralizada', async ({ page, context }) => {
  expect((await context.request.get('/api/e2e/login?seed=piloto')).ok()).toBe(true);
  await entrar(context, 'pil-chefe', 'editor_chefe');
  await page.goto('/studio/piloto');
  await expect(page.locator('[data-exportar]')).toHaveAttribute('href', '/studio/piloto/planilha');

  const r = await context.request.get('/studio/piloto/planilha');
  expect(r.status()).toBe(200);
  expect(r.headers()['content-type']).toContain('text/csv');
  expect(r.headers()['content-disposition']).toMatch(/^attachment; filename="piloto-planilha-\d{4}-\d{2}-\d{2}\.csv"$/);
  const linhas = (await r.text()).replace(/^\uFEFF/, '').trim().split('\n');
  // Marcador de amostra (pós-resume): o CSV começa com "# amostra_desde=<ISO>"; sem ele o avaliador recusa o arquivo antigo.
  expect(linhas[0]).toMatch(/^# amostra_desde=\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  const linhasDados = linhas.slice(1);
  const cab = linhasDados[0]!.split(',');
  expect(cab.slice(0, 31)).toEqual(COLUNAS_AGENTOPS);
  expect(cab.slice(31)).toEqual(['materia', 'leitor1_veredito', 'leitor2_veredito', 'leitor2_unsupported_high', 'leitor2_unsupported_medium', 'leitor2_unsupported_low', 'leitor2_origem']);
  const porTarefa = (id: string) => {
    const l = linhasDados.find((x) => x.startsWith(`${id},`));
    expect(l, `linha ${id}`).toBeTruthy();
    return Object.fromEntries(cab.map((c, i) => [c, l!.split(',')[i] ?? '']));
  };
  const draft = porTarefa('mock-a1-draft');
  const review = porTarefa('mock-a1-review');
  expect(draft.unsupported_facts).toBe(''); // só a linha final recebe a leitura
  expect(review).toMatchObject({ stage: 'review', materia: 'a1', gate_verdict: 'approved', output_valid: 'true', cross_provider_ok: 'true' });
  expect(review).toMatchObject({ unsupported_facts: '1', unsupported_high: '1', unsupported_medium: '0', unsupported_low: '0', leitor1_veredito: 'bloqueado' });
  expect(review).toMatchObject({ leitor2_veredito: 'aprovado', leitor2_unsupported_medium: '1', leitor2_origem: 'importacao' }); // leitor 1 já leu a1
  expect(review.notes).toBe("'=MOCK nota"); // injeção de fórmula neutralizada
});
