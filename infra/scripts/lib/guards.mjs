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
