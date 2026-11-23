import { FLAG_DEFAULTS, isEnabled, type FlagState } from '@ln/contracts';
import { handleCallback, handleHeartbeat, handlePull, type OpenBotDeps, type OpenBotFlags, type SignedRequest } from './handlers';

// Cola fina entre a camada HTTP (Backend: `POST /api/openbot/pull|heartbeat|callback`) e os handlers puros. A camada HTTP só
// entrega o corpo CRU e os cabeçalhos; aqui eles viram `SignedRequest`. Nenhum cabeçalho além dos dois de assinatura é lido.

export const SIGNATURE_HEADER = 'x-ln-signature';
export const TIMESTAMP_HEADER = 'x-ln-timestamp';

export interface HttpLikeRequest {
  /** Corpo cru, byte a byte como foi assinado. */
  body: string;
  headers: Record<string, string | string[] | undefined>;
}

function header(h: HttpLikeRequest['headers'], name: string): string | undefined {
  for (const k of Object.keys(h)) {
    if (k.toLowerCase() !== name) continue;
    const v = h[k];
    return Array.isArray(v) ? v[0] : v;
  }
  return undefined;
}

export function toSignedRequest(req: HttpLikeRequest): SignedRequest {
  const ts = header(req.headers, TIMESTAMP_HEADER);
  const parsed = ts !== undefined && /^\d{10,16}$/.test(ts) ? Number(ts) : undefined;
  return { body: req.body, signature: header(req.headers, SIGNATURE_HEADER), timestampMs: parsed };
}

export function createOpenBotRoutes(deps: OpenBotDeps) {
  return {
    pull: (req: HttpLikeRequest) => handlePull(deps, toSignedRequest(req)),
    heartbeat: (req: HttpLikeRequest) => handleHeartbeat(deps, toSignedRequest(req)),
    callback: (req: HttpLikeRequest) => handleCallback(deps, toSignedRequest(req)),
  };
}

/**
 * Flags do adaptador a partir de `@ln/contracts`: `dispatchEnabled` = `openbotDispatch` (desligada por padrão) e o kill
 * switch, que PREVALECE sobre a flag. `overrides` só vale se for decisão registrada (ligar é do proprietário, em staging).
 */
export function openbotFlagsFrom(args: { overrides?: Partial<FlagState>; kill?: boolean } = {}): OpenBotFlags {
  const kill = args.kill === true;
  return { dispatchEnabled: !kill && isEnabled('openbotDispatch', args.overrides ?? {}), kill };
}

/** O padrão do contrato continua desligado (conferido aqui para o teste falhar se alguém ligar por padrão). */
export const OPENBOT_DISPATCH_DEFAULT: boolean = FLAG_DEFAULTS.openbotDispatch;
