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
    for (const k of ['PORTAL_SOURCE', 'PORTAL_MODE']) {
      const v = String(env[k] ?? '').trim().toLowerCase();
      if (v !== '' && v !== 'empty') p.push(`${k}=${env[k]} em ambiente de deploy: deve ficar vazio (fixtures MOCK e fontes experimentais só em teste)`);
    }
    // Vitrine do portal no STAGING (decisão do Security 23/11/2026, R1/R2): interruptor próprio PORTAL_VITRINE=1, exatamente `1`, e só com APP_ENV=staging.
    // PORTAL_SOURCE=mock continua proibido acima. Com production/producao/homologacao a variável DEFINIDA (qualquer valor) reprova.
    const vit = String(env.PORTAL_VITRINE ?? '').trim();
    if (vit !== '') {
      const appEnvVit = String(env.APP_ENV ?? '').trim().toLowerCase();
      if (vit !== '1') p.push(`PORTAL_VITRINE=${env.PORTAL_VITRINE}: só o valor 1 é aceito (e só no staging)`);
      else if (appEnvVit !== 'staging') p.push(`PORTAL_VITRINE=1 com APP_ENV=${env.APP_ENV || '(vazio)'}: a vitrine de demonstração só existe no staging`);
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
