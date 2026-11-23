// Bootstrap do primeiro administrador de STAGING (só staging). Decisão de segurança: r0-preparacao/seguranca/14_decisao-bootstrap-admin-staging.md.
//   node dist/staging-admin.js --confirm-staging-bootstrap (--tty | --secret-file <caminho>) [--email <algo@dominio.invalid>] [--recreate]
// Limites (todos ANTES de criar qualquer coisa):
//   L1 APP_ENV exatamente `staging` E DATABASE_URL = o banco de staging registrado em infra/vertra/bindings.json (host e nome; o arquivo é embutido no build,
//      como a barreira `assertBound` do migrate.mjs). Produção, vazio, outro valor ou outro banco recusam com saída 2, sem abrir conexão.
//   L2 `--confirm-staging-bootstrap` obrigatório, também no `--recreate`.
//   L3 e-mail `^[a-z0-9._-]+@[a-z0-9.-]+\.invalid$` (padrão admin.staging@loyaltynews.invalid), papel admin, nome "Admin de staging".
//   L4 idempotente: se existe, não muda senha nem 2º fator e não reexibe segredo; se existe OUTRO admin, recusa; `--recreate` só apaga o admin de staging (.invalid).
//   L5 senha gerada pela CLI (CSPRNG, 32 caracteres); nunca aceita senha por argumento nem por variável de ambiente.
//   L6 TOTP enrolado em processo e login completo (senha + código) conferido antes de entregar.
//   L7 entrega UMA vez, por UM modo: `--tty` (humano; só se stdout E stdin são terminal) ou `--secret-file <caminho>` (operador agente: arquivo JSON criado de forma exclusiva
//      com permissão restrita, FORA do checkout, decidido ANTES de criar o usuário; stdout não leva segredo; quem recebe guarda no Cofre e apaga o arquivo).
//   L8 stdout/stderr nunca levam URL de banco, PEM, senha, segredo TOTP nem códigos (fora do `--tty`).
//   L9 auditoria `bootstrap_admin_staging` (id, e-mail .invalid, data, commit), sem segredo.
// Build: npm run build:staging-admin -w @ln/workers. Variáveis: DATABASE_URL (+ DB_SSL_*_PEM), BETTER_AUTH_SECRET (≥ 32), BETTER_AUTH_URL (origem do Studio), LN_COMMIT_SHA (opcional, vai na auditoria).
import { chmodSync, closeSync, existsSync, fstatSync, lstatSync, openSync, unlinkSync, writeSync } from 'node:fs';
import { dirname, isAbsolute, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { bootstrapStagingAdmin, assertStagingEmail, STAGING_ADMIN_DEFAULT_EMAIL, type Auth, type Db, type StagingAdminDeps, type StagingAdminResult } from '@ln/auth';
import { getRuntime } from '@ln/auth/runtime';
import bindingsFile from '../../../infra/vertra/bindings.json';
import { assertStaging, SeedRefused } from './seed-staging';

export interface BindingsFile {
  ambientes?: Record<string, { dbHost: string | null; dbName: string | null } | undefined>;
}

/** L1: DATABASE_URL precisa apontar para o banco registrado para staging. Lança (sem repetir a URL) se não bater ou se não houver vínculo. */
export function assertStagingBound(databaseUrl: string | undefined, bindings: BindingsFile = bindingsFile as BindingsFile): void {
  const reg = bindings.ambientes?.staging;
  if (!reg || !reg.dbHost || !reg.dbName) throw new SeedRefused('staging sem vínculo de banco em infra/vertra/bindings.json: recusado');
  let u: URL;
  try {
    u = new URL(databaseUrl ?? '');
  } catch {
    throw new SeedRefused('DATABASE_URL ausente ou inválida: recusado');
  }
  if (!/^postgres(ql)?:$/.test(u.protocol)) throw new SeedRefused('DATABASE_URL precisa ser postgres://: recusado');
  const host = u.hostname.toLowerCase();
  const database = decodeURIComponent(u.pathname.replace(/^\//, ''));
  if (host !== reg.dbHost.toLowerCase() || database !== reg.dbName) {
    throw new SeedRefused('DATABASE_URL NÃO aponta para o banco de staging registrado em infra/vertra/bindings.json: recusado');
  }
}

/** Raízes de checkout a evitar: onde o processo roda, onde está este programa (apps/workers/dist ou src) e qualquer pasta acima com `.git`. */
function insideCheckout(path: string, roots: string[]): boolean {
  const inside = (root: string) => {
    const rel = relative(root, path);
    return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
  };
  if (roots.some(inside)) return true;
  for (let dir = dirname(path); ; dir = dirname(dir)) {
    if (existsSync(resolve(dir, '.git'))) return true;
    if (dirname(dir) === dir) break;
  }
  return false;
}

export interface CliContext {
  /** stdout E stdin são terminal interativo? (padrão: process) */
  tty?: boolean;
  bindings?: BindingsFile;
  /** Raízes do checkout (testes). Padrão: cwd e a raiz do repositório deste programa. */
  checkoutRoots?: string[];
  /** Só testes: pula a checagem de bits de permissão (Windows não tem). */
  posixModes?: boolean;
}

/** Mensagem segura de um erro: só mensagens que nós escrevemos; de driver/rede, só a classe e o código (nunca host, URL ou credencial). */
const safeError = (e: unknown): string => {
  const x = e as { name?: string; code?: string; message?: string };
  const ours = /^(entrada inicial|ativação do 2º fator|confirmação do TOTP|o Better Auth|o login completo|e-mail do administrador|senha com menos)/.test(x?.message ?? '');
  return ours ? String(x.message) : `${x?.name ?? 'Erro'}${x?.code ? ` ${x.code}` : ''}`;
};

export async function run(
  argv: string[],
  env: Record<string, string | undefined> = process.env,
  out: (s: string) => void = (s) => process.stdout.write(`${s}\n`),
  /** Só testes: dependências já montadas (sem Pool do ambiente). */
  injected?: StagingAdminDeps,
  ctx: CliContext = {},
): Promise<number> {
  const opt = (name: string) => {
    const i = argv.indexOf(name);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const withValue = new Set(['--email', '--secret-file']);
  const flags = new Set(['--recreate', '--tty', '--confirm-staging-bootstrap']);
  const stray = argv.filter((a, i) => (a.startsWith('--') && !withValue.has(a) && !flags.has(a)) || (!a.startsWith('--') && !withValue.has(argv[i - 1] ?? '')));
  const usage = 'uso: staging-admin --confirm-staging-bootstrap (--tty | --secret-file <caminho fora do repositório>) [--email <algo@dominio.invalid>] [--recreate]';
  if (stray.length > 0) {
    out(usage);
    return 2;
  }
  // L1: ambiente e vínculo do banco, antes de qualquer conexão.
  try {
    assertStaging(env);
    assertStagingBound(env.DATABASE_URL, ctx.bindings);
  } catch (e) {
    out(e instanceof SeedRefused ? e.message : 'recusado');
    return 2;
  }
  // L2: confirmação explícita (também no --recreate).
  if (!argv.includes('--confirm-staging-bootstrap')) {
    out('recusado: falta --confirm-staging-bootstrap (confirmação explícita; vale também para --recreate).');
    return 2;
  }
  // L3: e-mail.
  let email: string;
  try {
    email = assertStagingEmail(opt('--email') ?? STAGING_ADMIN_DEFAULT_EMAIL);
  } catch (e) {
    out((e as Error).message);
    return 2;
  }
  // L7: exatamente um modo de entrega, decidido ANTES de criar o usuário.
  const wantTty = argv.includes('--tty');
  const filePath = opt('--secret-file');
  if (wantTty === (filePath !== undefined)) {
    out(`escolha UM modo de entrega do segredo: --tty (humano) ou --secret-file <caminho>. ${usage}`);
    return 2;
  }
  let fd: number | null = null;
  let secretPath: string | null = null;
  if (wantTty) {
    const tty = ctx.tty ?? (process.stdout.isTTY === true && process.stdin.isTTY === true);
    if (!tty) {
      out('recusado: --tty exige que a saída E a entrada sejam um terminal interativo (sem pipe, arquivo ou CI). Operador agente: use --secret-file.');
      return 2;
    }
  } else {
    secretPath = resolve(filePath!);
    const roots = ctx.checkoutRoots ?? [process.cwd(), resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..')];
    if (insideCheckout(secretPath, roots)) {
      out('recusado: o arquivo de segredo não pode ficar dentro do repositório (checkout).');
      return 2;
    }
    try {
      if (lstatSync(secretPath, { throwIfNoEntry: false })) {
        out('recusado: o arquivo de segredo já existe (criação exclusiva; não sobrescreve).');
        return 2;
      }
      // Criação exclusiva com permissão restrita, ANTES de criar o usuário: se não der para guardar o segredo, nada é criado.
      fd = openSync(secretPath, 'wx', 0o600);
      if (ctx.posixModes ?? process.platform !== 'win32') {
        chmodSync(secretPath, 0o600);
        if ((fstatSync(fd).mode & 0o077) !== 0) throw new Error('permissão do arquivo não ficou restrita');
      }
    } catch {
      if (fd !== null) {
        closeSync(fd);
        fd = null;
        unlinkSync(secretPath);
      }
      out('recusado: não consegui criar o arquivo de segredo de forma exclusiva e restrita (pasta inexistente, sem permissão ou já existe).');
      return 2;
    }
  }
  const discardFile = () => {
    if (fd !== null) closeSync(fd);
    fd = null;
    if (secretPath && existsSync(secretPath)) unlinkSync(secretPath);
  };

  let deps = injected;
  if (!deps) {
    const missing = ['DATABASE_URL', 'BETTER_AUTH_SECRET'].filter((k) => !env[k]);
    if (missing.length > 0 || (env.BETTER_AUTH_SECRET ?? '').length < 32) {
      discardFile();
      out(`variáveis ausentes ou inválidas: ${missing.length ? missing.join(', ') : 'BETTER_AUTH_SECRET (mínimo 32 caracteres)'}`);
      if (missing.includes('BETTER_AUTH_SECRET') || (env.BETTER_AUTH_SECRET ?? '').length < 32) {
        // O plugin de 2º fator CIFRA o segredo do TOTP com o BETTER_AUTH_SECRET: a CLI e o WEB precisam usar o MESMO valor, senão o administrador nasce e o código do autenticador não vale no web.
        out('BETTER_AUTH_SECRET: use EXATAMENTE o segredo do web de staging (≥ 32 caracteres). O segredo do TOTP é cifrado com ele; um valor diferente cria o administrador, mas o login com o código do autenticador falha no web.');
      }
      return 2;
    }
    const rt = getRuntime(env);
    if (!rt) {
      discardFile();
      out('banco ou autenticação não configurados (confira DATABASE_URL, DB_SSL_*_PEM e BETTER_AUTH_SECRET).');
      return 2;
    }
    deps = { db: rt.db as Db, auth: rt.auth as Auth, handle: rt.handle, baseURL: env.BETTER_AUTH_URL ?? 'http://localhost:3000' };
  }
  let r: StagingAdminResult;
  try {
    r = await bootstrapStagingAdmin(deps, { email, recreate: argv.includes('--recreate'), entrega: wantTty ? 'tty' : 'arquivo', commit: env.LN_COMMIT_SHA ?? null });
  } catch (e) {
    discardFile();
    out(`falha ao criar o administrador (nada ficou criado): ${safeError(e)}`);
    return 1;
  }
  if (r.status === 'refused') {
    discardFile();
    out(`recusado: ${r.reason}`);
    return 1;
  }
  if (r.status === 'exists') {
    discardFile();
    out(`O administrador de staging ${r.email} já existe. Nada foi alterado e nenhum segredo é exibido de novo. Para apagar só esse administrador e gerar segredos novos, rode com --recreate --confirm-staging-bootstrap.`);
    return 0;
  }
  if (wantTty) {
    out('================ ADMINISTRADOR DE STAGING (mostrado UMA vez) ================');
    out(`e-mail:           ${r.email}`);
    out(`senha inicial:    ${r.password}`);
    out(`segredo do TOTP:  ${r.totpSecret}`);
    out(`URI (autenticador): ${r.totpUri}`);
    out(`códigos de recuperação: ${r.backupCodes.join(' ')}`);
    out('Guarde agora no seu cofre; esta tela não é gravada em lugar nenhum.');
    out('===============================================================================');
    return 0;
  }
  // Entrega por arquivo: JSON para o Cofre (login + twoStepKey). stdout só diz ONDE está, nunca o conteúdo.
  const payload = JSON.stringify(
    { email: r.email, password: r.password, totpSecret: r.totpSecret, totpUri: r.totpUri, backupCodes: r.backupCodes, aviso: 'Guarde no Cofre do OpenBot (login + twoStepKey) e APAGUE este arquivo agora.' },
    null,
    2,
  );
  try {
    writeSync(fd!, payload);
    closeSync(fd!);
    fd = null;
  } catch {
    discardFile();
    out('o administrador foi criado, mas o arquivo de segredo não pôde ser gravado: rode de novo com --recreate --confirm-staging-bootstrap para gerar segredos novos.');
    return 1;
  }
  out(`Administrador de staging ${r.email} criado. Os segredos foram gravados UMA vez em ${secretPath} (criação exclusiva, permissão restrita). Guarde no Cofre (login + twoStepKey) e apague o arquivo.`);
  return 0;
}

const invokedDirectly = typeof process !== 'undefined' && process.argv[1] !== undefined && /staging-admin\.(js|ts)$/.test(process.argv[1]);
if (invokedDirectly) {
  run(process.argv.slice(2)).then(
    (code) => process.exit(code),
    (e: unknown) => {
      const x = e as { name?: string; code?: string };
      console.error(`falha: ${x?.name ?? 'Erro'}${x?.code ? ` ${x.code}` : ''}`); // só a classe e o código, nunca a mensagem (pode trazer host/credencial)
      process.exit(1);
    },
  );
}

