// Variáveis que existem SÓ para teste e nunca podem estar em staging, produção nem no build de deploy.
// Alerta do PM (22/11/2026): LN_STUDIO_TEST_SESSION (sessão simulada do Studio, definida em apps/web/playwright.config.ts)
// jamais pode existir em ambiente da Vertra; PORTAL_SOURCE=mock e PORTAL_MODE=mock só em teste.
// Também só de CI (scaffold, packages/db/src/migrate.ts): CI=true libera DB_SSL_MODE=disable; em deploy nenhum dos dois pode existir.
const DEPLOY_ENVS = ['staging', 'production', 'homologacao', 'producao']; // o scaffold cita homologacao/producao; aceitamos os dois vocabulários

/** Problemas no ambiente do processo. `deploy` força o modo estrito (staging/produção/build de deploy). */
export function envProblems(env = process.env, { deploy = false } = {}) {
  const p = [];
  const v = env.LN_STUDIO_TEST_SESSION;
  if (v !== undefined && v !== '') {
    p.push('LN_STUDIO_TEST_SESSION está definida: a sessão simulada do Studio é SÓ de teste e não pode existir no ambiente nem no build (qualquer valor reprova)');
  }
  const strict = deploy || DEPLOY_ENVS.includes(String(env.APP_ENV ?? '').toLowerCase());
  if (strict) {
    // Alerta do PM: no staging/produção PORTAL_SOURCE fica VAZIO (nem mock nem intelligence). Só 'empty' explícito é aceito.
    // Com banco, o portal lê dados reais por PORTAL_SOURCE=api (apps/web/app/(portal)/_lib/indexing.ts: `api` vale em qualquer ambiente). Só `api` e `empty`/vazio passam;
    // mock, intelligence e qualquer outro valor continuam reprovados. PORTAL_MODE segue só vazio/empty.
    for (const k of ['PORTAL_SOURCE', 'PORTAL_MODE']) {
      const v = String(env[k] ?? '').trim().toLowerCase();
      if (v === '' || v === 'empty') continue;
      // A2 (Security, decisao 12): `api` so com a grafia EXATA; o portal compara === 'api' e uma variante (API, ' api ') cairia em silencio na fonte vazia.
      if (k === 'PORTAL_SOURCE' && v === 'api') {
        if (String(env[k]) === 'api') continue;
        p.push(`PORTAL_SOURCE="${env[k]}": a grafia tem de ser exatamente api (minusculas, sem espacos); o portal compara com === e cairia na fonte vazia sem aviso`);
        continue;
      }
      p.push(`${k}=${env[k]} em ambiente de deploy: deve ficar vazio${k === 'PORTAL_SOURCE' ? ' ou api' : ''} (fixtures MOCK e fontes experimentais só em teste)`);
    }
    // Vitrine do portal no STAGING (decisão do Security 23/11/2026, R1/R2): interruptor próprio PORTAL_VITRINE=1, exatamente `1`, e só com APP_ENV=staging.
    // PORTAL_SOURCE=mock continua proibido acima. Com production/producao/homologacao a variável DEFINIDA (qualquer valor) reprova.
    const vit = String(env.PORTAL_VITRINE ?? '').trim();
    // A3 (Security, decisao 12): uma fonte por pacote. A vitrine (fixtures rotuladas) so com a fonte vazia; junto com api misturaria dados reais com a faixa de demonstracao.
    if (vit !== '' && String(env.PORTAL_SOURCE ?? '').trim().toLowerCase() === 'api') p.push('PORTAL_VITRINE definida junto com PORTAL_SOURCE=api: uma fonte por pacote (vitrine so com a fonte vazia)');
    if (vit !== '') {
      const appEnvVit = String(env.APP_ENV ?? '').trim().toLowerCase();
      if (vit !== '1') p.push(`PORTAL_VITRINE=${env.PORTAL_VITRINE}: só o valor 1 é aceito (e só no staging)`);
      else if (appEnvVit !== 'staging') p.push(`PORTAL_VITRINE=1 com APP_ENV=${env.APP_ENV || '(vazio)'}: a vitrine de demonstração só existe no staging`);
    }
    // DP-24 (proprietario) + Security: a PRODUCAO nasce NAO indexavel (noindex, robots Disallow: /, sem sitemap). Indexar so com o interruptor explicito PORTAL_INDEXAVEL=1,
    // ligado no go-live, e so com APP_ENV=production. Em staging ou com outro valor = reprovado (staging nunca e indexavel).
    const indexavel = String(env.PORTAL_INDEXAVEL ?? '').trim();
    if (indexavel !== '') {
      if (indexavel !== '1') p.push(`PORTAL_INDEXAVEL=${env.PORTAL_INDEXAVEL}: so o valor 1 e aceito (e so em producao)`);
      else if (!['production', 'producao'].includes(String(env.APP_ENV ?? '').trim().toLowerCase())) p.push(`PORTAL_INDEXAVEL=1 com APP_ENV=${env.APP_ENV || '(vazio)'}: so a producao pode ser indexavel (staging nunca)`);
    }
    // A4 (Security, decisao 12): PORTAL_API_BASE_URL em deploy so ausente (padrao: o proprio servidor) ou loopback http; outro host publicaria conteudo de fora (injecao de conteudo / SSRF).
    const apiBase = String(env.PORTAL_API_BASE_URL ?? '').trim();
    if (apiBase !== '') {
      let u = null;
      try { u = new URL(apiBase); } catch { /* invalida: reprovada abaixo */ }
      if (!u || u.protocol !== 'http:' || !['127.0.0.1', 'localhost'].includes(u.hostname)) p.push('PORTAL_API_BASE_URL em ambiente de deploy: so ausente ou http://127.0.0.1 / http://localhost (outro host e reprovado)');
    }
    if (String(env.DB_SSL_MODE ?? '').toLowerCase() === 'disable') p.push('DB_SSL_MODE=disable em ambiente de deploy: TLS com certificado de cliente é obrigatório na Vertra (disable é só do CI)');
    if (String(env.CI ?? '').toLowerCase() === 'true') p.push('CI=true em ambiente de deploy: essa variável libera DB_SSL_MODE=disable e é só do CI');
  }
  const prod = ['production', 'producao'].includes(String(env.APP_ENV ?? '').toLowerCase());
  if (prod && env.DIAG_XFF !== undefined && env.DIAG_XFF !== '') p.push('DIAG_XFF definida em produção: o diagnóstico de proxies (contagem de X-Forwarded-For) é só do staging, temporário');

  return p;
}

// Atribuições em arquivos de deploy/IaC/scripts de produção. Citar o NOME (ex.: no contrato de variáveis, como proibida) não reprova.
export const ASSIGN_STUDIO = /LN_STUDIO_TEST_SESSION["']?\s*[=:]/;
export const ASSIGN_PORTAL_MOCK = /PORTAL_(?:SOURCE|MODE)["']?\s*[=:]\s*["']?(?:mock|intelligence)\b/i;

// Vitrine (R8): ATRIBUIÇÃO de PORTAL_VITRINE (`PORTAL_VITRINE=1`, `PORTAL_VITRINE: '1'`, `"PORTAL_VITRINE": "1"`); LER (`process.env.PORTAL_VITRINE === '1'`) ou citar o nome não conta.
export const ASSIGN_VITRINE = /PORTAL_VITRINE["']?\s*(?::|=(?!=))\s*["']?[^\s"',}=]/;
// Marcadores que só existem com a vitrine ligada (Security R5/R8): a home de produção, e de staging sem vitrine, não pode conter nenhum.
export const VITRINE_MARCADORES = ['Conteúdo de demonstração', 'MOCK · dados de exemplo', '[MOCK]'];
export const VITRINE_BANNER = 'Conteúdo de demonstração';
