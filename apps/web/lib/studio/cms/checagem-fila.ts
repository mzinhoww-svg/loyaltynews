// Tela da fila de checagem (ADR-002): a fila `checagem` está desligada nesta versão. A página lê a decisão do produto
// (QUEUE_DECISIONS, em @ln/workers/queues) para NÃO mostrar um botão que só pode falhar, e o action traduz a recusa pelo
// CÓDIGO do envelope (QUEUE_DISABLED), nunca pelo status HTTP — o Backend pode mudar de 503 para 501 sem quebrar a tela.
import type { QueueDecision } from '@ln/workers/queues';

/** Texto fixo quando a fila está desligada: estado, não falha transitória (não convida a retentar). */
export const AVISO_CHECAGEM_DESLIGADA =
  'A checagem automática está desligada nesta versão. O pedido de nova checagem não é aceito e não será processado depois.';

/** Código estável do envelope de erro do Backend para fila desligada. */
export const CODIGO_FILA_DESLIGADA = 'QUEUE_DISABLED';

export interface EstadoDaFila {
  /** true só quando a decisão é `on`: é o único caso em que o botão aparece. */
  pedidoAceito: boolean;
  /** Texto para mostrar no lugar do botão quando o pedido não é aceito. */
  aviso: string | null;
}

/** Decisão `on` = botão; `off` ou decisão ausente = aviso estático (nada de botão que só pode falhar). */
export function estadoDaFilaDeChecagem(decisao: Pick<QueueDecision, 'mode'> | undefined | null): EstadoDaFila {
  return decisao?.mode === 'on' ? { pedidoAceito: true, aviso: null } : { pedidoAceito: false, aviso: AVISO_CHECAGEM_DESLIGADA };
}

export function codigoDoErro(body: unknown): string | undefined {
  const codigo = (body as { error?: { code?: unknown } } | null)?.error?.code;
  return typeof codigo === 'string' ? codigo : undefined;
}

export interface ResultadoRecheck {
  tipo: 'ok' | 'err';
  aviso: string;
}

/**
 * Traduz a resposta do POST de nova checagem. O CÓDIGO decide primeiro: `QUEUE_DISABLED` é sempre erro com a mensagem do
 * Backend (mesmo que o status mude), e nunca vira "Nova checagem enfileirada".
 */
export function resultadoDoRecheck(r: { status: number; body: unknown }, mensagemDoBackend: string): ResultadoRecheck {
  if (codigoDoErro(r.body) === CODIGO_FILA_DESLIGADA) return { tipo: 'err', aviso: mensagemDoBackend };
  if (r.status >= 400) return { tipo: 'err', aviso: mensagemDoBackend };
  return { tipo: 'ok', aviso: 'Nova checagem enfileirada.' };
}
