#!/usr/bin/env node
// Cliente do AGENTE do OpenBot para o piloto de 10 matérias (DP-41, só staging). O modelo NUNCA toca no segredo nem na assinatura: ele roda estes
// comandos e só lê/escreve JSON. Sem dependências (Node 20+). Faz exatamente o que PROTOCOL.md descreve:
//   pull  ->  input  ->  (o agente produz o resultado)  ->  result  ->  done | limit | fail      (+ heartbeat se a tarefa demorar)
//   smoke: verificação do roteiro (§6) em UM comando, sem efeito (health, sonda de assinatura, pull só com o despacho desligado); recusa produção.
// Segurança: o segredo HMAC vem de um ARQUIVO (LN_HMAC_SECRET_FILE, o caminho que o cofre do OpenBot entrega) ou, menos recomendado, de LN_HMAC_SECRET;
// nunca de argumento de linha de comando, e nunca é impresso. Só HTTPS (http só para localhost, em teste). Só as contas claude e codex (DP-41).
// Saída: UMA linha de JSON no stdout (o resultado) ou, em erro, JSON em stderr e código de saída 1 (sem segredo, sem assinatura, sem cabeçalhos).
import { createHash, createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

export const ACCOUNTS = ['claude', 'codex'];
export const STAGES = ['triage', 'draft', 'factcheck', 'review', 'social_pack', 'roles'];
/** Tipos de tarefa do piloto (o `pull` filtra por eles: vários agentes podem dividir a mesma conta). */
export const KINDS = ['classification', 'editorial_draft', 'fact_check', 'editorial_review', 'social_copy', 'entity_resolution'];
const ID_RE = /^[A-Za-z0-9_.-]{1,128}$/;
const SIGNATURE_HEADER = 'x-ln-signature';
const TIMESTAMP_HEADER = 'x-ln-timestamp';

export class CliError extends Error {
  /** `stop`: o agente deve PARAR o ciclo e não repetir em laço (423 Locked e indisponibilidade da borda). */
  constructor(code, message, status, stop = false) {
    super(message);
    this.name = 'CliError';
    this.code = code;
    this.status = status;
    this.stop = stop;
  }
}

/** HMAC-SHA256 de `${timestampMs}.${corpo}`, no formato `v1=<hex>` (o mesmo de signBody em @ln/openbot). */
export function sign(secret, timestampMs, raw) {
  return `v1=${createHmac('sha256', secret).update(`${timestampMs}.${raw}`).digest('hex')}`;
}

export function loadConfig(env, readFile = readFileSync) {
  const base = String(env.LN_API_BASE ?? '').replace(/\/+$/, '');
  let u;
  try {
    u = new URL(base);
  } catch {
    throw new CliError('config', 'LN_API_BASE ausente ou inválida (ex.: https://<staging>/api/openbot)');
  }
  const local = u.hostname === 'localhost' || u.hostname === '127.0.0.1';
  if (u.username || u.password || (u.protocol !== 'https:' && !(u.protocol === 'http:' && local))) throw new CliError('config', 'LN_API_BASE tem de ser HTTPS, sem credencial na URL');
  const account = env.LN_AGENT_ACCOUNT;
  if (!ACCOUNTS.includes(account)) throw new CliError('config', `LN_AGENT_ACCOUNT tem de ser ${ACCOUNTS.join(' ou ')} (DP-41: só as assinaturas Claude e Codex)`);
  let secret = '';
  if (env.LN_HMAC_SECRET_FILE) {
    try {
      secret = String(readFile(env.LN_HMAC_SECRET_FILE, 'utf8')).trim();
    } catch {
      throw new CliError('config', 'não consegui ler LN_HMAC_SECRET_FILE');
    }
  } else if (env.LN_HMAC_SECRET) {
    secret = String(env.LN_HMAC_SECRET).trim();
  }
  if (!secret) throw new CliError('config', 'sem segredo: defina LN_HMAC_SECRET_FILE (caminho do arquivo do cofre do OpenBot)');
  const workerId = env.LN_WORKER_ID ?? `openbot-${account}`;
  if (!ID_RE.test(workerId)) throw new CliError('config', 'LN_WORKER_ID inválido');
  return { base: u.toString().replace(/\/+$/, ''), account, secret, workerId };
}

/** POST assinado. Devolve {status, body}; nunca imprime nem devolve o segredo ou a assinatura. */
export async function post(cfg, path, payload, { fetchImpl = fetch, now = () => Date.now() } = {}) {
  const raw = JSON.stringify(payload);
  const ts = now();
  let res;
  try {
    res = await fetchImpl(`${cfg.base}/${path}`, {
      method: 'POST', redirect: 'error', signal: AbortSignal.timeout(30_000),
      headers: { 'content-type': 'application/json', [TIMESTAMP_HEADER]: String(ts), [SIGNATURE_HEADER]: sign(cfg.secret, ts, raw) },
      body: raw,
    });
  } catch {
    throw new CliError('rede', 'a chamada à API do LN falhou (rede ou tempo esgotado)');
  }
  const text = await res.text();
  const body = (() => {
    try {
      return text ? JSON.parse(text) : null;
    } catch {
      return null;
    }
  })();
  if (!res.ok) {
    // 423 Locked (decisão PM-2026-11-23-I): o servidor responde DISPATCH_OFF, KILL_SWITCH e PILOT_STOPPED com 423 e o corpo JSON da API, porque a borda da Vertra
    // troca o corpo de 502/503/504 por uma página HTML e o código se perderia. 423 = o LN está TRAVADO de propósito: o agente PARA o ciclo e não repete em laço.
    if (res.status === 423) {
      const code = body?.error?.code ?? 'LOCKED';
      throw new CliError(code, `${code}: ${String(body?.error?.message ?? 'travado').slice(0, 200)}; 423 Locked: pare o ciclo e não repita em laço`, 423, true);
    }
    // 502/503/504 sem corpo da API = indisponibilidade REAL (ou servidor anterior à decisão do 423): o agente não adivinha, PARA o ciclo e não repete em laço (confira /api/health).
    if (body === null && res.status >= 502 && res.status <= 504) {
      throw new CliError(`UPSTREAM_${res.status}`, `${res.status} da borda sem corpo da API: indisponibilidade real (ou servidor anterior ao 423 Locked); pare o ciclo e não repita em laço`, res.status, true);
    }
    const code = body?.error?.code ?? 'HTTP';
    throw new CliError(code, `${code}: ${String(body?.error?.message ?? res.status).slice(0, 200)}`, res.status);
  }
  return { status: res.status, body };
}

const need = (a, k, re = ID_RE) => {
  const v = a[k];
  if (typeof v !== 'string' || !re.test(v)) throw new CliError('uso', `--${k} ausente ou inválido`);
  return v;
};
const bool = (v, def) => (v === undefined ? def : v === 'true' ? true : v === 'false' ? false : (() => { throw new CliError('uso', 'valor booleano: true ou false'); })());

/** `--chave valor` -> { chave: valor }. Recusa flag desconhecida (nada de --secret). */
export function parseArgs(argv, allowed) {
  const out = {};
  for (let i = 0; i < argv.length; i += 2) {
    const k = argv[i];
    if (!k?.startsWith('--') || !allowed.includes(k.slice(2))) throw new CliError('uso', `argumento desconhecido: ${String(k).slice(0, 40)}`);
    if (argv[i + 1] === undefined) throw new CliError('uso', `${k} sem valor`);
    out[k.slice(2)] = argv[i + 1];
  }
  return out;
}

const short = (s) => createHash('sha256').update(s).digest('hex').slice(0, 16);
const iso = (ms) => new Date(ms).toISOString();

function traceOf(cfg, a, now, extra = {}) {
  const stage = a.stage;
  if (!STAGES.includes(stage)) throw new CliError('uso', `--stage tem de ser ${STAGES.join('|')}`);
  const started = a['started-at'] ? Date.parse(a['started-at']) : now();
  if (!Number.isFinite(started)) throw new CliError('uso', '--started-at inválido (ISO 8601)');
  const t = { stage, account: cfg.account, startedAt: iso(started), endedAt: iso(now()) };
  if (a['packet-chars']) t.packetChars = Number.parseInt(a['packet-chars'], 10);
  if (a['prompt-version']) t.promptVersion = need(a, 'prompt-version');
  if (a.article) t.articleId = need(a, 'article');
  if (a['source-id']) t.sourceId = need(a, 'source-id');
  if (a['reviewed-draft']) t.reviewedDraftTaskId = need(a, 'reviewed-draft');
  if (a['output-valid'] !== undefined) t.outputValid = bool(a['output-valid']);
  return { ...t, ...extra };
}

const COMMANDS = {
  async pull(cfg, argv, io) {
    const a = parseArgs(argv, ['limit', 'kinds']);
    const limit = a.limit ? Number.parseInt(a.limit, 10) : 1;
    if (!(limit >= 1 && limit <= 10)) throw new CliError('uso', '--limit entre 1 e 10');
    const kinds = a.kinds !== undefined ? a.kinds.split(',').map((k) => k.trim()) : undefined;
    if (kinds && (kinds.length === 0 || kinds.some((k) => !KINDS.includes(k)))) throw new CliError('uso', `--kinds: lista separada por vírgula de ${KINDS.join('|')}`);
    return (await post(cfg, 'pull', { workerId: cfg.workerId, account: cfg.account, limit, ...(kinds ? { kinds } : {}) }, io)).body;
  },
  async heartbeat(cfg, argv, io) {
    const a = parseArgs(argv, ['task', 'lease']);
    return (await post(cfg, 'heartbeat', { taskId: need(a, 'task'), leaseId: need(a, 'lease') }, io)).body;
  },
  async input(cfg, argv, io) {
    const a = parseArgs(argv, ['task', 'lease']);
    return (await post(cfg, 'io/input', { taskId: need(a, 'task'), leaseId: need(a, 'lease') }, io)).body.data;
  },
  async result(cfg, argv, io) {
    const a = parseArgs(argv, ['task', 'lease', 'file']);
    let result;
    try {
      result = JSON.parse(String((io.readFile ?? readFileSync)(need(a, 'file', /^.{1,500}$/), 'utf8')));
    } catch {
      throw new CliError('uso', '--file tem de ser um arquivo JSON legível');
    }
    return (await post(cfg, 'io/result', { taskId: need(a, 'task'), leaseId: need(a, 'lease'), result }, io)).body.data;
  },
  async done(cfg, argv, io) {
    const a = parseArgs(argv, ['task', 'lease', 'result-ref', 'model', 'stage', 'started-at', 'packet-chars', 'prompt-version', 'article', 'source-id', 'reviewed-draft', 'output-valid', 'callback-id']);
    const taskId = need(a, 'task');
    const leaseId = need(a, 'lease');
    const resultRef = need(a, 'result-ref');
    const model = need(a, 'model', /^[A-Za-z0-9_./:@+-]{1,128}$/);
    const now = io.now ?? (() => Date.now());
    const body = {
      callbackId: a['callback-id'] ? need(a, 'callback-id') : `cb-${taskId}-${short(resultRef)}`, // o mesmo resultado reenviado = o mesmo callbackId (idempotente)
      taskId, leaseId, outcome: 'completed', resultRef,
      usage: { executionId: `ex-${taskId}-${short(resultRef)}`, taskId, leaseId, model, lane: 'subscription', account: cfg.account, costMicro: 0 },
      trace: traceOf(cfg, a, now),
    };
    return (await post(cfg, 'callback', body, io)).body;
  },
  async limit(cfg, argv, io) {
    const a = parseArgs(argv, ['task', 'lease', 'stage', 'message', 'resume-at', 'started-at', 'article', 'prompt-version', 'reviewed-draft', 'callback-id']);
    const taskId = need(a, 'task');
    const now = io.now ?? (() => Date.now());
    const message = need(a, 'message', /^[\s\S]{1,300}$/);
    const lim = { message, at: iso(now()) };
    if (a['resume-at']) {
      if (!Number.isFinite(Date.parse(a['resume-at']))) throw new CliError('uso', '--resume-at inválido (ISO 8601)');
      lim.resumeAt = new Date(Date.parse(a['resume-at'])).toISOString();
    }
    const body = {
      callbackId: a['callback-id'] ? need(a, 'callback-id') : `cb-${taskId}-lim-${short(`${a.lease}${lim.at}`)}`,
      taskId, leaseId: need(a, 'lease'), outcome: 'failed', retryable: true, error: 'limite da conta', trace: traceOf(cfg, a, now, { limit: lim }),
    };
    return (await post(cfg, 'callback', body, io)).body;
  },
  async fail(cfg, argv, io) {
    const a = parseArgs(argv, ['task', 'lease', 'stage', 'error', 'retryable', 'started-at', 'article', 'prompt-version', 'reviewed-draft', 'callback-id']);
    const taskId = need(a, 'task');
    const now = io.now ?? (() => Date.now());
    const body = {
      callbackId: a['callback-id'] ? need(a, 'callback-id') : `cb-${taskId}-fail-${short(`${a.lease}${a.error}`)}`,
      taskId, leaseId: need(a, 'lease'), outcome: 'failed', retryable: bool(a.retryable, true), error: need(a, 'error', /^[\s\S]{1,500}$/),
      trace: traceOf(cfg, a, now, { outputValid: false }),
    };
    return (await post(cfg, 'callback', body, io)).body;
  },
  /**
   * Verificação do roteiro (§6) em UM comando, SEM efeito: lê /api/health, faz a sonda de assinatura (heartbeat e io/input de tarefa que não existe) e,
   * só com o despacho desligado, um `pull` (que nada entrega). Recusa produção. Com o despacho LIGADO o `pull` é PULADO (tomaria um lease de verdade).
   * Resultado por passo: PASS | FAIL | WARN | SKIP; `ok` = nenhum FAIL. Nunca imprime segredo, assinatura nem cabeçalhos.
   */
  async smoke(cfg, argv, io) {
    const a = parseArgs(argv, ['expect-dispatch']);
    const expect = a['expect-dispatch'] ?? 'any';
    if (!['off', 'on', 'any'].includes(expect)) throw new CliError('uso', '--expect-dispatch: off | on | any');
    const fetchImpl = io.fetchImpl ?? fetch;
    const origin = new URL(cfg.base).origin;
    const checks = [];
    const add = (step, verdict, observed, note) => checks.push({ step, verdict, observed, ...(note ? { note } : {}) });

    // 1) health (GET sem assinatura)
    let health = null;
    try {
      const res = await fetchImpl(`${origin}/api/health`, { redirect: 'error', signal: AbortSignal.timeout(20_000) });
      health = res.ok ? await res.json() : null;
      if (!health) add('health', 'FAIL', `HTTP ${res.status}`, 'o app não respondeu /api/health');
    } catch {
      add('health', 'FAIL', 'sem resposta', 'rede ou tempo esgotado');
    }
    if (!health) return { ok: false, url: origin, checks, refused: 'sem_health' };
    const prod = health.env !== 'staging';
    add('health', prod ? 'FAIL' : 'PASS', { env: health.env, version: health.version, flags: health.flags }, prod ? 'o smoke só roda em staging: nada assinado foi enviado' : undefined);
    if (prod) return { ok: false, url: origin, checks, refused: 'ambiente_nao_staging' };
    const dispatchOn = Array.isArray(health.flags) && health.flags.includes('openbotDispatch');
    if (expect !== 'any' && (expect === 'on') !== dispatchOn) add('flag openbotDispatch', 'FAIL', dispatchOn ? 'ligada' : 'desligada', `esperado: ${expect === 'on' ? 'ligada' : 'desligada'}`);
    else add('flag openbotDispatch', 'PASS', dispatchOn ? 'ligada' : 'desligada');

    // 2) sonda de assinatura: uma tarefa que não existe passa pela assinatura e devolve 404 (aceita) ou 401 (recusada)
    const probe = async (step, path, body) => {
      try {
        await post(cfg, path, body, io);
        add(step, 'WARN', 'respondeu 2xx', 'inesperado para uma tarefa que não existe');
      } catch (e) {
        if (!(e instanceof CliError)) throw e;
        if (e.code === 'LEASE_ERROR' && e.status === 404) add(step, 'PASS', '404 LEASE_ERROR', 'assinatura aceita; nada foi criado');
        else if (e.status === 423) add(step, 'PASS', `423 ${e.code}`, 'assinatura aceita; o LN está travado de propósito');
        else if (e.status === 401) add(step, 'FAIL', `401 ${e.message.replace(/^UNAUTHORIZED: /, '')}`, /sem_segredo/.test(e.message) ? 'o servidor não tem o segredo HMAC configurado' : 'segredo diferente do do servidor, ou relógio fora da janela de 5 min');
        else add(step, 'FAIL', `${e.status ?? ''} ${e.code}`.trim(), 'resposta inesperada');
      }
    };
    await probe('assinatura (heartbeat)', 'heartbeat', { taskId: 'sonda-inexistente', leaseId: 'sonda' });
    await probe('assinatura (io/input)', 'io/input', { taskId: 'sonda-inexistente', leaseId: 'sonda' });

    // 3) pull só com o despacho desligado (nada é entregue); ligado, PULA para não tomar um lease
    if (dispatchOn) {
      add('pull', 'SKIP', 'não executado', 'despacho ligado: um pull tomaria o lease de uma tarefa de verdade');
    } else {
      try {
        const r = await post(cfg, 'pull', { workerId: cfg.workerId, account: cfg.account, limit: 1 }, io);
        add('pull', 'WARN', `${r.status} com ${r.body?.tasks?.length ?? 0} tarefa(s)`, 'com o despacho desligado o pull devia ser 423 DISPATCH_OFF');
      } catch (e) {
        if (!(e instanceof CliError)) throw e;
        if (e.status === 423 && e.code === 'DISPATCH_OFF') add('pull', 'PASS', '423 DISPATCH_OFF', 'o despacho desligado não entrega nada');
        else if (e.status === 423) add('pull', 'WARN', `423 ${e.code}`, 'travado por outro motivo (parada ou piloto parado)');
        else if (e.code.startsWith('UPSTREAM_')) add('pull', 'WARN', `${e.status} sem corpo da API`, 'servidor anterior ao 423 Locked (a borda da Vertra esconde o código) ou app indisponível');
        else if (e.status === 401) add('pull', 'FAIL', `401 ${e.code}`, 'assinatura recusada');
        else add('pull', 'FAIL', `${e.status ?? ''} ${e.code}`.trim(), 'resposta inesperada');
      }
    }
    return { ok: !checks.some((c) => c.verdict === 'FAIL'), url: origin, checks };
  },
};

/**
 * Executa um comando e devolve o resultado (o `main` imprime). `io` injeta fetch, relógio e leitura de arquivo (testes).
 * Exemplo do ciclo de UMA tarefa: pull -> input -> (agente escreve result.json) -> result -> done.
 */
export async function run(argv, env, io = {}) {
  const [cmd, ...rest] = argv;
  const fn = COMMANDS[cmd];
  if (!fn) throw new CliError('uso', `comando desconhecido; use: ${Object.keys(COMMANDS).join(' | ')}`);
  return fn(loadConfig(env, io.readFile ?? readFileSync), rest, io);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  run(process.argv.slice(2), process.env).then(
    (r) => {
      process.stdout.write(`${JSON.stringify(r)}\n`);
      if (r && r.ok === false && Array.isArray(r.checks)) process.exitCode = 1; // smoke com FAIL
    },
    (e) => {
      const err = e instanceof CliError ? { code: e.code, message: e.message, ...(e.status ? { status: e.status } : {}), ...(e.stop ? { stop: true } : {}) } : { code: 'erro', message: 'falha inesperada' };
      process.stderr.write(`${JSON.stringify({ error: err })}\n`);
      process.exitCode = 1;
    },
  );
}
