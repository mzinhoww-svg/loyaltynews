// Só no runtime Node do servidor: C4 (filtro de PEM em stdout/stderr) e C2 (rejeição ou exceção sem tratamento: log saneado e saída com código 1).
// ADR-022 (N2): as flags de produto são resolvidas aqui, na subida; configuração inválida impede o servidor de subir.
import { installOutputFilter, installProcessGuards } from '@ln/db/safe-log';
import { initRuntimeFlags } from './lib/runtime-flags';

installOutputFilter();
installProcessGuards();

try {
  const r = initRuntimeFlags(process.env);
  for (const w of r.warnings) console.warn(w);
  console.log(r.logLine);
} catch (e) {
  // A mensagem do resolveFlags cita só nome e ambiente (N4), nunca o valor bruto.
  console.error(e instanceof Error ? e.message : 'Subida recusada: flags inválidas (ADR-022)');
  process.exit(1);
}
