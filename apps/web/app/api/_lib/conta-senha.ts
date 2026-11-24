// POST /api/studio/conta/senha — o usuário logado troca a PRÓPRIA senha (tela /studio/conta). Toda a regra (2º fator, política,
// limite de tentativas, revogação das outras sessões, auditoria change_password) está em changeOwnPassword (@ln/auth); aqui só o
// envelope HTTP: mesma origem, corpo JSON pequeno, IP pelo proxy confiável e os cookies da sessão nova devolvidos ao navegador.
import { randomUUID } from 'node:crypto';
import { apiError } from '@ln/contracts';
import { changeOwnPassword, clientIp, type Auth, type Db } from '@ln/auth';

const MAX_BODY = 4_096;
const SEM_CACHE = { 'cache-control': 'no-store' };

export interface ContaSenhaDeps {
  auth: Auth;
  db: Db;
  now?: () => Date;
  /** Proxies confiáveis (padrão: TRUSTED_PROXY_HOPS do ambiente). */
  trustedProxyHops?: number;
}

/** Só aceita POST do próprio site: o Origin precisa ter o mesmo host da requisição (Host ou X-Forwarded-Host do proxy). */
export function mesmaOrigem(headers: Headers): boolean {
  const origin = headers.get('origin');
  if (!origin) return false;
  let host: string;
  try {
    host = new URL(origin).host.toLowerCase();
  } catch {
    return false;
  }
  const candidatos = [headers.get('host'), ...(headers.get('x-forwarded-host') ?? '').split(',')].map((h) => (h ?? '').trim().toLowerCase()).filter(Boolean);
  return candidatos.includes(host);
}

export async function trocarSenhaHandler(req: Request, deps: ContaSenhaDeps): Promise<Response> {
  const requestId = randomUUID();
  const erro = (status: number, code: string, message: string, details?: unknown, headers: Record<string, string> = {}) => {
    const body = apiError(code, message, details);
    return Response.json({ error: { ...body.error, requestId } }, { status, headers: { ...SEM_CACHE, 'x-request-id': requestId, ...headers } });
  };
  if (!mesmaOrigem(req.headers)) return erro(403, 'FORBIDDEN_ORIGIN', 'Origem não permitida.');
  // recusa pelo Content-Length declarado ANTES de ler o corpo (sem ele, o limite abaixo vale sobre o texto lido)
  const declarado = Number(req.headers.get('content-length') ?? '');
  if (Number.isFinite(declarado) && declarado > MAX_BODY) return erro(413, 'PAYLOAD_TOO_LARGE', 'Corpo grande demais.');
  const texto = await req.text();
  if (texto.length > MAX_BODY) return erro(413, 'PAYLOAD_TOO_LARGE', 'Corpo grande demais.');
  let corpo: Record<string, unknown>;
  try {
    const raw: unknown = texto ? JSON.parse(texto) : {};
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('corpo');
    corpo = raw as Record<string, unknown>;
  } catch {
    return erro(400, 'INVALID_JSON', 'Corpo JSON inválido.');
  }
  const ip = deps.trustedProxyHops === undefined ? clientIp(req.headers) : clientIp(req.headers, deps.trustedProxyHops);
  const r = await changeOwnPassword(
    { auth: deps.auth, db: deps.db, headers: req.headers, ip, ...(deps.now ? { now: deps.now } : {}) },
    { atual: corpo.senhaAtual, nova: corpo.novaSenha, confirmacao: corpo.confirmacao },
  );
  if (!r.ok) return erro(r.status, r.code, r.mensagem, r.erros, r.retryAfter ? { 'Retry-After': String(r.retryAfter) } : {});
  const headers = new Headers({ ...SEM_CACHE, 'x-request-id': requestId });
  for (const c of r.setCookies) headers.append('set-cookie', c);
  return Response.json({ ok: true, mensagem: r.mensagem }, { status: 200, headers });
}
