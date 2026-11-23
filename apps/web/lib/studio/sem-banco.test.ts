import { describe, expect, it } from 'vitest';
import { naoConfigurado } from './backend';
import { dispatchCommercial } from '../../app/api/_lib/commercial';
import { dispatchEditorial } from '../../app/api/_lib/editorial';
import { dispatchSocial } from '../../app/api/_lib/social';

// Sem DATABASE_URL/BETTER_AUTH_SECRET as rotas do Backend respondem 503 NOT_CONFIGURED e as telas do Studio mostram
// "banco não configurado" (nunca dado falso). Aqui provamos o contrato que as telas leem.
const resp = async (d: (r: Request) => Promise<Response>, path: string) => {
  const res = await d(new Request(`http://studio.local${path}`));
  return { status: res.status, ok: res.status < 400 as boolean, body: await res.json() } as Parameters<typeof naoConfigurado>[0];
};

describe('Studio sem banco configurado', () => {
  it.each([
    ['comercial (público)', dispatchCommercial, '/api/commercial/formats'],
    ['comercial (Studio)', dispatchCommercial, '/api/commercial/studio/leads'],
    ['editorial', dispatchEditorial, '/api/studio/editorial/queue'],
    ['social', dispatchSocial, '/api/studio/social/summary'],
  ])('%s: 503 NOT_CONFIGURED é reconhecido pelas telas', async (_n, d, path) => {
    const r = await resp(d, path);
    expect(r.status).toBe(503);
    expect(naoConfigurado(r)).toBe(true);
  });
  it('outros erros não são confundidos com banco ausente', () => {
    expect(naoConfigurado({ status: 403, ok: false, body: { error: { code: 'FORBIDDEN', message: 'x' } } })).toBe(false);
    expect(naoConfigurado({ status: 200, ok: true, body: {} })).toBe(false);
  });
});
