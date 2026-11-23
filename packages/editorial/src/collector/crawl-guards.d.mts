export interface RobotsRule { allow: boolean; pattern: string }
export interface RobotsGroup { agents: string[]; rules: RobotsRule[] }
export interface ParsedRobots { groups: RobotsGroup[]; sitemaps: string[] }
export function productToken(ua: string): string;
export function parseRobots(text: string): ParsedRobots;
export function patternToRegExp(pattern: string): RegExp;
export function matchesPattern(pattern: string, path: string): boolean;
export function robotsDecision(parsed: ParsedRobots, ua: string, path: string): { allowed: boolean; rule: string | null; group: 'specific' | '*' | 'none' };
export function detectChallenge(r: { status?: number; headers?: Record<string, string>; html?: string; text?: string }): string | null;
export function classifyResponse(r: { status: number; headers?: Record<string, string>; html?: string; text?: string }): {
  estado: 'ok' | 'redirecionada' | 'bloqueada_http' | 'bloqueada_desafio' | 'indisponivel';
  observacao: string;
};
