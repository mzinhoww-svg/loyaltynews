import type { BuildIdentity } from './build-identity';

export interface HealthPayload {
  status: 'ok';
  service: 'loyaltynews-web';
  /** Commit da versão em execução (APP_COMMIT, definido no deploy). */
  version: string;
  /** BUILD_ID do `.next` realmente servido (null se não houver arquivo). */
  buildId: string | null;
  /** Commit da marca da restauração do pré-construído (null em pacote comum/sem marca). */
  buildCommit: string | null;
  /** Ambiente (APP_ENV: homologacao, producao, ci...). */
  env: string;
  /** Flags de produto ligadas (ADR-022, N8): só nomes, sem decisão nem origem. */
  flags: string[];
}

/** Corpo público de /api/health. Não expõe segredo; das flags, só os nomes ligados (N8). */
export function healthPayload(env: Record<string, string | undefined>, flags: readonly string[] = [], identity: BuildIdentity = { buildId: null, commit: null, prebuilt: false }): HealthPayload {
  return {
    status: 'ok',
    service: 'loyaltynews-web',
    version: env.APP_COMMIT?.trim() || 'unknown',
    buildId: identity.buildId,
    buildCommit: identity.prebuilt ? identity.commit : null,
    env: env.APP_ENV?.trim() || 'local',
    flags: [...flags],
  };
}

/**
 * Falha fechada do health: se o `.next` tem marca de pré-construído e o commit dela difere do APP_COMMIT do ambiente,
 * o app está servindo build de outro commit (verde falso). Devolve o motivo para a rota responder 503; null = ok.
 * Pacote comum (sem marca) não é comparável — o build da Vertra não grava commit no `.next`.
 */
export function healthProblem(env: Record<string, string | undefined>, identity: BuildIdentity): 'build_divergente' | null {
  const appCommit = env.APP_COMMIT?.trim() || '';
  // P3 do QA 5: marca de pré-construído SEM commit não prova qual build está no volume (a resposta sairia 200 com
  // buildCommit null). É divergência, pelo mesmo caminho e com a mesma mensagem dos outros casos.
  if (identity.prebuilt && !identity.commit) return 'build_divergente';
  if (identity.prebuilt && identity.commit && appCommit && identity.commit !== appCommit) return 'build_divergente';
  return null;
}
