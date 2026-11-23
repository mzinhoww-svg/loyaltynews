import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Pasta do pacote (`packages/agents`), resolvida por import.meta.url (funciona em ESM e no vitest). */
export const PKG_DIR = fileURLToPath(new URL('..', import.meta.url));
export const POLICY_FIXTURE = join(PKG_DIR, '../modelops/fixtures/model.policy.proposto-DP02-v5.json');
