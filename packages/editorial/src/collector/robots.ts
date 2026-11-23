import { parseRobots as parseGuard, robotsDecision } from './crawl-guards.mjs';

export interface RobotsRules {
  allow: string[]; disallow: string[]; crawlDelaySec: number | null;
  /** Decisão pelo módulo comum de guardas (RFC 9309: normalização percent-encoded, grupo pelo token de produto, * e $). Quando presente, vale no lugar de allow/disallow. */
  decide?: (pathAndQuery: string) => boolean;
}

/** Parser mínimo de robots.txt: escolhe o grupo mais específico para o UA, senão '*'. */
export function parseRobots(txt: string, userAgent: string): RobotsRules {
  const ua = userAgent.toLowerCase();
  type G = { agents: string[]; allow: string[]; disallow: string[]; delay: number | null };
  const groups: G[] = [];
  let cur: G | null = null;
  let lastWasAgent = false;
  for (const rawLine of txt.split(/\r?\n/)) {
    const line = rawLine.replace(/#.*/, '').trim();
    if (!line) continue;
    const i = line.indexOf(':');
    if (i < 0) continue;
    const k = line.slice(0, i).trim().toLowerCase();
    const v = line.slice(i + 1).trim();
    if (k === 'user-agent') {
      if (!cur || !lastWasAgent) { cur = { agents: [], allow: [], disallow: [], delay: null }; groups.push(cur); }
      cur.agents.push(v.toLowerCase());
      lastWasAgent = true;
      continue;
    }
    lastWasAgent = false;
    if (!cur) continue;
    if (k === 'allow' && v) cur.allow.push(v);
    else if (k === 'disallow' && v) cur.disallow.push(v);
    else if (k === 'crawl-delay') { const n = Number(v); if (Number.isFinite(n)) cur.delay = n; }
  }
  const specific = groups.find((g) => g.agents.some((a) => a !== '*' && ua.includes(a)));
  const g = specific ?? groups.find((g) => g.agents.includes('*'));
  const parsed = parseGuard(txt);
  const decide = (path: string): boolean => robotsDecision(parsed, userAgent, path).allowed;
  return g ? { allow: g.allow, disallow: g.disallow, crawlDelaySec: g.delay, decide } : { allow: [], disallow: [], crawlDelaySec: null, decide };
}

function matchLen(pattern: string, path: string): number {
  // suporte a * e $ ; retorna comprimento do padrão se casar, senão -1
  const anchored = pattern.endsWith('$');
  const p = anchored ? pattern.slice(0, -1) : pattern;
  const re = new RegExp('^' + p.split('*').map((s) => s.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('.*') + (anchored ? '$' : ''));
  return re.test(path) ? p.length : -1;
}

/** Regra mais longa vence; empate favorece Allow (padrão RFC 9309). */
export function isAllowedByRobots(rules: RobotsRules, pathAndQuery: string): boolean {
  if (rules.decide) return rules.decide(pathAndQuery);
  let best = -1; let allowed = true;
  for (const d of rules.disallow) { const l = matchLen(d, pathAndQuery); if (l > best) { best = l; allowed = false; } }
  for (const a of rules.allow) { const l = matchLen(a, pathAndQuery); if (l >= best && l >= 0) { best = l; allowed = true; } }
  return allowed;
}
