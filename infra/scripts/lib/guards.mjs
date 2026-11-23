// Variáveis que existem SÓ para teste e nunca podem estar em staging, produção nem no build de deploy.
// Alerta do PM (22/11/2026): LN_STUDIO_TEST_SESSION (sessão simulada do Studio, definida em apps/web/playwright.config.ts)
// jamais pode existir em ambiente da Vertra; PORTAL_SOURCE=mock e PORTAL_MODE=mock só em teste.
// Também só de CI (scaffold, packages/db/src/migrate.ts): CI=true libera DB_SSL_MODE=disable; em deploy nenhum dos dois pode existir.
const DEPLOY_ENVS = ['staging', 'production', 'homologacao', 'producao']; // o scaffold cita homologacao/producao; aceitamos os dois vocabulários

/** Problemas no ambiente do processo. `deploy` força o modo estrito (staging/produção/build de deploy). */
export function envProblems(env = process.env, { deploy = false, migracao = false } = {}) {
  const p = [];
  const v = env.LN_STUDIO_TEST_SESSION;
  if (v !== undefined && v !== '') {
    p.push('LN_STUDIO_TEST_SESSION está definida: a sessão simulada do Studio é SÓ de teste e não pode existir no ambiente nem no build (qualquer valor reprova)');
  }
  // B1 (Security, decisao 13): a dispensa de backup externo (DP-23) existe SO no processo da migracao (migrate.mjs passa migracao:true); em app, build, start ou CI reprova.
  if (!migracao) {
    for (const k of ['LN_BACKUP_WAIVER_REF', 'LN_BACKUP_WAIVER_UNTIL', 'LN_BACKUP_VERTRA_SNAPSHOT_AT']) {
      if (String(env[k] ?? '') !== '') p.push(`${k} definida: a dispensa de backup externo (DP-23) vale so no processo da migracao, nunca no app da Vertra, no build nem no CI`);
    }
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
    // I4 (Security): comparacao EXATA, sem trim: o portal compara === '1'; ' 1' passaria no guard e deixaria a producao silenciosamente nao indexavel.
    const indexavel = String(env.PORTAL_INDEXAVEL ?? '');
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
  // ADR-022 (DP-38): flags de produto por variável SÓ no staging, lista de nomes separada por vírgula. Produção liga por commit revisado (FLAG_RELEASES), nunca por variável.
  const flagsOn = String(env.LN_FLAGS_ON ?? '');
  if (flagsOn.trim() !== '') {
    const ambFlags = String(env.APP_ENV ?? '').trim().toLowerCase();
    if (prod) p.push('LN_FLAGS_ON definida em produção: flags de produto por variável só existem no staging (ADR-022); em produção a flag liga por commit revisado em FLAG_RELEASES');
    else if (ambFlags === 'staging' && !/^[A-Za-z][A-Za-z0-9]*(,[A-Za-z][A-Za-z0-9]*)*$/.test(flagsOn)) p.push('LN_FLAGS_ON fora do formato: nomes de flag separados por vírgula, sem espaços nem aspas (ex.: intelligencePessoas)');
    else if (ambFlags !== 'staging' && deploy) p.push(`LN_FLAGS_ON com APP_ENV=${env.APP_ENV || '(vazio)'}: só o staging aceita flags por variável (ADR-022)`);
  }
  if (prod && env.DIAG_XFF !== undefined && env.DIAG_XFF !== '') p.push('DIAG_XFF definida em produção: o diagnóstico de proxies (contagem de X-Forwarded-For) é só do staging, temporário');

  return p;
}

/** Lista de flags normalizada (ordenada, sem espaços) de `LN_FLAGS_ON` ou de release.json.flagsLigadas. */
export const flagsNormalizadas = (v) => (Array.isArray(v) ? v : String(v ?? '').split(',')).map((s) => String(s).trim()).filter(Boolean).sort().join(',');

/** ADR-022: em execução e no build, LN_FLAGS_ON tem de ser exatamente o que o release.json (`flagsLigadas`) diz; sem flags no pacote, a variável não pode existir. */
export function flagsProblems(env, release) {
  const rel = flagsNormalizadas(release?.flagsLigadas);
  const cur = flagsNormalizadas(env.LN_FLAGS_ON);
  if (cur === rel) return [];
  return [rel
    ? `LN_FLAGS_ON="${env.LN_FLAGS_ON ?? ''}" difere do release.json (flagsLigadas=${rel}): defina LN_FLAGS_ON=${rel}`
    : `LN_FLAGS_ON="${env.LN_FLAGS_ON}" definida, mas o pacote não liga nenhuma flag (release.json.flagsLigadas vazio): apague a variável do app`];
};

// Atribuições em arquivos de deploy/IaC/scripts de produção. Citar o NOME (ex.: no contrato de variáveis, como proibida) não reprova.
export const ASSIGN_STUDIO = /LN_STUDIO_TEST_SESSION["']?\s*[=:]/;
export const ASSIGN_PORTAL_MOCK = /PORTAL_(?:SOURCE|MODE)["']?\s*[=:]\s*["']?(?:mock|intelligence)\b/i;

// Vitrine (R8): ATRIBUIÇÃO de PORTAL_VITRINE (`PORTAL_VITRINE=1`, `PORTAL_VITRINE: '1'`, `"PORTAL_VITRINE": "1"`); LER (`process.env.PORTAL_VITRINE === '1'`) ou citar o nome não conta.
// B1: ATRIBUICAO das variaveis da dispensa em configuracao de deploy (ler ou citar o nome nao conta).
export const ASSIGN_WAIVER = /LN_BACKUP_(?:WAIVER_(?:REF|UNTIL)|VERTRA_SNAPSHOT_AT)["']?\s*(?::|=(?!=))\s*["']?[^\s"',}=]/;
export const ASSIGN_FLAGS = /LN_FLAGS_ON["']?\s*(?::|=(?!=))\s*["']?[^\s"',}=]/;
export const ASSIGN_VITRINE =/PORTAL_VITRINE["']?\s*(?::|=(?!=))\s*["']?[^\s"',}=]/;
// Marcadores que só existem com a vitrine ligada (Security R5/R8): a home de produção, e de staging sem vitrine, não pode conter nenhum.
export const VITRINE_MARCADORES = ['Conteúdo de demonstração', 'MOCK · dados de exemplo', '[MOCK]'];
export const VITRINE_BANNER = 'Conteúdo de demonstração';
