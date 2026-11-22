// MOCK — gateway de modelos sintético. Nenhuma chamada real a API tarifada; saídas são roteirizadas.
import type { GatewayRequest, GatewayResponse, ModelGateway, TaskClass } from '../src/gateway';

export const MOCK_EVIDENCE_QUOTE = 'a parceria amplia as opções de acúmulo para os participantes';

export function goodDraftOutput(evidenceId: string, over: Record<string, unknown> = {}) {
  return {
    headline: 'MOCK: Programa Alfa fecha acordo com a Varejista Beta',
    body:
      'O Programa Alfa, empresa fictícia usada em testes, fechou acordo com a Varejista Beta. ' +
      'A regra passa a valer em 1º de dezembro de 2026 e prevê 2 pontos para cada real gasto. ' +
      `Segundo a diretora fictícia Maria Teste, "${MOCK_EVIDENCE_QUOTE}".`,
    claims: [
      { id: 'c1', kind: 'fact', text: 'Programa Alfa fechou acordo com a Varejista Beta', evidenceIds: [evidenceId] },
      { id: 'c2', kind: 'number', text: '2 pontos por real gasto', evidenceIds: [evidenceId] },
      { id: 'c3', kind: 'date', text: 'a partir de 1 de dezembro de 2026', evidenceIds: [evidenceId] },
      { id: 'c4', kind: 'quote', text: 'fala da diretora', evidenceIds: [evidenceId], quote: { text: MOCK_EVIDENCE_QUOTE, speaker: 'Maria Teste' } },
    ],
    ...over,
  };
}

type Script = Partial<Record<TaskClass, (req: GatewayRequest) => GatewayResponse>>;

const ok = (provider: string, output: unknown): GatewayResponse =>
  ({ ok: true, provider, model: `${provider}-mock`, output, usage: { inputTokens: 0, outputTokens: 0, costMicrosUsd: 0 } });

export class MockGateway implements ModelGateway {
  requests: GatewayRequest[] = [];
  script: Script;
  constructor(evidenceId: string, script: Script = {}) {
    this.script = {
      triage: () => ok('deepseek', { relevant: true, editoria: 'pontos' }),
      context: () => ok('deepseek', { notes: [{ text: 'Contexto MOCK sobre programas de acúmulo.', evidenceIds: [evidenceId] }] }),
      draft: () => ok('deepseek', goodDraftOutput(evidenceId)),
      factcheck: (r) => ok(r.excludeProviders.includes('anthropic') ? 'deepseek' : 'anthropic', {
        verdicts: ['c1', 'c2', 'c3', 'c4'].map((claimId) => ({ claimId, verdict: 'pass' })),
      }),
      review: () => ok('deepseek', { approve: true, issues: [] }),
      social_pack: () => ok('deepseek', { linkedin: 'MOCK: Programa Alfa e Varejista Beta fecham acordo de acúmulo. Veja os detalhes.', instagram: 'MOCK ig' }),
      ...script,
    };
  }
  async invoke(req: GatewayRequest): Promise<GatewayResponse> {
    this.requests.push(req);
    const h = this.script[req.taskClass];
    return h ? h(req) : { ok: false, refusal: 'model_disabled' };
  }
}

export { ok as mockOk };
