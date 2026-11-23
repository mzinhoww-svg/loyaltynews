// MOCK — "modelo" SIMULADO para o ensaio local da fábrica (rodada simulada). NÃO é um modelo: monta, de forma determinística,
// saídas JSON no formato esperado a partir da EVIDÊNCIA que recebe. O texto produzido é um rascunho de ensaio marcado
// "SIMULADO" (cabeçalho e corpo) e NUNCA pode ser publicado (applyPublication/publishApproved recusam `simulated_content`).
import type { ChatRequest, ChatResult, ChatTransport } from '../src/factory/llm-gateway';

export const SIM_DRAFTER = 'simulado-redator';
export const SIM_CHECKER = 'simulado-checador';

interface Ev { id: string; title?: string; text?: string }

function parseInput(req: ChatRequest): Record<string, unknown> {
  const c = req.messages[1]?.content ?? '';
  const i = c.indexOf('\n');
  return JSON.parse(c.slice(i + 1)) as Record<string, unknown>;
}

export class SimulatedEditorialModel implements ChatTransport {
  readonly calls: ChatRequest[] = [];
  constructor(private readonly editoria: string = 'regulacao') {}

  async chat(req: ChatRequest): Promise<ChatResult> {
    this.calls.push(req);
    const input = parseInput(req);
    const evs = (input['evidences'] as Ev[] | undefined) ?? [];
    const ev = evs[0];
    let out: unknown;
    switch (req.taskClass) {
      case 'triage': out = { relevant: true, editoria: this.editoria }; break;
      case 'context': out = { notes: [] }; break;
      case 'draft': {
        const raw = (ev?.title ?? 'matéria da fonte').replace(/\s+/g, ' ').trim().slice(0, 150);
        const quotable = !/["“”]/.test(raw) && raw.length >= 12;
        const cited = quotable ? `“${raw}”` : raw;
        out = {
          headline: `SIMULADO: ${raw}`.slice(0, 190),
          resumo: 'SIMULADO — ensaio local com modelo simulado; este texto não é matéria jornalística e não pode ser publicado.',
          body: `SIMULADO — texto de ensaio gerado por modelo simulado, sem apuração e sem redação real. A fonte oficial publicou a matéria ${cited}. O conteúdo completo está na fonte citada ao final.`,
          claims: [{ id: 'c1', kind: 'fact', text: 'A fonte oficial publicou matéria com o título citado.', evidenceIds: ev ? [ev.id] : [] }],
        };
        break;
      }
      case 'factcheck': {
        const claims = (input['claims'] as Array<{ id: string }> | undefined) ?? [];
        out = { verdicts: claims.map((c) => ({ claimId: c.id, verdict: 'pass' })) };
        break;
      }
      case 'review': out = { approve: true, issues: [] }; break;
      default: return { ok: false, refusal: 'model_disabled', detail: `SIMULADO: sem saída para ${req.taskClass}` };
    }
    return {
      ok: true, provider: req.excludeProviders.length ? SIM_CHECKER : SIM_DRAFTER, model: `simulado-${req.route}`,
      text: JSON.stringify(out), usage: { inputTokens: req.estimate.promptTokens, outputTokens: 0, costMicrosUsd: 0 },
    };
  }
}
