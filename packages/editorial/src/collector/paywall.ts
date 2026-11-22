export interface PageProbe { status: number; headers: Record<string, string>; body: string }

const MARKERS: Array<[string, RegExp]> = [
  ['login_form', /<input[^>]+type=["']?password/i],
  ['paywall_text', /(assine\s+para\s+(ler|continuar)|conte[úu]do\s+exclusivo\s+para\s+assinantes|subscribe\s+to\s+(read|continue)|subscriber[- ]only|already a subscriber)/i],
  ['paywall_marker', /(paywall|data-paywall|class=["'][^"']*\bpaywall\b)/i],
  ['login_required', /(fa[çc]a\s+login\s+para|sign\s+in\s+to\s+(read|continue|view)|login\s+required)/i],
];

/** Detecta login/paywall: a página NÃO deve ser ingerida (nunca contornar). */
export function detectGate(p: PageProbe): { gated: boolean; reasons: string[] } {
  const reasons: string[] = [];
  if (p.status === 401) reasons.push('http_401');
  if (p.status === 402) reasons.push('http_402');
  if (p.status === 403) reasons.push('http_403');
  for (const [name, re] of MARKERS) if (re.test(p.body)) reasons.push(name);
  return { gated: reasons.length > 0, reasons };
}
