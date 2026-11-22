import { getDeps } from '../_lib/deps';
import { dbProbe, readiness, redisProbe } from '../_lib/ready';

export const dynamic = 'force-dynamic';

export async function GET() {
  const deps = getDeps();
  const report = await readiness(process.env, { db: deps ? dbProbe(deps.db) : undefined, redis: redisProbe(process.env) });
  return Response.json(report, { status: report.status === 'ok' ? 200 : 503, headers: { 'cache-control': 'no-store' } });
}
