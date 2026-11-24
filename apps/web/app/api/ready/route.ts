import { getDeps } from '../_lib/deps';
import journal from '@ln/db/journal';
import { dbProbe, journalCount, migrationProbe, readiness, redisProbe } from '../_lib/ready';

export const dynamic = 'force-dynamic';

export async function GET() {
  const deps = getDeps();
  const report = await readiness(process.env, {
    db: deps ? dbProbe(deps.db) : undefined,
    redis: redisProbe(process.env),
    migrations: deps ? migrationProbe(deps.db, journalCount(journal)) : undefined,
  });
  return Response.json(report, { status: report.status === 'ok' ? 200 : 503, headers: { 'cache-control': 'no-store' } });
}
