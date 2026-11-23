/**
 * Proteções comuns dos scripts de leitura de fontes públicas (verify-dataset, probe-sources, capture-sources).
 * Funções PURAS (sem rede) para poderem ser testadas com respostas simuladas.
 *
 *  1. robots.txt no padrão RFC 9309: grupos por User-Agent (linhas consecutivas compartilham o grupo; grupo específico
 *     vence o '*'; grupos do mesmo agente se somam), regras Allow/Disallow com curinga '*' e âncora '$', vence a regra
 *     mais longa e, em empate, Allow. Disallow vazio = tudo permitido.
 *  2. Detecção de página de DESAFIO/CAPTCHA/bloqueio mesmo com HTTP 200: sinais fortes valem em qualquer tamanho de página;
 *     sinais fracos (widgets de captcha) só em página curta ou com a frase de verificação. Nunca contornar: só marcar bloqueada.
 *  3. Redirecionamento NÃO é seguido: a leitura registra o 3xx e o destino; o destino vira uma URL candidata separada, com o
 *     próprio robots.txt e a própria requisição (uma requisição por URL, sem salto sem checagem).
 */

/** Token de produto do User-Agent (parte antes de '/'), em minúsculas. */
export const productToken = (ua) => String(ua).split(/[\s/]/)[0].toLowerCase();

/** @returns {{ groups: { agents: string[]; rules: { allow: boolean; pattern: string }[] }[]; sitemaps: string[] }} */
export function parseRobots(text) {
  const groups = [];
  const sitemaps = [];
  let cur = null;
  let lastWasAgent = false;
  for (const raw of String(text).split(/\r?\n/)) {
    const line = raw.replace(/#.*/, '').trim();
    if (!line) continue;
    const m = /^([A-Za-z-]+)\s*:\s*(.*)$/.exec(line);
    if (!m) continue;
    const field = m[1].toLowerCase();
    const value = m[2].trim();
    if (field === 'sitemap') { if (value) sitemaps.push(value); continue; }
    if (field === 'user-agent') {
      if (!cur || !lastWasAgent) { cur = { agents: [], rules: [] }; groups.push(cur); }
      cur.agents.push(value.toLowerCase());
      lastWasAgent = true;
      continue;
    }
    lastWasAgent = false;
    if (!cur) continue; // regra antes de qualquer User-agent: ignorada
    if (field === 'allow') cur.rules.push({ allow: true, pattern: value });
    else if (field === 'disallow') cur.rules.push({ allow: false, pattern: value });
  }
  return { groups, sitemaps };
}

/** Padrão do robots → RegExp ancorada no início do caminho: '*' = qualquer sequência, '$' final = fim do caminho. */
export function patternToRegExp(pattern) {
  let p = pattern;
  let anchored = false;
  if (p.endsWith('$')) { anchored = true; p = p.slice(0, -1); }
  const body = p.split('*').map((s) => s.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('.*');
  return new RegExp('^' + body + (anchored ? '$' : ''));
}
export const matchesPattern = (pattern, path) => patternToRegExp(pattern).test(path);

/**
 * Decisão do RFC 9309 para um caminho (com query) e um User-Agent.
 * @returns {{ allowed: boolean; rule: string | null; group: 'specific' | '*' | 'none' }}
 */
export function robotsDecision(parsed, ua, path) {
  const token = productToken(ua);
  const uaLower = String(ua).toLowerCase();
  const specific = parsed.groups.filter((g) => g.agents.some((a) => a !== '*' && (token === a || token.startsWith(a) || uaLower.includes(a))));
  const star = parsed.groups.filter((g) => g.agents.includes('*'));
  const chosen = specific.length ? specific : star;
  const group = specific.length ? 'specific' : star.length ? '*' : 'none';
  const rules = chosen.flatMap((g) => g.rules).filter((r) => r.pattern !== '' && matchesPattern(r.pattern, path));
  if (rules.length === 0) return { allowed: true, rule: null, group };
  rules.sort((a, b) => b.pattern.length - a.pattern.length || (a.allow === b.allow ? 0 : a.allow ? -1 : 1));
  const best = rules[0];
  return { allowed: best.allow, rule: `${best.allow ? 'Allow' : 'Disallow'}: ${best.pattern}`, group };
}

const STRONG_TITLE = /<title[^>]*>\s*(just a moment|attention required|checking your browser|um momento|verificando se voc[eê]|security check|robot check|are you a robot|you have been blocked|pardon our interruption|access denied|acesso negado|request blocked|please wait|verifying you are human|verifique que voc[eê] [eé] humano)/i;
const STRONG_HTML = /(cf-browser-verification|__cf_chl_|cf-chl-(?:bypass|opt|widget)|id=["']challenge-form["']|captcha-delivery\.com|geo\.captcha-delivery|px-captcha|_incapsula_resource|incapsula incident|perimeterx|datadome|sucuri website firewall|akamai.{0,40}reference #\d|errors\.edgesuite\.net|ddos protection by|\/cdn-cgi\/challenge-platform\/h\/[a-z]\/orchestrate\/(?:jsch|chl_page))/i;
const WEAK_HTML = /(g-recaptcha|grecaptcha|hcaptcha|h-captcha|cf-turnstile|geetest|funcaptcha)/i;
const CHALLENGE_PHRASE = /(verify (?:that )?you are (?:a )?human|verifying you are human|n[aã]o sou um rob[oô]|confirme que voc[eê] [eé] humano|prove you(?:'| a)re not a robot|complete the security check|enable javascript and cookies to continue|ative o javascript e os cookies para continuar|unusual traffic from your computer|tr[aá]fego incomum)/i;

const VERIFICATION_WORDS = /(captcha|rob[oô]|human[oa]?|verifica|security check|seguran[cç]a do navegador|challenge|desafio)/i;

/**
 * Página de desafio/bloqueio? Devolve o motivo (string) ou null. Não decide sobre 403/429 (isso é o status HTTP).
 * @param {{ status?: number; headers?: Record<string,string>; html?: string; text?: string }} r
 */
export function detectChallenge(r) {
  const h = Object.fromEntries(Object.entries(r.headers ?? {}).map(([k, v]) => [k.toLowerCase(), String(v)]));
  const html = r.html ?? '';
  const text = r.text ?? '';
  if (/challenge/i.test(h['cf-mitigated'] ?? '')) return 'cabeçalho cf-mitigated: challenge';
  if (STRONG_TITLE.test(html)) return 'título de página de desafio/bloqueio';
  const strong = STRONG_HTML.exec(html);
  if (strong) return `marcador de desafio/bloqueio no HTML (${strong[1].toLowerCase().slice(0, 30)})`;
  if (CHALLENGE_PHRASE.test(text)) return 'frase de verificação humana no texto';
  // Widget de captcha: só é desafio se a página é praticamente VAZIA (< 400 caracteres) ou curta (< 1.500) E fala em verificação.
  // Página curta com conteúdo real (menu, texto) e um captcha de formulário/newsletter NÃO é desafio (ex.: RI e site de programa).
  if (WEAK_HTML.test(html) && (text.length < 400 || (text.length < 1500 && VERIFICATION_WORDS.test(text)))) return 'widget de captcha em página vazia/curta de verificação';
  return null;
}

/** Estado de uma leitura já feita, em uma só decisão (sem rede). */
export function classifyResponse(r) {
  if (r.status >= 300 && r.status < 400) return { estado: 'redirecionada', observacao: `HTTP ${r.status}: redirecionamento NÃO seguido; o destino é outra candidata, com o próprio robots.txt` };
  if (r.status === 403 || r.status === 429) return { estado: 'bloqueada_http', observacao: `HTTP ${r.status}: não repetir nem contornar` };
  if (r.status !== 200) return { estado: 'indisponivel', observacao: `HTTP ${r.status}` };
  const c = detectChallenge(r);
  if (c) return { estado: 'bloqueada_desafio', observacao: `página de desafio com HTTP 200 (${c}): não contornar` };
  return { estado: 'ok', observacao: '' };
}
