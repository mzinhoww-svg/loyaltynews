// ModelOps/FinOps no Studio sobre @ln/modelops. A política em uso é a PROPOSTA DP-02 v5 (fixture do pacote): não é política
// aprovada em vigor, e a interface diz isso. Nenhuma chamada de modelo sai daqui: só simulação de rota e leitura do orçamento.
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { BudgetGate, PostgresLedgerStore, gateConfigFromPolicy, loadPolicyFile, type ModelPolicy, type SqlDatabase } from '@ln/modelops';
import { getDeps } from '../../app/api/_lib/deps';

export const POLITICA_ROTULO = 'PROPOSTA DP-02 v5 (fixture do pacote @ln/modelops), não é a política aprovada em vigor';

function caminhoPolitica(): string | null {
  const c = [process.env.LN_MODEL_POLICY, resolve(process.cwd(), '../../packages/modelops/fixtures/model.policy.proposto-DP02-v5.json'), resolve(process.cwd(), 'packages/modelops/fixtures/model.policy.proposto-DP02-v5.json')].filter((x): x is string => Boolean(x));
  return c.find((p) => existsSync(p)) ?? null;
}

export type PoliticaCarregada = { ok: true; policy: ModelPolicy } | { ok: false; erros: string[] };

export function carregarPolitica(): PoliticaCarregada {
  const caminho = caminhoPolitica();
  if (!caminho) return { ok: false, erros: ['Arquivo da política de modelos não encontrado.'] };
  const r = loadPolicyFile(caminho);
  return r.ok && r.policy ? { ok: true, policy: r.policy } : { ok: false, erros: r.errors };
}

export type PortaoCarregado = { ok: true; gate: BudgetGate } | { ok: false; motivo: string };

/**
 * Portão de orçamento sobre o ledger PERSISTENTE (PostgreSQL, `PostgresLedgerStore` de @ln/modelops, ADR-020): o mesmo que o gateway,
 * os workers e as rotas usam. Sem banco configurado NÃO há fallback em memória: o consumo fica indisponível (nunca um zero inventado).
 */
export function getPortao(policy: ModelPolicy): PortaoCarregado {
  const deps = getDeps();
  if (!deps) return { ok: false, motivo: 'Banco de dados não configurado (DATABASE_URL, BETTER_AUTH_SECRET e o TLS do banco): o consumo do mês não pode ser lido.' };
  return { ok: true, gate: new BudgetGate(gateConfigFromPolicy(policy), new PostgresLedgerStore(deps.db as unknown as SqlDatabase)) };
}
