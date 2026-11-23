// Bootstrap do primeiro administrador de STAGING (só staging). Mesmo molde do seed: APP_ENV=staging obrigatório; produção, vazio e qualquer outro valor recusam.
//   node dist/staging-admin.js [--email <algo@dominio.invalid>] [--recreate]
// Cria UM administrador com e-mail de teste (.invalid), senha inicial aleatória e TOTP já enrolado (login completo conferido). Os segredos (senha, segredo do TOTP,
// URI para o autenticador e códigos de recuperação) saem SÓ no terminal de quem roda, UMA vez: se a saída não for um terminal (pipe, arquivo, CI), recusa ANTES de
// criar qualquer coisa. Nada é gravado em log, arquivo ou auditoria; nunca imprime URL de banco, PEM nem BETTER_AUTH_SECRET.
// Idempotente: se o administrador já existe, não faz nada e NÃO reexibe segredo; `--recreate` apaga só esse administrador e gera segredos novos.
// Produção NÃO usa isto: o 1º administrador de produção é uma cerimônia à parte (Security + proprietário).
// Build: npm run build:staging-admin -w @ln/workers. Variáveis: DATABASE_URL (+ DB_SSL_*_PEM), BETTER_AUTH_SECRET (≥ 32), BETTER_AUTH_URL (origem do Studio).
import { bootstrapStagingAdmin, assertStagingEmail, STAGING_ADMIN_DEFAULT_EMAIL, type Auth, type Db, type StagingAdminDeps } from '@ln/auth';
import { getRuntime } from '@ln/auth/runtime';
import { assertStaging, SeedRefused } from './seed-staging';

export async function run(
  argv: string[],
  env: Record<string, string | undefined> = process.env,
  out: (s: string) => void = (s) => process.stdout.write(`${s}\n`),
  /** Só testes: dependências já montadas (sem Pool do ambiente). */
  injected?: StagingAdminDeps,
  /** A saída é um terminal interativo? (padrão: process.stdout.isTTY) */
  isTty: boolean = process.stdout.isTTY === true,
): Promise<number> {
  const opt = (name: string) => {
    const i = argv.indexOf(name);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const known = new Set(['--email', '--recreate']);
  const stray = argv.filter((a, i) => a.startsWith('--') && !known.has(a) && argv[i - 1] !== '--email');
  if (stray.length > 0) {
    out('uso: staging-admin [--email <algo@dominio.invalid>] [--recreate]');
    return 2;
  }
  try {
    assertStaging(env);
  } catch (e) {
    out(e instanceof SeedRefused ? e.message : 'recusado');
    return 2;
  }
  let email: string;
  try {
    email = assertStagingEmail(opt('--email') ?? STAGING_ADMIN_DEFAULT_EMAIL);
  } catch (e) {
    out((e as Error).message);
    return 2;
  }
  // Segredo só em terminal: pipe/arquivo/CI recusa ANTES de criar o usuário (senão o administrador nasceria e o segredo se perderia).
  if (!isTty) {
    out('recusado: a saída não é um terminal interativo; os segredos só podem aparecer no terminal de quem roda (sem pipe, arquivo ou log).');
    return 2;
  }
  let deps = injected;
  if (!deps) {
    const missing = ['DATABASE_URL', 'BETTER_AUTH_SECRET'].filter((k) => !env[k]);
    if (missing.length > 0 || (env.BETTER_AUTH_SECRET ?? '').length < 32) {
      out(`variáveis ausentes ou inválidas: ${missing.length ? missing.join(', ') : 'BETTER_AUTH_SECRET (mínimo 32 caracteres)'}`);
      return 2;
    }
    const rt = getRuntime(env);
    if (!rt) {
      out('banco ou autenticação não configurados (confira DATABASE_URL, DB_SSL_*_PEM e BETTER_AUTH_SECRET).');
      return 2;
    }
    deps = { db: rt.db as Db, auth: rt.auth as Auth, handle: rt.handle, baseURL: env.BETTER_AUTH_URL ?? 'http://localhost:3000' };
  }
  let r;
  try {
    r = await bootstrapStagingAdmin(deps, { email, recreate: argv.includes('--recreate') });
  } catch (e) {
    out(`falha ao criar o administrador (nada ficou criado): ${e instanceof Error ? e.message : 'erro'}`); // a mensagem nunca carrega segredo
    return 1;
  }
  if (r.status === 'refused') {
    out(`recusado: ${r.reason}`);
    return 1;
  }
  if (r.status === 'exists') {
    out(`O administrador de staging ${r.email} já existe. Nada foi alterado e nenhum segredo é exibido de novo. Para apagar só esse administrador e gerar segredos novos, rode com --recreate.`);
    return 0;
  }
  out('================ ADMINISTRADOR DE STAGING (mostrado UMA vez) ================');
  out(`e-mail:           ${r.email}`);
  out(`senha inicial:    ${r.password}`);
  out(`segredo do TOTP:  ${r.totpSecret}`);
  out(`URI (autenticador): ${r.totpUri}`);
  out(`códigos de recuperação: ${r.backupCodes.join(' ')}`);
  out('Guarde agora no seu cofre; esta tela não é gravada em lugar nenhum. Troque a senha no primeiro acesso.');
  out('===============================================================================');
  return 0;
}

const invokedDirectly = typeof process !== 'undefined' && process.argv[1] !== undefined && /staging-admin\.(js|ts)$/.test(process.argv[1]);
if (invokedDirectly) {
  run(process.argv.slice(2)).then(
    (code) => process.exit(code),
    (e: unknown) => {
      console.error(`falha: ${e instanceof Error ? e.message : 'erro'}`); // só a mensagem
      process.exit(1);
    },
  );
}
