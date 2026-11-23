import { readOnlyTransport, type McpTransport } from './live';

// Transporte MCP por HTTP (Streamable HTTP) SOMENTE LEITURA, para o servidor web ler as métricas do mLabs sem passar pelo OpenBot.
// Por construção só entrega ferramentas da lista de leitura (`readOnlyTransport` por fora): `prepare_media_upload`, `create_post` e
// qualquer escrita lançam ANTES de tocar a rede. A credencial entra por parâmetro (vinda do cofre/ambiente por quem chama), fica em
// campo privado e nunca aparece em erro, log ou retorno.
// NÃO VERIFICADO (nenhuma chamada foi feita a partir do servidor): se o mLabs aceita token estático no cabeçalho Authorization (a conexão
// do OpenBot usa login interativo), a versão do protocolo MCP que ele aceita e o formato de cada resposta. O protocolo implementado é o
// público: `initialize` → `notifications/initialized` → `tools/call`, resposta em JSON ou em SSE, resultado como texto JSON.

export class McpHttpError extends Error {
  constructor(readonly reason: 'config_invalida' | 'http' | 'protocolo' | 'ferramenta_recusou' | 'resposta_nao_json' | 'tempo_esgotado') {
    super(`mcp-http: ${reason}`);
    this.name = 'McpHttpError';
  }
}

export interface McpHttpOptions {
  /** Endpoint do servidor MCP (HTTPS). */
  url: string;
  /** Token de acesso (Bearer). Segredo: vem do cofre; nunca logado. */
  token: string;
  fetchImpl?: typeof fetch;
  /** Prazo de cada requisição HTTP. Padrão 20 s. */
  timeoutMs?: number;
  protocolVersion?: string;
}

const REQ_HEADERS = { 'content-type': 'application/json', accept: 'application/json, text/event-stream' } as const;

/** Lê o corpo da resposta (JSON direto ou SSE `data:`) e devolve a mensagem JSON-RPC com o `id` pedido. */
async function readRpc(res: Response, id: number): Promise<{ result?: unknown; error?: unknown }> {
  const text = await res.text();
  const ct = res.headers.get('content-type') ?? '';
  const candidates: unknown[] = [];
  if (ct.includes('text/event-stream')) {
    for (const line of text.split(/\r?\n/)) {
      if (line.startsWith('data:')) {
        try {
          candidates.push(JSON.parse(line.slice(5).trim()));
        } catch {
          /* linha que não é JSON: ignora */
        }
      }
    }
  } else {
    try {
      candidates.push(JSON.parse(text));
    } catch {
      throw new McpHttpError('protocolo');
    }
  }
  const flat = candidates.flatMap((c) => (Array.isArray(c) ? c : [c]));
  const m = flat.find((c) => typeof c === 'object' && c !== null && (c as { id?: unknown }).id === id) as { result?: unknown; error?: unknown } | undefined;
  if (!m) throw new McpHttpError('protocolo');
  return m;
}

function build(o: McpHttpOptions): McpTransport {
  let u: URL;
  try {
    u = new URL(o.url);
  } catch {
    throw new McpHttpError('config_invalida');
  }
  if (u.protocol !== 'https:' || u.username || u.password || !o.token || /[\r\n]/.test(o.token)) throw new McpHttpError('config_invalida');
  const doFetch = o.fetchImpl ?? fetch;
  const timeout = o.timeoutMs ?? 20_000;
  const token = o.token; // só neste fechamento
  let rpcId = 0;
  /** Uma sessão MCP por vez: `current` é a inicialização em curso OU concluída. Só vale se a confirmação (`initialized`) deu certo. */
  interface Session { id: string | undefined }
  let current: Promise<Session> | null = null;

  const post = async (body: unknown, sessionId?: string): Promise<Response> => {
    try {
      return await doFetch(u.toString(), {
        method: 'POST', redirect: 'error', signal: AbortSignal.timeout(timeout),
        headers: { ...REQ_HEADERS, authorization: `Bearer ${token}`, ...(sessionId ? { 'mcp-session-id': sessionId } : {}) },
        body: JSON.stringify(body),
      });
    } catch (e) {
      throw new McpHttpError(e instanceof Error && e.name === 'TimeoutError' ? 'tempo_esgotado' : 'http');
    }
  };

  async function init(): Promise<Session> {
    const id = ++rpcId;
    const res = await post({ jsonrpc: '2.0', id, method: 'initialize', params: { protocolVersion: o.protocolVersion ?? '2025-06-18', capabilities: {}, clientInfo: { name: 'ln-growth-metrics', version: '0.1.0' } } });
    if (!res.ok) throw new McpHttpError('http');
    const sid = res.headers.get('mcp-session-id') ?? undefined;
    const m = await readRpc(res, id);
    if (m.error) throw new McpHttpError('protocolo');
    // a confirmação TEM de dar certo (2xx): sem ela a sessão não está pronta e nada é reaproveitado
    const note = await post({ jsonrpc: '2.0', method: 'notifications/initialized' }, sid);
    await note.text().catch(() => undefined);
    if (!note.ok) throw new McpHttpError('http');
    return { id: sid };
  }

  /** Inicialização compartilhada: chamadas simultâneas esperam a MESMA; falha não fica guardada (a próxima recomeça). */
  function ensure(): Promise<Session> {
    if (!current) {
      const p: Promise<Session> = init().catch((e: unknown) => {
        if (current === p) current = null;
        throw e;
      });
      current = p;
    }
    return current;
  }

  class SessionExpired extends McpHttpError {
    constructor() {
      super('protocolo');
    }
  }

  async function callOnce(tool: string, args: Record<string, unknown>): Promise<unknown> {
    const pending = ensure();
    const s = await pending;
    const id = ++rpcId;
    const res = await post({ jsonrpc: '2.0', id, method: 'tools/call', params: { name: tool, arguments: args } }, s.id);
    if (res.status === 404 && s.id) {
      // sessão expirada: descarta SÓ se ainda for a atual (outra chamada pode já ter aberto uma nova)
      if (current === pending) current = null;
      throw new SessionExpired();
    }
    if (!res.ok) throw new McpHttpError('http');
    const m = await readRpc(res, id);
    if (m.error) throw new McpHttpError('ferramenta_recusou');
    const r = m.result as { isError?: boolean; content?: { type?: string; text?: string }[]; structuredContent?: unknown } | undefined;
    if (!r || r.isError) throw new McpHttpError('ferramenta_recusou');
    if (r.structuredContent !== undefined) return r.structuredContent;
    const text = (r.content ?? []).filter((c) => c.type === 'text' && typeof c.text === 'string').map((c) => c.text).join('');
    try {
      return JSON.parse(text);
    } catch {
      throw new McpHttpError('resposta_nao_json');
    }
  }

  return {
    async call(tool, args) {
      try {
        return await callOnce(tool, args);
      } catch (e) {
        // sessão que expirou: UMA nova tentativa com sessão nova (sempre só leitura)
        if (e instanceof SessionExpired) return callOnce(tool, args);
        throw e;
      }
    },
  };
}

/**
 * Transporte MCP por HTTP que SÓ deixa passar ferramentas de leitura. Lança `McpHttpError('config_invalida')` se a URL não for HTTPS
 * (sem credencial embutida) ou se faltar o token.
 */
export function createReadOnlyMlabsMcpTransport(o: McpHttpOptions): McpTransport {
  return readOnlyTransport(build(o));
}
