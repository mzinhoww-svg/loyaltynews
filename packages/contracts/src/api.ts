import { z } from 'zod';

/** Envelope de erro comum das rotas de API (pedido da Frente 02 Backend). */
export const ApiError = z.object({
  error: z.object({
    code: z.string().regex(/^[A-Z][A-Z0-9_]+$/),
    message: z.string().min(1),
    details: z.unknown().optional(),
    requestId: z.string().min(1).optional(),
  }),
});
export type ApiError = z.infer<typeof ApiError>;

export function apiError(code: string, message: string, details?: unknown): ApiError {
  return ApiError.parse({ error: { code, message, ...(details === undefined ? {} : { details }) } });
}
