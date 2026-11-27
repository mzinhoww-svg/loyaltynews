/**
 * Verificador de robots.txt (RFC 9309) para quem baixa páginas fora do coletor do Editorial (ADR-007): provedores, leitor direto e scripts.
 * Usa a mesma decisão do verificador de fontes; 404/410 = sem regras; erro, desafio ou falha de rede = não buscar.
 */
import { robotsAllows } from '../../scripts/verify-dataset.mjs';
import { detectChallenge } from '../../scripts/crawl-guards.mjs';
import type { RobotsGate } from '../reader-port';

export const createRobotsGate = (fetchImpl: typeof fetch = fetch, userAgent?: string): RobotsGate => (url) => robotsAllows(url, fetchImpl, userAgent);

/** Motivo se a resposta é uma página de desafio/CAPTCHA/bloqueio (nunca contornar); `null` caso contrário. */
export const challengeReason = (r: { status?: number; headers?: Record<string, string>; html?: string; text?: string }): string | null => detectChallenge(r);
