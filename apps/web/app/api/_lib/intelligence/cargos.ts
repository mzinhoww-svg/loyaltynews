// Cargos do Entity Intelligence no Studio: fila "a confirmar" (cargo lido de fonte SECUNDÁRIA — LinkedIn/The Org — entra como INFERIDO e nunca vira fato
// nem Move sem confirmação oficial; MOVES_MODEL.md e INGESTION_CONTRACT.md do Data). A LÓGICA é do pacote do Data (`@ln/intelligence`: listRoleViews,
// confirmRole, discardRole): uma só implementação. Aqui ficam só as regras do Backend em volta dela:
//  - lista: filtro por `source_level` (official | secondary | inferred), `total` e paginação;
//  - confirmar: a página oficial tem de ser do MESMO site (host ou subdomínio) da fonte oficial já cadastrada da empresa (a evidência da própria organização
//    ou de um cargo declarado dela), além das regras do pacote (https, nunca LinkedIn/The Org, outra fonte que não a secundária). O servidor não lê a página:
//    quem confirma é a pessoa (editor ou superior), com auditoria;
//  - descartar e confirmar são auditados (`intelligence.cargo_confirmado` / `intelligence.cargo_descartado`) com quem, o quê e o motivo, sem segredo.
import { randomUUID } from 'node:crypto';
import {
  SECONDARY_HOSTS, confirmRoleHandler as pkgConfirm, discardRoleHandler as pkgDiscard, listRoleViews,
  type ApiResult, type Db as IntelDb, type RoleView, type SourceLevel,
} from '@ln/intelligence';

const S = 'intelligence';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const LEVELS: readonly SourceLevel[] = ['official', 'secondary', 'inferred'];
const ok = <T>(body: T, status = 200): ApiResult<T> => ({ status, body });
const fail = (status: number, code: string, message: string): ApiResult<never> => ({ status, body: { error: { code, message } } });
const isObj = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x);
const intIn = (v: unknown, def: number, max: number): number => {
  const n = typeof v === 'string' && /^\d+$/.test(v) ? Number(v) : typeof v === 'number' && Number.isInteger(v) ? v : def;
  return Math.min(Math.max(n, 0), max);
};
const PAGE = 200;
const MAX_SCAN = 5000;

/** GET /roles?certainty=&source_level=&organizationId=&q=&limit=&offset= — cargos abertos, com `source_level`, `status`, evidência e `total`. */
export async function listRolesHandler(db: IntelDb, _actor: string, input: unknown): Promise<ApiResult> {
  const i = isObj(input) ? input : {};
  if (i.certainty !== undefined && i.certainty !== 'inferred' && i.certainty !== 'declared') return fail(400, 'invalid_input', 'certainty deve ser inferred ou declared');
  const level = i.source_level === undefined ? undefined : i.source_level;
  if (level !== undefined && !LEVELS.includes(level as SourceLevel)) return fail(400, 'invalid_input', 'source_level deve ser official, secondary ou inferred');
  if (i.organizationId !== undefined && !(typeof i.organizationId === 'string' && UUID.test(i.organizationId))) return fail(400, 'invalid_input', 'organizationId deve ser UUID');
  if (typeof i.q === 'string' && i.q.trim().length > 100) return fail(400, 'invalid_input', 'q aceita até 100 caracteres');
  const limit = Math.max(1, intIn(i.limit, 50, 200));
  const offset = intIn(i.offset, 0, 100_000);
  // varre os cargos abertos em páginas (o conjunto é pequeno) para filtrar por nível e contar o total sem inventar número
  const all: RoleView[] = [];
  for (let off = 0; off < MAX_SCAN; off += PAGE) {
    const page = await listRoleViews(db, {
      ...(i.certainty ? { certainty: i.certainty as 'declared' | 'inferred' } : {}),
      ...(typeof i.organizationId === 'string' ? { organizationId: i.organizationId } : {}),
      ...(typeof i.q === 'string' && i.q.trim() ? { q: i.q.trim() } : {}),
      limit: PAGE, offset: off,
    });
    all.push(...page);
    if (page.length < PAGE) break;
  }
  const filtered = level ? all.filter((r) => r.source_level === level) : all;
  return ok({ items: filtered.slice(offset, offset + limit), total: filtered.length, limit, offset });
}

const hostOf = (u: string): string => {
  try {
    return new URL(u).hostname.toLowerCase();
  } catch {
    return '';
  }
};
const sameSite = (candidate: string, official: string): boolean => candidate === official || candidate.endsWith(`.${official}`);

async function audit(db: IntelDb, actor: string, action: string, roleId: string, detalhe: Record<string, unknown>): Promise<void> {
  await db.query(
    `INSERT INTO public.audit_log (id, at, actor_id, actor_role, action, resource, resource_id, detalhe) VALUES ($1, now(), $2, NULL, $3, 'intelligence', $4, $5::jsonb)`,
    [randomUUID(), actor || null, action, roleId, JSON.stringify(detalhe)],
  );
}

async function roleInfo(db: IntelDb, id: string) {
  const r = await db.query<{ organization_id: string; person_name: string; title: string; org_ev_url: string }>(
    `SELECT r.organization_id, p.full_name AS person_name, r.title, oev.source_url AS org_ev_url
       FROM ${S}.role_assignment r JOIN ${S}.person p ON p.id = r.person_id
       JOIN ${S}.organization o ON o.id = r.organization_id JOIN ${S}.evidence oev ON oev.id = o.evidence_id WHERE r.id = $1`,
    [id],
  );
  return r.rows[0] ?? null;
}

/** Confirma um cargo "a confirmar" com a URL de uma página OFICIAL do site cadastrado da empresa: vira declarado, com evidência nova, sem gerar Move. */
export async function confirmRoleHandler(db: IntelDb, actor: string, input: unknown): Promise<ApiResult> {
  const i = isObj(input) ? input : {};
  const info = typeof i.id === 'string' && UUID.test(i.id) && typeof i.officialUrl === 'string' ? await roleInfo(db, i.id) : null;
  if (typeof i.officialUrl === 'string') {
    try {
      const u = new URL(i.officialUrl);
      if (u.username || u.password) return fail(400, 'invalid_input', 'a URL oficial não pode ter credenciais embutidas'); // o pacote não confere; o Backend recusa
    } catch {
      /* URL inválida: quem responde é o pacote (400) */
    }
  }
  if (info && typeof i.officialUrl === 'string') {
    const host = hostOf(i.officialUrl);
    if (host && !SECONDARY_HOSTS.test(host) && i.officialUrl.startsWith('https://')) {
      // o site oficial cadastrado: o da evidência da organização e os dos cargos já DECLARADOS dela (nunca rede profissional/organograma)
      const declared = await db.query<{ source_url: string }>(
        `SELECT ev.source_url FROM ${S}.role_assignment r JOIN ${S}.evidence ev ON ev.id = r.evidence_id WHERE r.organization_id = $1 AND r.certainty = 'declared'`,
        [info.organization_id],
      );
      const oficiais = [hostOf(info.org_ev_url), ...declared.rows.map((d) => hostOf(d.source_url))].filter((h) => h && !SECONDARY_HOSTS.test(h));
      if (!oficiais.some((h) => sameSite(host, h))) return fail(422, 'NOT_OFFICIAL_SOURCE', 'a página não é do site oficial cadastrado desta empresa');
    }
  }
  const r = await pkgConfirm(db, actor, input);
  if (r.status === 200 && info && typeof i.id === 'string' && typeof i.officialUrl === 'string') {
    await audit(db, actor, 'intelligence.cargo_confirmado', i.id, { pessoa: info.person_name, cargo: info.title, fonteOficial: hostOf(i.officialUrl) });
  }
  return r;
}

/** Descarta um cargo "a confirmar": fecha o cargo (nunca apaga), guarda o motivo e o tira da fila. */
export async function discardRoleHandler(db: IntelDb, actor: string, input: unknown): Promise<ApiResult> {
  const i = isObj(input) ? input : {};
  const motivo = typeof i.motivo === 'string' ? i.motivo.trim() : '';
  if (typeof i.motivo === 'string' && (motivo.length < 5 || motivo.length > 200)) return fail(400, 'invalid_input', 'motivo obrigatório (5 a 200 caracteres)');
  const info = typeof i.id === 'string' && UUID.test(i.id) ? await roleInfo(db, i.id) : null;
  const r = await pkgDiscard(db, actor, input);
  if (r.status === 200 && info && typeof i.id === 'string') await audit(db, actor, 'intelligence.cargo_descartado', i.id, { pessoa: info.person_name, cargo: info.title, motivo });
  return r;
}
