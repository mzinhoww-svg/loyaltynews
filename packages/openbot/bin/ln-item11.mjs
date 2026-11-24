#!/usr/bin/env node
// Item 11 do caminho crítico (piloto de 10 matérias, DP-41, SÓ staging): sonda de assinatura, kill switch e ensaio sem modelo, no staging REAL.
//   node ln-item11.mjs --fase sem-segredo   [--base https://<staging>] [--saida <pasta>]
//   node ln-item11.mjs --fase com-segredo --estado desligado|ligado|kill|parado [--confirmo-despacho-desligado] [--confirmo-fila-vazia] [--base ...] [--saida ...]
// Ambiente: LN_API_BASE (ou --base; só a ORIGEM importa: https://<staging>), LN_AGENT_ACCOUNT (claude|codex; padrão codex), e, só em `com-segredo`,
// LN_HMAC_SECRET_FILE = caminho do arquivo que o cofre do OpenBot entrega. Este script NUNCA lê, imprime ou grava o segredo: quem lê o arquivo é o cliente do
// agente (ln-openbot-agent.mjs), que também assina. Na fase `sem-segredo` NENHUM segredo existe: a única "assinatura" é um texto FALSO de ensaio, fixo no código.
// Saída: uma linha de JSON no stdout + (se --saida) <pasta>/<fase>[-<estado>]-<UTC>.json e .txt. Texto SÓ local ou validado: nunca repete corpo, cabeçalho nem
// mensagem do servidor fora de um padrão curto e seguro. Recusa o que não for staging ANTES de qualquer chamada que não seja o GET de /api/health.
// Código de saída 1 se houver FAIL. Nada é criado, ligado ou gravado no LN; `pull` só roda onde o roteiro garante que não reserva tarefa (ver --confirmo-*).
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { CliError, run } from './ln-openbot-agent.mjs';

export const FALSE_SECRET = 'valor-falso-de-ensaio-nao-e-segredo'; // texto de ensaio: NÃO é segredo e nunca vale em servidor nenhum
const ROUTES = ['pull', 'heartbeat', 'io/input', 'io/result', 'callback'];
const SAFE_CODE = /^[A-Z][A-Z0-9_]{1,39}$/;
const safeVersion = (v) => (typeof v === 'string' && /^[A-Za-z0-9._-]{1,64}$/.test(v) ? v : 'desconhecida');
const safeFlags = (f) => (Array.isArray(f) && f.length <= 32 && f.every((x) => typeof x === 'string' && /^[A-Za-z][A-Za-z0-9]{0,39}$/.test(x)) ? f : null);

/** Classifica o motivo de um 401 SEM repetir a mensagem do servidor. */
const reasonOf = (message) => (/sem_segredo/.test(String(message)) ? 'sem_segredo' : /assinatura recusada/.test(String(message)) ? 'assinatura_recusada' : 'outro');

async function readJson(res) {
  const text = await res.text();
  try {
    return { text, json: text ? JSON.parse(text) : null };
  } catch {
    return { text, json: null };
  }
}
const codeOf = (json) => (SAFE_CODE.test(String(json?.error?.code)) ? String(json.error.code) : null);

export async function runItem11(opts, io = {}) {
  const fetchImpl = io.fetchImpl ?? fetch;
  const now = io.now ?? (() => Date.now());
  const fase = opts.fase;
  const estado = opts.estado;
  if (!['sem-segredo', 'com-segredo'].includes(fase)) throw new CliError('uso', '--fase: sem-segredo | com-segredo');
  if (fase === 'com-segredo' && !['desligado', 'ligado', 'kill', 'parado'].includes(estado)) throw new CliError('uso', '--estado: desligado | ligado | kill | parado');
  let origin;
  try {
    origin = new URL(String(opts.base ?? '')).origin;
  } catch {
    throw new CliError('config', 'LN_API_BASE (ou --base) ausente ou inválida (ex.: https://<staging>)');
  }
  if (new URL(origin).protocol !== 'https:' && !/^http:\/\/(localhost|127\.0\.0\.1)/.test(origin)) throw new CliError('config', 'só HTTPS (http só para localhost, em teste)');
  const account = opts.account ?? 'codex';
  const clientEnv = (extra) => ({ LN_API_BASE: `${origin}/api/openbot`, LN_AGENT_ACCOUNT: account, ...extra });
  const clientIo = { fetchImpl, now, ...(io.readFile ? { readFile: io.readFile } : {}) };
  const steps = [];
  let n = 0;
  const add = (passo, esperado, observado, veredito, nota) => steps.push({ n: ++n, passo, esperado, observado, veredito, ...(nota ? { nota } : {}) });
  const finish = (extra = {}) => ({
    ok: !steps.some((s) => s.veredito === 'FAIL'), fase, ...(estado ? { estado } : {}), url: origin, quando: new Date(now()).toISOString(), passos: steps, ...extra,
  });

  // 1) health: GET sem assinatura; recusa o que não for staging antes de qualquer outra chamada
  let health;
  try {
    const res = await fetchImpl(`${origin}/api/health`, { redirect: 'error', signal: AbortSignal.timeout(20_000) });
    health = res.ok ? (await readJson(res)).json : null;
    if (!health || typeof health !== 'object') {
      add('GET /api/health', '200 JSON', `HTTP ${res.status}`, 'FAIL', 'o app não respondeu com JSON (fora do ar ou borda)');
      return finish({ recusado: 'sem_health' });
    }
  } catch {
    add('GET /api/health', '200 JSON', 'sem resposta', 'FAIL', 'rede ou tempo esgotado');
    return finish({ recusado: 'sem_health' });
  }
  const flags = safeFlags(health.flags);
  const staging = health.env === 'staging';
  const despachoLigado = flags ? flags.includes('openbotDispatch') : null;
  add('GET /api/health', '200, env staging', { env: staging ? 'staging' : 'outro', version: safeVersion(health.version), flags, openbotDispatch: despachoLigado === null ? 'desconhecida' : despachoLigado ? 'ligada' : 'desligada' }, staging ? 'PASS' : 'FAIL', staging ? undefined : 'só roda em staging: nada mais foi enviado');
  if (!staging) return finish({ recusado: 'ambiente_nao_staging' });

  if (fase === 'sem-segredo') {
    // 2) ready (banco e Redis)
    try {
      const res = await fetchImpl(`${origin}/api/ready`, { redirect: 'error', signal: AbortSignal.timeout(20_000) });
      const j = (await readJson(res)).json;
      const v = (x) => (x === 'ok' ? 'ok' : 'outro');
      add('GET /api/ready', '200 db/redis ok', { http: res.status, db: v(j?.db), redis: v(j?.redis) }, res.status === 200 && j?.db === 'ok' && j?.redis === 'ok' ? 'PASS' : 'WARN');
    } catch {
      add('GET /api/ready', '200 db/redis ok', 'sem resposta', 'WARN');
    }
    // 3) cinco rotas SEM cabeçalho de assinatura: 401 UNAUTHORIZED (a assinatura é conferida ANTES de qualquer 423: ft/backend 59eed1b)
    const reasons = new Set();
    for (const r of ROUTES) {
      try {
        const res = await fetchImpl(`${origin}/api/openbot/${r}`, { method: 'POST', redirect: 'error', signal: AbortSignal.timeout(30_000), headers: { 'content-type': 'application/json' }, body: '{}' });
        const { json } = await readJson(res);
        const code = codeOf(json);
        const reason = reasonOf(json?.error?.message);
        if (res.status === 401) reasons.add(reason);
        add(`POST /api/openbot/${r} sem cabeçalhos`, '401 UNAUTHORIZED', `${res.status} ${code ?? 'sem código da API'}${res.status === 401 ? ` (${reason})` : ''}`, res.status === 401 && code === 'UNAUTHORIZED' ? 'PASS' : 'FAIL',
          res.status === 423 ? '423 sem assinatura: a rota respondeu travada ANTES de conferir a assinatura' : res.status >= 500 ? 'indisponibilidade ou borda (HTML): parar e conferir /api/health' : undefined);
      } catch {
        add(`POST /api/openbot/${r} sem cabeçalhos`, '401 UNAUTHORIZED', 'sem resposta', 'FAIL', 'rede ou tempo esgotado');
      }
    }
    // 4) cabeçalhos presentes mas ASSINATURA FALSA: distingue "servidor sem segredo" de "servidor com segredo"
    try {
      const ts = String(now());
      const res = await fetchImpl(`${origin}/api/openbot/heartbeat`, { method: 'POST', redirect: 'error', signal: AbortSignal.timeout(30_000), headers: { 'content-type': 'application/json', 'x-ln-timestamp': ts, 'x-ln-signature': `v1=${'0'.repeat(64)}` }, body: '{"taskId":"sonda-inexistente","leaseId":"sonda"}' });
      const { json } = await readJson(res);
      const reason = reasonOf(json?.error?.message);
      add('POST /api/openbot/heartbeat com assinatura FALSA (zeros)', '401 UNAUTHORIZED', `${res.status} ${codeOf(json) ?? 'sem código da API'} (${reason})`, res.status === 401 && codeOf(json) === 'UNAUTHORIZED' ? 'PASS' : 'FAIL',
        reason === 'sem_segredo' ? 'o servidor NÃO tem o segredo HMAC configurado (OPENBOT_HMAC_SECRET ausente)' : reason === 'assinatura_recusada' ? 'o servidor TEM segredo (provável): recusou a assinatura falsa' : undefined);
      reasons.add(reason);
    } catch {
      add('POST /api/openbot/heartbeat com assinatura FALSA (zeros)', '401 UNAUTHORIZED', 'sem resposta', 'FAIL');
    }
    // 5) GET na rota: não pode responder 2xx
    try {
      const res = await fetchImpl(`${origin}/api/openbot/pull`, { method: 'GET', redirect: 'error', signal: AbortSignal.timeout(30_000) });
      add('GET /api/openbot/pull', 'não 2xx (405)', res.status, res.status >= 200 && res.status < 300 ? 'FAIL' : 'PASS');
    } catch {
      add('GET /api/openbot/pull', 'não 2xx (405)', 'sem resposta', 'WARN');
    }
    // 6) /studio/piloto sem sessão: não pode abrir
    try {
      const res = await fetchImpl(`${origin}/studio/piloto`, { method: 'GET', redirect: 'manual', signal: AbortSignal.timeout(30_000) });
      add('GET /studio/piloto sem sessão', 'redireciona ou nega (não 200)', res.status, res.status === 200 ? 'FAIL' : 'PASS', res.status === 200 ? 'a planilha do piloto abriu sem login' : undefined);
    } catch {
      add('GET /studio/piloto sem sessão', 'redireciona ou nega (não 200)', 'sem resposta', 'WARN');
    }
    // 7) smoke do cliente com valor FALSO: o resultado depende do servidor ter ou não o segredo; o que importa é NÃO haver pull e a assinatura falhar fechada
    try {
      const r = await run(['smoke', '--expect-dispatch', 'any'], clientEnv({ LN_HMAC_SECRET: FALSE_SECRET }), clientIo);
      const hb = r.checks?.find((c) => c.step === 'assinatura (heartbeat)');
      const obs = String(hb?.observed ?? '');
      add('smoke (cliente, valor falso, sem pull)', 'assinatura FAIL 401 (sem_segredo ou assinatura recusada)', `ok:${r.ok} assinatura(heartbeat)=${/^401 (sem_segredo|assinatura recusada)$/.test(obs) ? obs : 'inesperado'}`, /^401 (sem_segredo|assinatura recusada)$/.test(obs) ? 'PASS' : 'FAIL');
    } catch (e) {
      add('smoke (cliente, valor falso, sem pull)', 'assinatura FAIL 401', e instanceof CliError ? e.code : 'erro', 'FAIL');
    }
    add('kill switch, 404 LEASE_ERROR, 423 DISPATCH_OFF/KILL_SWITCH/PILOT_STOPPED', 'só com o segredo REAL (e o kill switch, por um admin)', 'não executado', 'NAO_EXECUTADO', 'rode `--fase com-segredo` depois de gravar o segredo no cofre');
    return finish({ servidorSemSegredo: reasons.has('sem_segredo') ? 'sim' : reasons.size ? 'nao (provavel)' : 'indeterminado' });
  }

  // ===== com-segredo: o segredo só passa pelo cliente (LN_HMAC_SECRET_FILE); este script não o lê =====
  if (!opts.secretFile) throw new CliError('config', 'sem LN_HMAC_SECRET_FILE: defina o caminho do arquivo do cofre do OpenBot');
  const realEnv = clientEnv({ LN_HMAC_SECRET_FILE: opts.secretFile });
  const probe = (r, step) => r.checks?.find((c) => c.step === step);
  const smokeStep = async (label, expectDispatch, expectedSig) => {
    try {
      const r = await run(['smoke', '--expect-dispatch', expectDispatch], realEnv, clientIo);
      const hb = probe(r, 'assinatura (heartbeat)');
      const io2 = probe(r, 'assinatura (io/input)');
      const ok = r.ok === true && hb?.verdict === 'PASS' && io2?.verdict === 'PASS' && hb.observed === expectedSig && io2.observed === expectedSig;
      add(label, `ok:true, assinatura PASS ${expectedSig}`, `ok:${r.ok} heartbeat=${hb?.observed ?? '?'} io/input=${io2?.observed ?? '?'}`, ok ? 'PASS' : 'FAIL');
    } catch (e) {
      add(label, `ok:true, assinatura PASS ${expectedSig}`, e instanceof CliError ? e.code : 'erro', 'FAIL', e instanceof CliError && e.code === 'config' ? 'segredo ilegível ou ausente' : undefined);
    }
  };
  const pullStep = async (label, esperado) => {
    try {
      const r = await run(['pull', '--kinds', 'fact_check'], realEnv, clientIo);
      const vazio = Array.isArray(r?.tasks) && r.tasks.length === 0;
      add(label, esperado, vazio ? 'lista vazia' : `${Array.isArray(r?.tasks) ? r.tasks.length : '?'} tarefa(s)`, esperado === 'lista vazia' && vazio ? 'PASS' : 'FAIL', vazio ? undefined : 'o pull devolveu tarefa ou formato inesperado: PARAR e conferir a fila');
    } catch (e) {
      const got = e instanceof CliError ? `${e.status ?? 'sem status'} ${e.code}${e.stop ? ' stop' : ''}` : 'erro';
      add(label, esperado, got, got === esperado ? 'PASS' : 'FAIL');
    }
  };

  if (estado === 'desligado') {
    if (despachoLigado !== false || !opts.confirmoDespachoDesligado) {
      add('pré-condição do pull', 'health sem openbotDispatch E --confirmo-despacho-desligado', { openbotDispatch: despachoLigado === null ? 'desconhecida' : despachoLigado ? 'ligada' : 'desligada', confirmado: !!opts.confirmoDespachoDesligado }, 'FAIL', 'o pull é operacional: só roda com o despacho DESLIGADO confirmado');
      return finish({ recusado: 'precondicao' });
    }
    await smokeStep('1. smoke --expect-dispatch off (assinatura aceita)', 'off', '404 LEASE_ERROR');
    await pullStep('2. pull com despacho desligado', '423 DISPATCH_OFF stop');
    try {
      await run(['heartbeat', '--task', 'sonda-inexistente', '--lease', 'sonda'], clientEnv({ LN_HMAC_SECRET: FALSE_SECRET }), clientIo);
      add('3. heartbeat com segredo ERRADO (valor falso)', '401 assinatura_recusada', '2xx inesperado', 'FAIL');
    } catch (e) {
      const reason = reasonOf(e?.message);
      add('3. heartbeat com segredo ERRADO (valor falso)', '401 assinatura_recusada', `${e instanceof CliError ? e.status : '?'} ${reason}`, e instanceof CliError && e.status === 401 && reason === 'assinatura_recusada' ? 'PASS' : 'FAIL', reason === 'sem_segredo' ? 'o servidor ainda NÃO tem segredo' : undefined);
    }
  } else if (estado === 'ligado') {
    if (despachoLigado !== true || !opts.confirmoFilaVazia) {
      add('pré-condição do pull', 'health com openbotDispatch E --confirmo-fila-vazia', { openbotDispatch: despachoLigado === null ? 'desconhecida' : despachoLigado ? 'ligada' : 'desligada', confirmado: !!opts.confirmoFilaVazia }, 'FAIL', 'com o despacho ligado o pull PODE reservar tarefa: só com a fila confirmada vazia');
      return finish({ recusado: 'precondicao' });
    }
    await smokeStep('4. smoke --expect-dispatch on', 'on', '404 LEASE_ERROR');
    await pullStep('4. pull com despacho ligado e fila vazia', 'lista vazia');
  } else if (estado === 'kill') {
    await smokeStep('6. smoke com o kill switch ligado (assinatura aceita, travado)', 'any', '423 KILL_SWITCH');
    await pullStep('6. pull com o kill switch ligado', '423 KILL_SWITCH stop');
    add('6. callback de tarefa em curso ainda aceito', '200 (callback segue aceito)', 'não executado', 'NAO_EXECUTADO', 'exige uma tarefa em curso: parte do ciclo de ensaio com o agente');
  } else if (estado === 'parado') {
    await smokeStep('8. smoke com o piloto parado (assinatura aceita, travado)', 'any', '423 PILOT_STOPPED');
    await pullStep('8. pull com o piloto parado', '423 PILOT_STOPPED stop');
  }
  add('ciclo de ensaio completo (pauta → ... → linha em /studio/piloto)', 'uma linha, custo 0, subscription', 'não executado', 'NAO_EXECUTADO', 'passo do agente criado (item 7); fora deste script');
  return finish();
}

export function toText(r) {
  const lines = [`Item 11 — fase ${r.fase}${r.estado ? ` / estado ${r.estado}` : ''} — ${r.quando} — ${r.url}`, `Resultado: ${r.ok ? 'OK (nenhum FAIL)' : 'COM FAIL'}${r.recusado ? ` (recusado: ${r.recusado})` : ''}`];
  if (r.servidorSemSegredo) lines.push(`Servidor sem segredo HMAC: ${r.servidorSemSegredo}`);
  for (const s of r.passos) lines.push(`${String(s.n).padStart(2)}. [${s.veredito}] ${s.passo} | esperado: ${s.esperado} | observado: ${typeof s.observado === 'string' || typeof s.observado === 'number' ? s.observado : JSON.stringify(s.observado)}${s.nota ? ` | ${s.nota}` : ''}`);
  return `${lines.join('\n')}\n`;
}

function parse(argv) {
  const flagsBool = ['confirmo-despacho-desligado', 'confirmo-fila-vazia'];
  const out = {};
  for (let i = 0; i < argv.length; i += 1) {
    const k = argv[i];
    if (!k?.startsWith('--')) throw new CliError('uso', `argumento desconhecido: ${String(k).slice(0, 40)}`);
    const name = k.slice(2);
    if (flagsBool.includes(name)) out[name] = true;
    else if (['fase', 'estado', 'base', 'saida'].includes(name)) {
      if (argv[i + 1] === undefined) throw new CliError('uso', `${k} sem valor`);
      out[name] = argv[(i += 1)];
    } else throw new CliError('uso', `argumento desconhecido: ${k.slice(0, 40)} (nada de --secret)`);
  }
  return out;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  (async () => {
    try {
      const a = parse(process.argv.slice(2));
      const r = await runItem11({
        fase: a.fase, estado: a.estado, base: a.base ?? process.env.LN_API_BASE?.replace(/\/api\/openbot\/?$/, ''), account: process.env.LN_AGENT_ACCOUNT ?? 'codex',
        secretFile: process.env.LN_HMAC_SECRET_FILE, confirmoDespachoDesligado: a['confirmo-despacho-desligado'], confirmoFilaVazia: a['confirmo-fila-vazia'],
      });
      if (a.saida) {
        mkdirSync(a.saida, { recursive: true });
        const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
        const stem = join(a.saida, `${r.fase}${r.estado ? `-${r.estado}` : ''}-${stamp}`);
        writeFileSync(`${stem}.json`, `${JSON.stringify(r, null, 2)}\n`);
        writeFileSync(`${stem}.txt`, toText(r));
      }
      process.stdout.write(`${JSON.stringify(r)}\n`);
      if (!r.ok) process.exitCode = 1;
    } catch (e) {
      const err = e instanceof CliError ? { code: e.code, message: e.message } : { code: 'erro', message: 'falha inesperada' };
      process.stderr.write(`${JSON.stringify({ error: err })}\n`);
      process.exitCode = 1;
    }
  })();
}
