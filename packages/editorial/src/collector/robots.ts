import { parseRobots as parseGuard, productToken, robotsDecision } from './crawl-guards.mjs';

/**
 * robots.txt do coletor. Toda DECISÃO de acesso (grupo do agente, curinga, âncora, normalização percent-encoded, precedência)
 * vem do módulo comum de guardas (`crawl-guards.mjs`, do Data, RFC 9309): este arquivo não tem mais parser nem comparador
 * próprios para allow/disallow. Só duas coisas ficam aqui porque o módulo comum ainda não as expõe: o Crawl-delay do grupo do
 * agente e a contagem de regras desse grupo (relatório). Ambos escolhem o grupo pelo MESMO critério do módulo (token de produto
 * exato; senão '*').
 */
export interface RobotsRules {
  crawlDelaySec: number | null;
  /** Nº de regras Allow/Disallow do grupo que vale para o agente (só para relatório). */
  ruleCount: number;
  /** Decisão do módulo comum para um caminho com query. */
  decide: (pathAndQuery: string) => boolean;
}

interface RawGroup { agents: string[]; delay: number | null; rules: number }

function rawGroups(txt: string): RawGroup[] {
  const groups: RawGroup[] = [];
  let cur: RawGroup | null = null;
  let lastWasAgent = false;
  for (const raw of txt.split(/\r?\n/)) {
    const line = raw.replace(/#.*/, '').trim();
    const m = /^([A-Za-z-]+)\s*:\s*(.*)$/.exec(line);
    if (!m) continue;
    const field = m[1]!.toLowerCase(); const value = m[2]!.trim();
    if (field === 'user-agent') {
      if (!cur || !lastWasAgent) { cur = { agents: [], delay: null, rules: 0 }; groups.push(cur); }
      cur.agents.push(value.toLowerCase()); lastWasAgent = true; continue;
    }
    lastWasAgent = false;
    if (!cur) continue;
    if (field === 'crawl-delay') { const n = Number(value); if (Number.isFinite(n) && n >= 0) cur.delay = n; }
    else if ((field === 'allow' || field === 'disallow') && value !== '') cur.rules++;
  }
  return groups;
}

export function parseRobots(txt: string, userAgent: string): RobotsRules {
  const token = productToken(userAgent);
  const groups = rawGroups(txt);
  const specific = groups.filter((g) => g.agents.includes(token));
  const chosen = specific.length ? specific : groups.filter((g) => g.agents.includes('*'));
  const delay = chosen.map((g) => g.delay).find((d): d is number => d !== null) ?? null;
  const parsed = parseGuard(txt);
  return {
    crawlDelaySec: delay,
    ruleCount: chosen.reduce((n, g) => n + g.rules, 0),
    decide: (path: string): boolean => robotsDecision(parsed, userAgent, path).allowed,
  };
}

export function isAllowedByRobots(rules: RobotsRules, pathAndQuery: string): boolean {
  return rules.decide(pathAndQuery);
}
