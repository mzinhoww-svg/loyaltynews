/**
 * Coletor de violações de CSP (POST /api/csp-report). Público por natureza (o navegador envia sem sessão), então:
 *  - corpo limitado, no máximo 10 relatos por requisição e um teto de linhas de log por minuto (não vira inundação de log);
 *  - só registra diretiva, disposição e URLs SEM consulta nem fragmento; nunca IP, cookie, agente do navegador, amostra do
 *    script (`script-sample`) ou o texto da política;
 *  - responde sempre sem corpo.
 */
export const MAX_BYTES = 16 * 1024;
export const MAX_RELATOS = 10;
export const MAX_LINHAS_POR_MINUTO = 120;

export interface ViolacaoCsp {
  diretiva: string;
  bloqueado: string;
  documento: string;
  disposicao: 'enforce' | 'report' | '';
  fonte?: string;
  linha?: number;
}

const limpo = (v: unknown, max = 200): string =>
  typeof v === 'string' ? v.replace(/[\p{Cc}\p{Zl}\p{Zp}]/gu, ' ').trim().slice(0, max) : '';

/** URL sem consulta, fragmento e credenciais; palavras do relatório ('inline', 'eval', 'data'…) passam; esquemas opacos viram só o esquema. */
export function urlSegura(v: unknown): string {
  const s = limpo(v, 2000);
  if (!s) return '';
  if (/^[a-z-]+$/i.test(s)) return s.slice(0, 40);
  try {
    const u = new URL(s);
    return (u.protocol === 'http:' || u.protocol === 'https:' ? `${u.origin}${u.pathname}` : u.protocol).slice(0, 200);
  } catch {
    return 'invalida';
  }
}

const objeto = (v: unknown): Record<string, unknown> | null => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null);

/** Aceita os dois formatos: `report-uri` ({"csp-report": {...}}) e Reporting API ([{type:'csp-violation', body:{...}}]). */
export function extrairViolacoes(corpo: unknown): ViolacaoCsp[] {
  const brutos: Record<string, unknown>[] = [];
  for (const item of Array.isArray(corpo) ? corpo.slice(0, MAX_RELATOS) : [corpo]) {
    const o = objeto(item);
    if (!o) continue;
    const antigo = objeto(o['csp-report']);
    if (antigo) brutos.push(antigo);
    else if (o.type === 'csp-violation' && objeto(o.body)) brutos.push(objeto(o.body)!);
  }
  return brutos.flatMap((r) => {
    const diretiva = limpo(r['effective-directive'] ?? r.effectiveDirective ?? r['violated-directive'], 60).split(' ')[0]!;
    if (!/^[a-z-]+$/.test(diretiva)) return [];
    const disposicao = limpo(r.disposition, 10);
    const fonte = urlSegura(r['source-file'] ?? r.sourceFile);
    const linha = Number(r['line-number'] ?? r.lineNumber);
    return [{
      diretiva,
      bloqueado: urlSegura(r['blocked-uri'] ?? r.blockedURL),
      documento: urlSegura(r['document-uri'] ?? r.documentURL),
      disposicao: disposicao === 'enforce' || disposicao === 'report' ? disposicao : ('' as const),
      ...(fonte ? { fonte } : {}),
      ...(Number.isInteger(linha) && linha > 0 ? { linha } : {}),
    }];
  });
}

export function criarColetorCsp({ log = (linha: string) => console.warn(linha), agora = Date.now }: { log?: (linha: string) => void; agora?: () => number } = {}) {
  let janela = 0;
  let linhas = 0;
  return async function receber(req: Request): Promise<Response> {
    const vazio = (status: number) => new Response(null, { status, headers: { 'cache-control': 'no-store' } });
    const tipo = (req.headers.get('content-type') ?? '').split(';')[0]!.trim().toLowerCase();
    if (!['application/csp-report', 'application/reports+json', 'application/json'].includes(tipo)) return vazio(415);
    if (Number(req.headers.get('content-length') ?? 0) > MAX_BYTES) return vazio(413);
    // Lê em pedaços para não confiar no content-length.
    const partes: Uint8Array[] = [];
    let total = 0;
    const leitor = req.body?.getReader();
    while (leitor) {
      const { done, value } = await leitor.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_BYTES) {
        await leitor.cancel();
        return vazio(413);
      }
      partes.push(value);
    }
    let corpo: unknown;
    try {
      corpo = JSON.parse(await new Blob(partes as BlobPart[]).text());
    } catch {
      return vazio(400);
    }
    const minuto = Math.floor(agora() / 60_000);
    if (minuto !== janela) {
      janela = minuto;
      linhas = 0;
    }
    for (const v of extrairViolacoes(corpo)) {
      if (linhas >= MAX_LINHAS_POR_MINUTO) break;
      linhas += 1;
      log(JSON.stringify({ evt: 'csp_violacao', ...v }));
    }
    return vazio(204);
  };
}
