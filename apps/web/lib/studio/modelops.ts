// ModelOps/FinOps no Studio sobre @ln/modelops. A política em uso é a PROPOSTA DP-02 v5 (fixture do pacote): não é política
// aprovada em vigor, e a interface diz isso. Nenhuma chamada de modelo sai daqui: só simulação de rota e leitura do orçamento.
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { BudgetGate, MemoryLedgerStore, gateConfigFromPolicy, loadPolicyFile, type ModelPolicy } from '@ln/modelops';
import { singleton } from './registros';

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

/** Portão de orçamento sobre um livro-razão em memória (vazio: sem chamadas, sem consumo). */
export function getPortao(policy: ModelPolicy): BudgetGate {
  return singleton('portao-orcamento', () => new BudgetGate(gateConfigFromPolicy(policy), new MemoryLedgerStore()));
}
