// Variáveis que existem SÓ para teste e nunca podem estar em staging, produção nem no build de deploy.
// Alerta do PM (22/11/2026): LN_STUDIO_TEST_SESSION (sessão simulada do Studio, definida em apps/web/playwright.config.ts)
// jamais pode existir em ambiente da Vertra; PORTAL_SOURCE=mock e PORTAL_MODE=mock só em teste.
// Também só de CI (scaffold, packages/db/src/migrate.ts): CI=true libera DB_SSL_MODE=disable; em deploy nenhum dos dois pode existir.
const DEPLOY_ENVS = ['staging', 'production', 'homologacao', 'producao']; // o scaffold cita homologacao/producao; aceitamos os dois vocabulários

/**
 * Exceção ESTREITA do CI=true (decisão do PM 24/11/2026, opção A apertada; requisitos da Security): o build do .next de produção roda no runner do GitHub Actions, que define CI=true.
 * Vale SÓ se: (1) o chamador pediu (`permitir`; padrão DESLIGADO: start-web, migrate.mjs e ci-checks nunca pedem; só guard-env e build-web, que o workflow chama sem flag);
 * (2) não é o processo da migração; (3) CI === 'true' (sem diferença de caixa, como a regra antiga) E GITHUB_ACTIONS === 'true' (comparação EXATA, sem trim nem caixa);
 * (4) o processo NÃO tem a assinatura de um app da Vertra (HOST=0.0.0.0 e PORT=80, definidos pela plataforma; o usuário não os forja; o workflow não os define).
 * O que o CI destravaria (DB_SSL_MODE=disable, REDIS_SSL_MODE=disable) continua reprovado em deploy, com ou sem esta exceção.
 */
export function ciDoRunnerAceito(env, { permitir = false, migracao = false } = {}) {
  if (!permitir || migracao) return false;
  if (String(env.CI ?? '').toLowerCase() !== 'true') return false;
  if (String(env.GITHUB_ACTIONS ?? '') !== 'true') return false;
  if (String(env.HOST ?? '') === '0.0.0.0' && String(env.PORT ?? '') === '80') return false;
  return true;
}

/** Linha de log quando a exceção se aplica (guard-env e build-web imprimem). */
export const LOG_CI_RUNNER = 'CI=true aceito: runner do GitHub Actions';

/** Problemas no ambiente do processo. `deploy` força o modo estrito (staging/produção/build de deploy). `permitirCiRunner` liga a exceção ciDoRunnerAceito (só guard-env e build-web). */
export function envProblems(env = process.env, { deploy = false, migracao = false, permitirCiRunner = false } = {}) {
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
    // TLS desligado (banco e Redis) é o que CI=true destrava no código do app (packages/db/src/tls.ts, migrate.ts, apps/workers/src/redis-tls.ts, verify-migrations.mjs): em deploy nunca, com CI ou sem.
    if (String(env.REDIS_SSL_MODE ?? '').toLowerCase() === 'disable') p.push('REDIS_SSL_MODE=disable em ambiente de deploy: TLS com certificado de cliente é obrigatório na Vertra (disable é só do CI)');
    // CI=true: reprova, exceto na exceção estreita ciDoRunnerAceito (acima) para o build no runner do GitHub Actions; o TLS desligado já foi reprovado acima, com ou sem ela.
    if (String(env.CI ?? '').toLowerCase() === 'true' && !ciDoRunnerAceito(env, { permitir: permitirCiRunner, migracao })) p.push('CI=true em ambiente de deploy: essa variável libera DB_SSL_MODE=disable e é só do CI');
    // A Vertra aceita GITHUB_ACTIONS no painel; com a assinatura de app da Vertra (HOST=0.0.0.0, PORT=80) a variável é do runner do GitHub e não pode existir ali (Security 24/11).
    if (String(env.GITHUB_ACTIONS ?? '') !== '' && String(env.HOST ?? '') === '0.0.0.0' && String(env.PORT ?? '') === '80') p.push('GITHUB_ACTIONS definida em app da Vertra (HOST=0.0.0.0, PORT=80): a variável é do runner do GitHub Actions e não pode existir no ambiente do app');
  }
  const prod = ['production', 'producao'].includes(String(env.APP_ENV ?? '').toLowerCase());
  // ADR-022 (DP-38): flags de produto por variável SÓ no staging, lista de nomes separada por vírgula. Produção liga por commit revisado (FLAG_RELEASES), nunca por variável.
  // A barreira é pelo APP_ENV, como a das outras do piloto: na Vertra o guard roda SEM --deploy. Fora do staging (produção, APP_ENV ausente ou typo)
  // a variável reprova — em produção ela ligaria flag de produto pelo painel, que é exatamente o que a ADR-022 proíbe.
  const flagsOn = String(env.LN_FLAGS_ON ?? '');
  if (flagsOn.trim() !== '') {
    const ambFlags = String(env.APP_ENV ?? '').trim().toLowerCase();
    if (prod) p.push(`LN_FLAGS_ON definida em produção: flags de produto por variável só existem no staging (ADR-022); em produção a flag liga por commit revisado em FLAG_RELEASES${/openbotDispatch/.test(flagsOn) ? ' (a flag openbotDispatch, DP-41, nunca liga em produção)' : ''}`);
    else if (ambFlags !== 'staging') p.push(`LN_FLAGS_ON com APP_ENV=${env.APP_ENV || '(vazio)'}: só o staging aceita flags por variável (ADR-022)`);
    else if (!/^[A-Za-z][A-Za-z0-9]*(,[A-Za-z][A-Za-z0-9]*)*$/.test(flagsOn)) p.push('LN_FLAGS_ON fora do formato: nomes de flag separados por vírgula, sem espaços nem aspas (ex.: intelligencePessoas)');
  }
  // Piloto OpenBot (DP-41, item 5 do piloto): TODAS as variáveis do piloto só existem com APP_ENV=staging.
  // A barreira NÃO depende de --deploy: na Vertra o build_command e o start_command chamam `guard-env.mjs` SEM a flag, então a regra
  // tem de valer pelo APP_ENV sozinho. Produção (ou APP_ENV ausente/inesperado: typo, variável removida) não sobe com nenhuma delas.
  // A mensagem nunca repete o valor.
  const ambPiloto = String(env.APP_ENV ?? '').trim().toLowerCase();
  const ondePiloto = prod ? 'em produção' : `com APP_ENV=${env.APP_ENV || '(vazio)'}`;
  const RAZAO_PILOTO = {
    LN_OPENBOT_PILOT: 'o piloto OpenBot só existe com APP_ENV=staging (DP-41)',
    OPENBOT_HMAC_SECRET: 'o segredo do OpenBot é só do staging (DP-41)',
    OPENBOT_HMAC_SECRET_PREVIOUS: 'o segredo do OpenBot é só do staging (DP-41)',
    // O módulo de fiação (LN_OPENBOT_PILOT_WIRING é um especificador de import: apontá-lo para outro módulo em produção seria carregar código arbitrário)
    // e o prazo de espera do gateway (apps/workers: editorial-factory.ts, openbot-wiring.ts).
    LN_OPENBOT_PILOT_WIRING: 'variável do piloto OpenBot, só do staging (DP-41)',
    LN_OPENBOT_GATEWAY_TIMEOUT_MS: 'variável do piloto OpenBot, só do staging (DP-41)',
  };
  if (ambPiloto !== 'staging') {
    for (const [nome, razao] of Object.entries(RAZAO_PILOTO)) if (String(env[nome] ?? '').trim() !== '') p.push(`${nome} definida ${ondePiloto}: ${razao}`);
  }
  // CLI do piloto (operador/agente fora da Vertra: packages/openbot/bin): o app NÃO lê nenhuma destas; o valor do cofre fica no arquivo
  // apontado por LN_HMAC_SECRET_FILE, nunca no painel. Definidas num deploy, reprovam — evita colar no app o que é do operador.
  // Esta é a única família que continua dependendo de --deploy: em desenvolvimento (sem a flag) elas são aceitas e não fazem mal ao app.
  if (deploy) for (const nome of ['LN_API_BASE', 'LN_AGENT_ACCOUNT', 'LN_HMAC_SECRET_FILE', 'LN_HMAC_SECRET', 'LN_WORKER_ID']) if (String(env[nome] ?? '').trim() !== '') p.push(`${nome} definida no app num deploy: variável da CLI do piloto (operador/agente, fora da Vertra), não do app; apague`);
  // Diagnóstico de X-Forwarded-For: mesma regra do piloto, pelo APP_ENV, sem depender da flag (é o caso da variável fantasma que sobra
  // no ambiente e seria exatamente o que o guard tem de pegar).
  if (ambPiloto !== 'staging' && env.DIAG_XFF !== undefined && env.DIAG_XFF !== '') p.push(`DIAG_XFF definida ${ondePiloto}: o diagnóstico de proxies (contagem de X-Forwarded-For) é só do staging, temporário`);

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

/** Jobs de Intelligence por variável (só staging, só o que o release.json.jobsIntelligence liga). 'alertas' = LN_INTELLIGENCE_ALERTS + LN_INTELLIGENCE_PESSOAS;
 *  'releitura' = LN_INTELLIGENCE_REREAD + LN_INTELLIGENCE_PESSOAS + LN_REREAD_SEED (valor definido pelo PM, não vazio). Em produção nada disto liga (nem BRIGHTDATA_API_KEY). */
export function jobsProblems(env, release) {
  const rel = Array.isArray(release?.jobsIntelligence) ? release.jobsIntelligence : [];
  const alertas = rel.includes('alertas'), releitura = rel.includes('releitura');
  const want = { LN_INTELLIGENCE_ALERTS: alertas, LN_INTELLIGENCE_PESSOAS: alertas || releitura, LN_INTELLIGENCE_REREAD: releitura };
  const amb = String(env.APP_ENV ?? '').trim().toLowerCase();
  const p = [];
  for (const [nome, ligada] of Object.entries(want)) {
    const cur = String(env[nome] ?? '').trim();
    if (ligada && cur !== 'on') p.push(`${nome}="${env[nome] ?? ''}" difere do release.json (jobsIntelligence=${rel.join(',')}): defina ${nome}=on`);
    else if (!ligada && cur !== '') p.push(`${nome} definida, mas o pacote não liga esse job (release.json.jobsIntelligence=[${rel.join(',')}]): apague a variável do app`);
  }
  const seed = String(env.LN_REREAD_SEED ?? '').trim();
  if (releitura && seed === '') p.push('jobsIntelligence=releitura exige LN_REREAD_SEED (conjunto de cargos a reler; valor definido pelo PM)');
  else if (!releitura && seed !== '') p.push('LN_REREAD_SEED definida, mas o pacote não liga a releitura: apague a variável do app');
  if (!releitura && String(env.BRIGHTDATA_API_KEY ?? '').trim() !== '' && amb !== 'staging') p.push('BRIGHTDATA_API_KEY definida fora do staging: a leitura por provedor é só do staging (ADR-022 adendo 2)');
  if (rel.length) {
    if (amb !== 'staging') p.push(`jobsIntelligence=${rel.join(',')} com APP_ENV=${env.APP_ENV || '(vazio)'}: só o staging`);
    if (!flagsNormalizadas(env.LN_FLAGS_ON).split(',').includes('intelligencePessoas')) p.push(`jobsIntelligence=${rel.join(',')} exige LN_FLAGS_ON com intelligencePessoas (ADR-022)`);
  }
  return p;
}

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
