// CLI da cerimônia do PRIMEIRO administrador de PRODUÇÃO. ATO RESERVADO DO PROPRIETÁRIO (decisão 14 do Security; roteiro r0-preparacao/seguranca/20_cerimonia-primeiro-admin-producao.md;
// decisão PM-2026-11-23-N): roda NA MÁQUINA DO PROPRIETÁRIO, em terminal interativo (Windows Terminal ou PowerShell), com os valores de conexão do banco injetados só em memória.
//   node dist/prod-admin.js --confirm-production-bootstrap             (criar o 1º administrador)
//   node dist/prod-admin.js --revoke --confirm-production-revoke       (S8: revogar o administrador; frase própria; banned + sessões antes de apagar)
// Limites (todos ANTES de abrir qualquer conexão):
//   P1 APP_ENV exatamente `production` E DATABASE_URL = o banco de produção registrado em infra/vertra/bindings.json (host e nome; produção sem vínculo = recusa);
//   P2 a flag `--confirm-production-bootstrap` E a frase digitada (pedida pela cerimônia);
//   P3 só interativo: stdin E stdout são terminal (TTY). SEM `--secret-file`, `--tty`, `--email` ou qualquer outro argumento; sem pipe; senha, e-mail e códigos nunca por argumento ou variável;
//   P4–P9 identidade, senha, 2º fator com o celular do proprietário, códigos de recuperação, só o primeiro e auditoria: ver packages/auth/src/prod-admin.ts;
//   P10 saída sem URL de banco, PEM, senha, segredo TOTP ou códigos (filtro de saída e guardas de processo); S2 a tela e o histórico de rolagem são limpos depois de cada etapa sensível;
//   S5 nada vai para a área de transferência (a CLI não oferece "copiar").
// Build: npm run build:prod-admin -w @ln/workers. Variáveis: DATABASE_URL + DB_SSL_*_PEM (do script de credenciais, só no ambiente do processo), BETTER_AUTH_SECRET (≥ 32, O MESMO do app web:
// o segredo do TOTP é cifrado com ele; rotacioná-lo depois invalida o 2º fator), BETTER_AUTH_URL (https://, origem do Studio), LN_COMMIT_SHA (opcional, vai na auditoria).
import { bootstrapProductionAdmin, revokeProductionAdmin, type Auth, type Db, type ProdAdminDeps, type ProdAdminIO } from '@ln/auth';
import { getRuntime } from '@ln/auth/runtime';
import { installOutputFilter, installProcessGuards } from '@ln/db/safe-log';
import bindingsFile from '../../../infra/vertra/bindings.json';
import type { BindingsFile } from './staging-admin';

/** Limpa a tela (2J), o histórico de rolagem (3J) e leva o cursor ao início (H). */
export const CLEAR_SEQUENCE = '\u001b[3J\u001b[2J\u001b[H';

export class ProdAdminRefused extends Error {}

export function assertProduction(env: Record<string, string | undefined>): void {
  if (env.APP_ENV !== 'production') throw new ProdAdminRefused(`recusado: APP_ENV=${env.APP_ENV ? env.APP_ENV : '(vazio)'}; a cerimônia de produção só vale com APP_ENV=production`);
}

/** P1: DATABASE_URL precisa apontar para o banco de produção registrado. Lança (sem repetir a URL) se não bater ou se a produção não tiver vínculo. */
export function assertProductionBound(databaseUrl: string | undefined, bindings: BindingsFile = bindingsFile as BindingsFile): void {
  const reg = bindings.ambientes?.production;
  if (!reg || !reg.dbHost || !reg.dbName) throw new ProdAdminRefused('recusado: produção sem vínculo de banco em infra/vertra/bindings.json (a produção ainda não foi registrada)');
  let u: URL;
  try {
    u = new URL(databaseUrl ?? '');
  } catch {
    throw new ProdAdminRefused('recusado: DATABASE_URL ausente ou inválida');
  }
  if (!/^postgres(ql)?:$/.test(u.protocol)) throw new ProdAdminRefused('recusado: DATABASE_URL precisa ser postgres://');
  const host = u.hostname.toLowerCase();
  const database = decodeURIComponent(u.pathname.replace(/^\//, ''));
  if (host !== reg.dbHost.toLowerCase() || database !== reg.dbName) throw new ProdAdminRefused('recusado: DATABASE_URL NÃO aponta para o banco de produção registrado em infra/vertra/bindings.json');
}

interface RawStdin {
  isTTY?: boolean;
  isRaw?: boolean;
  setRawMode?: (raw: boolean) => unknown;
  setEncoding: (e: string) => unknown;
  resume: () => unknown;
  pause: () => unknown;
  on: (ev: 'data', fn: (chunk: string) => void) => unknown;
  off: (ev: 'data', fn: (chunk: string) => void) => unknown;
}
interface Out {
  write: (s: string) => unknown;
}

export class TerminalAborted extends Error {
  constructor() {
    super('interrompido');
    this.name = 'ProdAdminAborted';
  }
}

/** Terminal do proprietário: perguntas com eco e SEM eco (modo bruto), e limpeza da tela com o histórico de rolagem. Nada vai para a área de transferência nem para arquivo. */
export class TerminalIO implements ProdAdminIO {
  constructor(private readonly stdin: RawStdin = process.stdin as unknown as RawStdin, private readonly stdout: Out = process.stdout) {}

  ask(prompt: string): Promise<string> {
    return this.read(prompt, true);
  }

  askHidden(prompt: string): Promise<string> {
    return this.read(prompt, false);
  }

  show(line: string): void {
    this.stdout.write(`${line}\n`);
  }

  clear(): void {
    this.stdout.write(CLEAR_SEQUENCE);
  }

  private read(prompt: string, echo: boolean): Promise<string> {
    return new Promise((resolve, reject) => {
      const { stdin, stdout } = this;
      stdout.write(prompt);
      const wasRaw = stdin.isRaw === true;
      stdin.setRawMode?.(true);
      stdin.setEncoding('utf8');
      stdin.resume();
      let buf = '';
      let esc = false;
      const finish = (fn: () => void) => {
        stdin.off('data', onData);
        stdin.setRawMode?.(wasRaw);
        stdin.pause();
        stdout.write('\n');
        fn();
      };
      const onData = (chunk: string) => {
        for (const ch of chunk) {
          if (esc) {
            if (/[A-Za-z~]/.test(ch)) esc = false; // fim de uma sequência de escape (setas etc.): descartada
            continue;
          }
          if (ch === '\u001b') {
            esc = true;
            continue;
          }
          if (ch === '\r' || ch === '\n') return finish(() => resolve(buf));
          if (ch === '\u0003' || (ch === '\u0004' && buf === '')) return finish(() => reject(new TerminalAborted())); // Ctrl-C / Ctrl-D
          if (ch === '\u007f' || ch === '\b') {
            if (buf.length > 0) {
              buf = buf.slice(0, -1);
              if (echo) stdout.write('\b \b');
            }
            continue;
          }
          if (ch < ' ') continue; // outros controles
          buf += ch;
          if (echo) stdout.write(ch);
        }
      };
      stdin.on('data', onData);
    });
  }
}

export interface CliContext {
  /** stdin E stdout são terminal interativo? (padrão: process) */
  tty?: boolean;
  bindings?: BindingsFile;
  /** Só testes: terminal falso. Padrão: o terminal real. */
  io?: ProdAdminIO;
}

const USAGE = 'uso: prod-admin --confirm-production-bootstrap   (criar o 1º administrador)   |   prod-admin --revoke --confirm-production-revoke   (revogar o administrador). Sem outros argumentos: senha, e-mail e códigos são digitados no terminal.';

export async function run(
  argv: string[],
  env: Record<string, string | undefined> = process.env,
  out: (s: string) => void = (s) => process.stdout.write(`${s}\n`),
  /** Só testes: dependências já montadas (sem Pool do ambiente). */
  injected?: ProdAdminDeps,
  ctx: CliContext = {},
): Promise<number> {
  // P3: nenhum argumento além da confirmação (nada de --secret-file, --tty, --email ...). Dois modos, sem mistura: criar OU revogar (S8)
  const create = argv.length === 1 && argv[0] === '--confirm-production-bootstrap';
  const revoke = argv.length === 2 && argv.includes('--revoke') && argv.includes('--confirm-production-revoke');
  if (argv.length > 0 && !create && !revoke) {
    out(USAGE);
    return 2;
  }
  // P1: ambiente e vínculo do banco, antes de qualquer conexão
  try {
    assertProduction(env);
    assertProductionBound(env.DATABASE_URL, ctx.bindings);
  } catch (e) {
    out(e instanceof ProdAdminRefused ? e.message : 'recusado');
    return 2;
  }
  // P2: confirmação explícita por flag
  if (!create && !revoke) {
    out(`recusado: falta --confirm-production-bootstrap (criar) ou --revoke --confirm-production-revoke (revogar). ${USAGE}`);
    return 2;
  }
  // P3: só interativo (S3: Windows Terminal ou PowerShell; mintty/Git Bash costuma não ser TTY para o Node)
  const tty = ctx.tty ?? (process.stdout.isTTY === true && process.stdin.isTTY === true);
  if (!tty) {
    out('recusado: a cerimônia exige terminal interativo na entrada E na saída (sem pipe, arquivo ou CI). Use o Windows Terminal ou o PowerShell; o Git Bash (mintty) costuma não ser TTY para o Node.');
    return 2;
  }
  let deps = injected;
  if (!deps) {
    const secret = env.BETTER_AUTH_SECRET ?? '';
    if (secret.length < 32) {
      out('BETTER_AUTH_SECRET ausente ou com menos de 32 caracteres: use EXATAMENTE o segredo do app web de produção (o segredo do TOTP é cifrado com ele; um valor diferente cria o administrador, mas o código do celular não valeria no web).');
      return 2;
    }
    if (!/^https:\/\/[^/\s]+/.test(env.BETTER_AUTH_URL ?? '')) {
      out('BETTER_AUTH_URL ausente ou sem https:// (origem pública do Studio de produção).');
      return 2;
    }
    const rt = getRuntime(env);
    if (!rt) {
      out('banco ou autenticação não configurados (confira DATABASE_URL, DB_SSL_*_PEM e BETTER_AUTH_SECRET).');
      return 2;
    }
    deps = { db: rt.db as Db, auth: rt.auth as Auth, handle: rt.handle, baseURL: env.BETTER_AUTH_URL! };
  }
  const io = ctx.io ?? new TerminalIO();
  if (revoke) {
    const v = await revokeProductionAdmin(deps, io, { commit: env.LN_COMMIT_SHA ?? null });
    if (v.status === 'revoked') {
      out(`Administrador de produção revogado (domínio ${v.emailDomain}): banido, sessões apagadas e removido; auditado como revogacao_admin_producao. Feche este terminal. Para ter um administrador de novo, repita a cerimônia de criação.`);
      return 0;
    }
    if (v.status === 'refused') {
      out(`recusado: ${v.reason}`);
      return 2;
    }
    out(`a revogação parou na etapa "${v.step}": o administrador ficou BANIDO e sem sessões (estado seguro) e o evento revogacao_admin_producao_incompleta foi auditado. Rode de novo ou chame o Security.`);
    return 1;
  }
  const r = await bootstrapProductionAdmin(deps, io, { commit: env.LN_COMMIT_SHA ?? null });
  if (r.status === 'created') {
    out(`Administrador de produção criado (domínio ${r.emailDomain}) e auditado como bootstrap_admin_producao. Feche este terminal. Nenhum segredo foi gravado.`);
    return 0;
  }
  if (r.status === 'refused') {
    out(`recusado: ${r.reason}`);
    return 2;
  }
  out(`falhou na etapa "${r.step}" (${r.reason}). Nada ficou criado; o evento bootstrap_admin_producao_falhou foi auditado. Pode repetir a cerimônia do zero.`);
  return 1;
}

const invokedDirectly = typeof process !== 'undefined' && process.argv[1] !== undefined && /prod-admin\.(js|ts)$/.test(process.argv[1]);
if (invokedDirectly) {
  installOutputFilter(); // P10: nenhuma saída leva PEM nem credencial de URL
  installProcessGuards();
  run(process.argv.slice(2)).then(
    (code) => process.exit(code),
    (e: unknown) => {
      const x = e as { name?: string; code?: string };
      console.error(`falha: ${x?.name ?? 'Erro'}${x?.code ? ` ${x.code}` : ''}`); // só a classe e o código, nunca a mensagem (pode trazer host/credencial)
      process.exit(1);
    },
  );
}
