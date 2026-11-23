// Login de e2e do Studio: devolve cookies REAIS do Better Auth para um usuário de teste do papel pedido (e semeia uma matéria da Fábrica com ?seed=editorial).
// Em produção `e2eBackend` é nulo (alias `@ln-studio/e2e-backend`, ver next.config.ts): a rota responde 404 sempre.
// Mesmo no build de e2e só funciona com LN_STUDIO_TEST_SESSION=1. Query: user, role, mfa=0|1.
import { e2eBackend } from '@ln-studio/e2e-backend';

export const dynamic = 'force-dynamic';

const naoEncontrada = () => Response.json({ error: { code: 'NOT_FOUND', message: 'Rota inexistente.' } }, { status: 404 });

export async function GET(req: Request): Promise<Response> {
  if (!e2eBackend || process.env.LN_STUDIO_TEST_SESSION !== '1') return naoEncontrada();
  const q = new URL(req.url).searchParams;
  if (q.get('flag')) {
    try {
      (await e2eBackend()).setFlag(q.get('flag')!, q.get('on') === '1');
      return Response.json({ ok: true });
    } catch (e) {
      return Response.json({ error: { code: 'BAD_REQUEST', message: e instanceof Error ? e.message : 'falha' } }, { status: 400 });
    }
  }
  if (q.get('seed') === 'editorial') {
    try {
      return Response.json({ ok: true, ...(await (await e2eBackend()).seedEditorial()) });
    } catch (e) {
      return Response.json({ error: { code: 'BAD_REQUEST', message: e instanceof Error ? e.message : 'falha' } }, { status: 400 });
    }
  }
  if (q.get('seed') === 'intelligence') {
    try {
      return Response.json({ ok: true, ...(await (await e2eBackend()).seedIntelligence()) });
    } catch (e) {
      return Response.json({ error: { code: 'BAD_REQUEST', message: e instanceof Error ? e.message : 'falha' } }, { status: 400 });
    }
  }
  if (q.get('seed') === 'pautas') {
    try {
      return Response.json({ ok: true, ...(await (await e2eBackend()).seedPautasProcessadas()) });
    } catch (e) {
      return Response.json({ error: { code: 'BAD_REQUEST', message: e instanceof Error ? e.message : 'falha' } }, { status: 400 });
    }
  }
  if (q.get('seed') === 'editorial-aprovada') {
    try {
      return Response.json({ ok: true, ...(await (await e2eBackend()).seedEditorialAprovada()) });
    } catch (e) {
      return Response.json({ error: { code: 'BAD_REQUEST', message: e instanceof Error ? e.message : 'falha' } }, { status: 400 });
    }
  }
  if (q.get('seed') === 'alertas-watchlist') {
    try {
      return Response.json({ ok: true, ...(await (await e2eBackend()).seedAlertasWatchlist()) });
    } catch (e) {
      return Response.json({ error: { code: 'BAD_REQUEST', message: e instanceof Error ? e.message : 'falha' } }, { status: 400 });
    }
  }
  const user = q.get('user') ?? '';
  const role = q.get('role') ?? '';
  if (!/^[a-z0-9_-]{1,32}$/.test(user)) return Response.json({ error: { code: 'BAD_REQUEST', message: 'user inválido' } }, { status: 400 });
  try {
    const b = await e2eBackend();
    const r = await b.login(user, role, q.get('mfa') !== '0');
    const headers = new Headers({ 'content-type': 'application/json' });
    for (const c of r.setCookies) headers.append('set-cookie', c);
    return new Response(JSON.stringify({ ok: true, id: r.id }), { status: 200, headers });
  } catch (e) {
    return Response.json({ error: { code: 'BAD_REQUEST', message: e instanceof Error ? e.message : 'falha' } }, { status: 400 });
  }
}
