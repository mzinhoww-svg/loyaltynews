import { resolveFlags } from '@ln/contracts/flags';
import { afterEach, describe, expect, it, vi } from 'vitest';

/**
 * Importa o portal.config.ts e o proposta.spec.ts REAIS, com um Playwright de mentira que só registra o `test.skip` de cada bloco,
 * e compara com o ambiente que a configuração entrega ao servidor. Os quatro primeiros casos são a tabela do qa8-95efe365.
 */
const skips = vi.hoisted(() => new Map<string, boolean>());
vi.mock('@playwright/test', () => {
  let bloco = '';
  const test = Object.assign(() => {}, {
    describe: (nome: string, corpo: () => void) => {
      bloco = nome;
      corpo();
      bloco = '';
    },
    skip: (condicao: boolean) => {
      if (bloco) skips.set(bloco, condicao);
    },
  });
  return { test, expect: () => {}, defineConfig: (c: unknown) => c, devices: { 'Desktop Chrome': {}, 'Pixel 7': {} } };
});

const DESLIGADA = 'mídia kit com a flag portalFormularios desligada';
const LIGADA = 'pedido de proposta (flag portalFormularios ligada)';
const VARIAVEIS = ['PORTAL_MODE', 'PORTAL_APP_ENV', 'APP_ENV', 'LN_FLAGS_ON', 'PORTAL_FORMS_E2E', 'PORTAL_BASE_URL', 'PORTAL_INDEXAVEL_E2E', 'PORTAL_API_DOWN', 'PORTAL_PORT_BASE'];

type Config = { testMatch: RegExp; webServer?: { env: Record<string, string> }[] };

async function importar(env: Record<string, string>) {
  vi.resetModules();
  skips.clear();
  for (const nome of VARIAVEIS) vi.stubEnv(nome, env[nome]);
  const config = (await import('../e2e/portal.config')).default as unknown as Config;
  await import('../e2e/portal/proposta.spec');
  return { config, provasDesligado: skips.get(DESLIGADA) === false, provasLigado: skips.get(LIGADA) === false };
}

async function rodada(env: Record<string, string>) {
  const { config, ...provas } = await importar(env);
  const servidor = config.webServer!.at(-1)!.env;
  return {
    appEnv: servidor.APP_ENV,
    formulario: resolveFlags({ APP_ENV: servidor.APP_ENV, LN_FLAGS_ON: env.LN_FLAGS_ON }).state.portalFormularios,
    selecionada: config.testMatch.test('proposta.spec.ts'),
    ...provas,
  };
}

describe('e2e do pedido de proposta: a spec segue o ambiente do servidor', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it.each([
    ['empty, sem outras variáveis', {}, 'production', true, true],
    ['mock, sem outras variáveis', { PORTAL_MODE: 'mock' }, 'staging', false, true],
    ['mock com PORTAL_APP_ENV=staging', { PORTAL_MODE: 'mock', PORTAL_APP_ENV: 'staging' }, 'staging', false, false],
    ['empty com APP_ENV=staging herdado', { APP_ENV: 'staging' }, 'production', true, true],
    ['mock com a flag pedida', { PORTAL_MODE: 'mock', LN_FLAGS_ON: 'portalFormularios' }, 'staging', true, true],
    ['mock com PORTAL_FORMS_E2E=1 sem servidor externo', { PORTAL_MODE: 'mock', PORTAL_FORMS_E2E: '1' }, 'staging', false, true],
  ] as [string, Record<string, string>, string, boolean, boolean][])('%s', async (_nome, env, appEnv, formulario, selecionada) => {
    expect(await rodada(env)).toEqual({ appEnv, formulario, selecionada, provasDesligado: !formulario, provasLigado: formulario });
  });

  it('servidor externo: PORTAL_FORMS_E2E=1 declara o formulário ligado', async () => {
    const r = await importar({ PORTAL_MODE: 'mock', PORTAL_BASE_URL: 'http://127.0.0.1:1', PORTAL_FORMS_E2E: '1' });
    expect(r.config.webServer).toBeUndefined();
    expect([r.provasDesligado, r.provasLigado]).toEqual([false, true]);
  });
});
