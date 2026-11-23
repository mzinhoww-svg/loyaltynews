// Decisão do PM (opção e, 23/11/2026): o typecheck sai de DENTRO do build da Vertra (o ambiente de 1024 MB morria no passo "Running TypeScript"),
// mas o pacote só pode dispensá-lo se existir o relatório de integração (integracao.mjs --verify) com o typecheck VERDE do MESMO commit.
// Devolve o motivo da recusa ou '' (relatório válido). Função pura (testada sem arquivos).
export function typecheckReportProblem(report, sha) {
  if (!report || typeof report !== 'object') return 'relatório ilegível (esperado o JSON gerado por integracao.mjs --verify)';
  if (typeof report.head !== 'string' || !/^[0-9a-f]{40}$/.test(report.head)) return 'relatório sem "head" (SHA de 40 caracteres)';
  if (String(sha).toLowerCase() !== report.head.toLowerCase()) return `o relatório é de OUTRO commit (${report.head.slice(0, 12)}); o pacote é de ${String(sha).slice(0, 12)}: rode a verificação no commit que vai empacotar`;
  const etapas = Array.isArray(report.verificacao) ? report.verificacao.filter((v) => v && v.etapa === 'typecheck') : [];
  if (etapas.length === 0) return 'o relatório não tem a etapa typecheck (use integracao.mjs --verify)';
  if (!etapas.every((v) => v.ok === true)) return 'o typecheck do relatório FALHOU: sem typecheck verde o pacote não dispensa a checagem de tipos do build';
  return '';
}

/** Variável de ambiente do build que liga o salto do typecheck do Next (apps/web/next.config.ts: typescript.ignoreBuildErrors só com LN_BUILD_SKIP_TYPECHECK === '1'). */
export function typecheckEnv(release) {
  return release && release.semTypecheckNoBuild === true ? { LN_BUILD_SKIP_TYPECHECK: '1' } : {};
}

/**
 * Build "leve" (release.json.buildLeve): limita os workers do next build a 1. Na Vertra o ambiente de build é 2x a RAM do app (1024 MB para 512) e o Next
 * (16.4.6, config-shared.js) usa max(1, (CIRCLE_NODE_TOTAL || núcleos) - 1) workers: 3 na Vertra, e o build morreu (Killed, 137) em "Collecting page data using 3 workers".
 * CIRCLE_NODE_TOTAL=2 => 1 worker (confirmado: "Collecting page data using 1 worker"). Só variável do build; nenhum código de produto muda.
 */
export function buildLeveEnv(release) {
  return release && release.buildLeve === true ? { CIRCLE_NODE_TOTAL: '2' } : {};
}
