// Rotas da API: falha ao CONFERIR a sessão responde 503 SESSION_UNAVAILABLE, nunca 401 (o Studio trataria como deslogado).
import { describe, expect, it } from 'vitest';
import { AccessDeniedError, SessionLookupError } from '@ln/auth';
import { toResponse } from './http';

describe('toResponse', () => {
  it('SessionLookupError → 503 SESSION_UNAVAILABLE em pt-BR; sem sessão continua 401', async () => {
    const r = toResponse(new SessionLookupError(), 'req-1');
    expect(r.status).toBe(503);
    expect(((await r.json()) as { error: { code: string; message: string } }).error).toMatchObject({ code: 'SESSION_UNAVAILABLE', message: 'Não foi possível conferir a sua sessão agora. Tente de novo em instantes.' });
    expect(toResponse(new AccessDeniedError('NO_SESSION'), 'req-2').status).toBe(401);
  });
});
