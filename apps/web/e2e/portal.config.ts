import { defineConfig, devices } from '@playwright/test';

/**
 * E2E do portal público (Frente 03).
 *   PORTAL_MODE=empty  → fonte vazia (padrão de produção): valida estados vazios honestos.
 *   PORTAL_MODE=mock   → fixtures MOCK: valida listas, matéria, busca, agenda e a faixa "MOCK".
 *   PORTAL_MODE=api    → PORTAL_SOURCE=api contra um servidor MOCK das rotas públicas (e2e/fake-api.mjs).
 * Screenshots: apps/web/e2e/screenshots/<modo>/<projeto>-<página>.png
 *
 * Servidor sob teste = BUILD DE PRODUÇÃO (PM-2026-11-23-L): next build de e2e (perfil producao em .next-e2e; perfil vitrine em
 * .next-e2e-vitrine para o modo mock), feito uma vez e reaproveitado entre as rodadas e refeito só quando o código muda, + next start
 * com as variáveis do modo em runtime (e2e/portal-server.mjs). O next dev fica só para desenvolvimento local.
 */
const mode = (process.env.PORTAL_MODE ?? 'empty') as 'empty' | 'mock' | 'api';
// APP_ENV do servidor sob teste: production (padrão) ou staging. Portas distintas evitam reaproveitar servidor com outro ambiente.
const appEnv = process.env.PORTAL_APP_ENV ?? 'production';
// PORTAL_PORT_BASE (ex.: 3410) isola a rodada: portas próprias (base+0..4) e SEM reaproveitar servidor já em execução
// (evita testar, sem querer, o código de outro worktree/agente que ocupe as portas padrão).
const base = Number(process.env.PORTAL_PORT_BASE) || 0;
const fakeApiPort = base ? base + 4 : 3104;
// DP-24: produção só é indexável com PORTAL_INDEXAVEL=1. PORTAL_INDEXAVEL_E2E=0 sobe a produção SEM o interruptor (padrão do go-live).
const indexavel = appEnv === 'production' && (process.env.PORTAL_INDEXAVEL_E2E ?? '1') === '1';
// API fora do ar (regra A6): PORTAL_API_DOWN=1 aponta o portal para uma porta sem servidor (conexão recusada);
// PORTAL_API_DOWN=503 sobe o servidor MOCK respondendo 503 (API sem banco).
const apiDown = mode === 'api' ? (process.env.PORTAL_API_DOWN ?? '') : '';
// Configuração do site publicada no Studio (/api/publico/site) no servidor MOCK: full (padrão) | vazio | noindex | invalido | malicioso.
const apiSite = mode === 'api' && !process.env.PORTAL_API_DOWN ? (process.env.PORTAL_API_SITE ?? '') : '';
const SITE_PORT: Record<string, number> = { vazio: 8, noindex: 9, invalido: 10, malicioso: 11 };
// Publicidade (plano em /api/commercial/ads/plan no servidor MOCK): com = TOP e SIDEBAR_1 disponíveis | sem = nenhuma posição.
const apiAds = mode === 'api' && !process.env.PORTAL_API_DOWN && !apiSite ? (process.env.PORTAL_API_ADS ?? '') : '';
const ADS_PORT: Record<string, number> = { com: 12, sem: 13 };
// Intelligence (pessoas e Moves) no servidor MOCK: full (padrão) | vazio | sem-flag (intelligencePessoas desligada).
// Porta própria base+14 (int/010: base+12/13 são da publicidade, do 09a6715).
const apiIntel = mode === 'api' && !apiDown && !apiSite && !apiAds ? (process.env.PORTAL_API_INTEL ?? '') : '';
const prodSemInterruptor = appEnv === 'production' && !indexavel;
const port = base
  ? base + (mode === 'mock' ? 1 : mode === 'api' ? (apiDown === '503' ? 7 : apiDown ? 6 : apiIntel ? 14 : (SITE_PORT[apiSite] ?? ADS_PORT[apiAds] ?? 2)) : prodSemInterruptor ? 5 : appEnv === 'production' ? 0 : 3)
  : mode === 'mock' ? 3102 : mode === 'api' ? (apiIntel ? 3112 : 3105) : prodSemInterruptor ? 3106 : appEnv === 'production' ? 3101 : 3103;


export default defineConfig({
  testDir: './portal',
  globalSetup: './portal/global-warmup.ts',
  // Em staging só a suíte de ambiente (as demais assumem indexação de produção).
  testMatch:
    mode === 'api'
      ? apiDown
        ? /(api-down|env)\.spec\.ts/
        : apiSite
          ? /api-site\.spec\.ts/
          : apiAds
            ? /api-ads\.spec\.ts/
          : apiIntel
            ? /intelligence\.spec\.ts/
          : /(api|api-site|api-agenda|api-tipos|env|intelligence|correcoes|seo-dados|cls-dados|header-busca|sem-js|seo|rodape)\.spec\.ts/
      : indexavel
        ? /.*\.spec\.ts/
        : /env\.spec\.ts/,
  outputDir: '../.test-results/portal',
  fullyParallel: true,
  retries: 0,
  reporter: [['list']],
  use: { baseURL: process.env.PORTAL_BASE_URL ?? `http://localhost:${port}`, locale: 'pt-BR', timezoneId: 'America/Sao_Paulo' },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } } },
    { name: 'mobile', use: { ...devices['Pixel 7'] } },
  ],
  webServer: process.env.PORTAL_BASE_URL
    ? undefined
    : [
        ...(mode === 'api' && apiDown !== '1'
          ? [
              {
                command: 'node e2e/fake-api.mjs',
                cwd: '..',
                url: `http://localhost:${fakeApiPort}/health`,
                reuseExistingServer: !base,
                timeout: 30_000,
                env: { FAKE_API_PORT: String(fakeApiPort), ...(apiDown === '503' ? { FAKE_API_STATUS: '503' } : {}), ...(apiSite ? { FAKE_API_SITE: apiSite } : {}), ...(apiAds ? { FAKE_API_ADS: apiAds } : {}), ...(apiIntel ? { FAKE_API_INTEL: apiIntel } : {}) },
              },
            ]
          : []),
        {
          // Perfil do build como no deploy: mock = vitrine do staging (PORTAL_VITRINE=1, APP_ENV=staging); os demais = produção.
          command: `node e2e/portal-server.mjs ${port} ${mode === 'mock' ? 'vitrine' : 'producao'}`,
          cwd: '..',
          url: `http://localhost:${port}`,
          reuseExistingServer: !base,
          // Inclui o next build quando o código mudou (minutos nesta máquina); com o build reaproveitado, sobe em segundos.
          timeout: 1_200_000,
          env: {
            PORTAL_SOURCE: mode,
            ...(mode === 'api' ? { PORTAL_API_BASE_URL: `http://localhost:${fakeApiPort}`, PORT: String(port) } : {}),
            // Mock nunca roda com APP_ENV=production (resolveSourceKind recusa): o servidor de mock usa staging.
            APP_ENV: mode === 'mock' ? 'staging' : appEnv,
            // Interruptor de indexação de produção (DP-24); em staging/mock nunca é definido.
            ...(indexavel && mode !== 'mock' ? { PORTAL_INDEXAVEL: '1' } : {}),
            NEXT_PUBLIC_SITE_URL: 'https://portal.example.test',
            NEXT_TELEMETRY_DISABLED: '1',
            // Flags de produto são de EXECUÇÃO (ADR-022): o mesmo build sobe com ou sem a flag. Só repassa o que o operador do teste definiu.
            ...(process.env.LN_FLAGS_ON ? { LN_FLAGS_ON: process.env.LN_FLAGS_ON } : {}),
          },
        },
      ],
});
