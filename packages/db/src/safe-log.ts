// Log SEGURO de erros e saída (incidente de 23/11: a chave privada do certificado de cliente saiu no log do worker). Regras:
//  - C3 `safeErr(e)`: só { name, code, message }, com a mensagem saneada (bloco PEM vira `[PEM REMOVIDO]`, credencial de URL vira `esquema://***@`); NUNCA o objeto,
//    `cause`, `options`, `socket`, nem `util.inspect`/`JSON.stringify` do erro;
//  - C1 `onClientError(label)`: ouvinte de 'error' para Pool/Client/IORedis/Worker/Queue (sem ouvinte, o evento vira exceção não tratada e o Node imprime o objeto inteiro,
//    incluindo `_tlsOptions` com ca/cert/key);
//  - C2 `installProcessGuards()`: `unhandledRejection` e `uncaughtException` logam só o `safeErr` e saem com código ≠ 0;
//  - C4 `installOutputFilter()`: defesa em profundidade em process.stdout/stderr.write: remove blocos PEM de QUALQUER saída (inclusive de biblioteca de terceiros).
// Arquivo autocontido (sem imports relativos; só Node).

const PEM_REMOVIDO = '[PEM REMOVIDO]';
// bloco completo (também quando o util.inspect o parte em pedaços com aspas, `+` e quebras); sem o END no trecho, remove até o fim dele
const PEM_BLOCK = /-----BEGIN [A-Z0-9 ]+-----[\s\S]*?(?:-----END [A-Z0-9 ]+-----|$)/g;
// cabeçalho solto ou truncado
const PEM_HEADER = /-----(?:BEGIN|END) [A-Z0-9 ]*(?:PRIVATE KEY|CERTIFICATE|PUBLIC KEY)[A-Z0-9 ]*-----/g;
// esquema://usuario:senha@host  ->  esquema://***@host
const URL_CREDS = /\b([a-z][a-z0-9+.-]*:\/\/)[^\s/@'"]+@/gi;

/** Texto sem PEM e sem credencial embutida em URL. */
export function sanitizeText(s: string): string {
  return s.replace(PEM_BLOCK, PEM_REMOVIDO).replace(PEM_HEADER, PEM_REMOVIDO).replace(URL_CREDS, '$1***@');
}

export interface SafeError {
  name: string;
  code: string | null;
  message: string;
}

const MAX_MESSAGE = 500;

/** Só nome, código e mensagem saneada. Aceita qualquer valor lançado (string, objeto, undefined). Nunca devolve nem toca no objeto original além desses 3 campos. */
export function safeErr(e: unknown): SafeError {
  try {
    if (typeof e === 'string') return { name: 'Error', code: null, message: sanitizeText(e).slice(0, MAX_MESSAGE) };
    if (e !== null && typeof e === 'object') {
      const x = e as { name?: unknown; code?: unknown; message?: unknown };
      const name = typeof x.name === 'string' ? x.name : 'Error';
      const code = typeof x.code === 'string' || typeof x.code === 'number' ? String(x.code) : null;
      const message = typeof x.message === 'string' ? x.message : '';
      return { name: sanitizeText(name).slice(0, 80), code: code === null ? null : sanitizeText(code).slice(0, 80), message: sanitizeText(message).slice(0, MAX_MESSAGE) };
    }
    return { name: 'Error', code: null, message: sanitizeText(String(e)).slice(0, MAX_MESSAGE) };
  } catch {
    return { name: 'Error', code: null, message: 'erro ilegível' }; // um getter hostil não derruba o log
  }
}

/** Linha de log de um erro: `rótulo: Nome [código] mensagem`. */
export function errLine(label: string, e: unknown): string {
  const s = safeErr(e);
  return `${label}: ${s.name}${s.code ? ` [${s.code}]` : ''}${s.message ? ` ${s.message}` : ''}`;
}

/** Ouvinte de 'error' para Pool, Client, IORedis, Worker e Queue: registra SÓ o erro saneado e deixa o cliente se recuperar (o pool descarta a conexão ociosa e abre outra). */
export function onClientError(label: string, log: (line: string) => void = (l) => console.error(l)): (e: unknown) => void {
  return (e) => log(errLine(label, e));
}

export interface GuardOptions {
  log?: (line: string) => void;
  exit?: (code: number) => void;
  /** Alvo dos ouvintes (padrão: `process`). */
  target?: Pick<NodeJS.Process, 'on' | 'off'>;
}

/** C2: rejeição ou exceção não tratada = log saneado e saída com código 1 (o processo não segue em estado incerto). Devolve a função que remove os ouvintes. */
export function installProcessGuards(opts: GuardOptions = {}): () => void {
  const log = opts.log ?? ((l: string) => console.error(l));
  const exit = opts.exit ?? ((c: number) => process.exit(c));
  const target = opts.target ?? process;
  const rej = (e: unknown) => {
    log(errLine('[fatal] promessa rejeitada sem tratamento', e));
    exit(1);
  };
  const exc = (e: unknown) => {
    log(errLine('[fatal] exceção sem tratamento', e));
    exit(1);
  };
  target.on('unhandledRejection', rej);
  target.on('uncaughtException', exc);
  return () => {
    target.off('unhandledRejection', rej);
    target.off('uncaughtException', exc);
  };
}

type Write = (chunk: unknown, ...rest: unknown[]) => boolean;
interface Writable {
  write: Write;
}

/** C4: remove blocos PEM de tudo o que sai por stdout/stderr. Devolve a função que restaura os originais. */
export function installOutputFilter(streams: Writable[] = [process.stdout as unknown as Writable, process.stderr as unknown as Writable]): () => void {
  const originals = streams.map((s) => s.write);
  streams.forEach((s, i) => {
    const original = originals[i]!;
    s.write = function (this: unknown, chunk: unknown, ...rest: unknown[]): boolean {
      let out = chunk;
      if (typeof chunk === 'string') out = sanitizeOutput(chunk);
      else if (chunk instanceof Uint8Array) {
        const t = Buffer.from(chunk).toString('utf8');
        if (/-----(?:BEGIN|END) /.test(t)) out = sanitizeOutput(t);
      }
      return original.call(s, out, ...rest);
    } as Write;
  });
  return () => streams.forEach((s, i) => { s.write = originals[i]!; });
}

/** Na saída só o PEM sai; credencial de URL também (um log de terceiro pode trazer o DATABASE_URL). */
export function sanitizeOutput(s: string): string {
  return s.includes('-----') || s.includes('://') ? sanitizeText(s) : s;
}
