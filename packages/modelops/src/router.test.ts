import { test } from 'vitest';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { loadPolicyFile } from './policy';
import { route, type RouteRequest } from './router';
import type { ModelPolicy } from './types';

const FIXTURE = fileURLToPath(new URL('../fixtures/model.policy.proposto-DP02-v4.json', import.meta.url));
const base = loadPolicyFile(FIXTURE).policy as ModelPolicy;
const NOW = new Date('2026-11-23T12:00:00-03:00');
const ALL_MODELS = base.models.map((m) => m.id);

function clone(): ModelPolicy {
  return JSON.parse(JSON.stringify(base)) as ModelPolicy;
}

function req(over: Partial<RouteRequest> = {}): RouteRequest {
  return {
    task: 'editorial_draft',
    dataClasses: ['public'],
    unpublished: false,
    mode: 'simulation',
    qualifiedModelIds: ALL_MODELS,
    zdrVerifiedModelIds: [],
    now: NOW,
    ...over,
  };
}

test('simulação com modelos qualificados escolhe o primário da rota econômica', () => {
  const d = route(base, req({ qualifiedModelIds: ['claude-haiku-5-5'] }));
  assert.equal(d.status, 'eligible');
  if (d.status === 'eligible') {
    assert.equal(d.primary, 'claude-haiku-5-5');
    assert.equal(d.taskClass, 'essential');
    assert.equal(d.escalation, false);
  }
});

test('produção com production_enabled = false bloqueia tudo', () => {
  const d = route(base, req({ mode: 'production' }));
  assert.equal(d.status, 'blocked');
  if (d.status === 'blocked') assert.equal(d.reason, 'production_disabled');
});

test('produção sem qualificação bloqueia por não qualificado', () => {
  const p = clone();
  p.rules.production_enabled = true;
  const d = route(p, req({ mode: 'production', qualifiedModelIds: [] }));
  assert.equal(d.status, 'blocked');
  if (d.status === 'blocked') {
    assert.equal(d.reason, 'no_eligible_candidate');
    assert.ok(d.reasons?.['claude-haiku-5-5']?.includes('not_qualified'));
  }
});

test('dado pessoal não vai ao OpenRouter; classe desconhecida bloqueia', () => {
  const personal = route(base, req({ dataClasses: ['public', 'personal'] }));
  assert.equal(personal.status, 'blocked');
  if (personal.status === 'blocked') assert.equal(personal.reason, 'personal_no_approved_processor');

  const unknown = route(base, req({ dataClasses: ['weird'] }));
  assert.equal(unknown.status, 'blocked');
  if (unknown.status === 'blocked') assert.equal(unknown.reason, 'unknown_class');

  const empty = route(base, req({ dataClasses: [] }));
  assert.equal(empty.status, 'blocked');
});

test('a classe mais restrita vale: público + interno bloqueia', () => {
  const d = route(base, req({ dataClasses: ['public', 'internal'] }));
  assert.equal(d.status, 'blocked');
  if (d.status === 'blocked') assert.equal(d.reason, 'data_class_not_approved');
});

test('fact-check com redator Anthropic: OpenAI é primário, Sonnet fica fora pelo mesmo autor', () => {
  const d = route(
    base,
    req({
      task: 'fact_check',
      draftModelId: 'anthropic/claude-haiku-5.5',
      qualifiedModelIds: ALL_MODELS,
    }),
  );
  assert.equal(d.status, 'eligible');
  if (d.status === 'eligible') {
    assert.equal(d.primary, 'openai-text-review');
    assert.deepEqual(d.fallbacks, ['openai-text-review-alt']);
    assert.ok(d.reasons['claude-sonnet-5-5']?.includes('same_author_as_draft'));
  }
});

test('fact-check com redator OpenAI: só modelos Anthropic passam', () => {
  const d = route(
    base,
    req({ task: 'fact_check', draftModelId: 'openai/gpt-6.1-terra', qualifiedModelIds: ALL_MODELS }),
  );
  assert.equal(d.status, 'eligible');
  if (d.status === 'eligible') {
    assert.equal(d.primary, 'claude-sonnet-5-5');
    assert.deepEqual(d.fallbacks, []);
  }
});

test('fact-check sem autor do redator bloqueia (falha fechada)', () => {
  const d = route(base, req({ task: 'fact_check' }));
  assert.equal(d.status, 'blocked');
  if (d.status === 'blocked') assert.equal(d.reason, 'draft_author_unknown');
});

test('fact-check quando só há o mesmo autor qualificado: bloqueia, sem fallback', () => {
  const d = route(
    base,
    req({ task: 'fact_check', draftModelId: 'anthropic/claude-haiku-5.5', qualifiedModelIds: ['claude-sonnet-5-5'] }),
  );
  assert.equal(d.status, 'blocked');
  if (d.status === 'blocked') assert.equal(d.reason, 'no_eligible_candidate');
});

test('DeepSeek com verba zero nunca é escolhido, mesmo qualificado e na rota', () => {
  const p = clone();
  p.routes.economy?.unshift('deepseek-v4-pro');
  const d = route(p, req({ qualifiedModelIds: ['deepseek-v4-pro', 'claude-haiku-5-5'] }));
  assert.equal(d.status, 'eligible');
  if (d.status === 'eligible') {
    assert.equal(d.primary, 'claude-haiku-5-5');
    assert.ok(d.reasons['deepseek-v4-pro']?.includes('zero_allocation'));
  }
});

test('preço vencido (mais de 7 dias) bloqueia o candidato: custo desconhecido', () => {
  const p = clone();
  const haiku = p.models.find((m) => m.id === 'claude-haiku-5-5');
  if (haiku?.binding) haiku.binding.price_as_of = '2026-11-01T00:00:00Z';
  const d = route(p, req({ qualifiedModelIds: ['claude-haiku-5-5'] }));
  assert.equal(d.status, 'blocked');
  if (d.status === 'blocked') assert.ok(d.reasons?.['claude-haiku-5-5']?.includes('price_expired'));
});

test('trabalho editorial não publicado exige ZDR verificado; publicado não exige', () => {
  const unpub = route(base, req({ unpublished: true, qualifiedModelIds: ['claude-haiku-5-5'] }));
  assert.equal(unpub.status, 'blocked');
  if (unpub.status === 'blocked') assert.ok(unpub.reasons?.['claude-haiku-5-5']?.includes('zdr_unverified'));

  const withZdr = route(
    base,
    req({ unpublished: true, qualifiedModelIds: ['claude-haiku-5-5'], zdrVerifiedModelIds: ['claude-haiku-5-5'] }),
  );
  assert.equal(withZdr.status, 'eligible');

  const pub = route(base, req({ unpublished: false, qualifiedModelIds: ['claude-haiku-5-5'] }));
  assert.equal(pub.status, 'eligible');
});

test('Opus fora de auditoria exige motivo e conta escalonamento', () => {
  const noReason = route(
    base,
    req({ task: 'complex_analysis', qualifiedModelIds: ['claude-opus-5-5'] }),
  );
  assert.equal(noReason.status, 'blocked');
  if (noReason.status === 'blocked') assert.ok(noReason.reasons?.['claude-opus-5-5']?.includes('escalation_reason_missing'));

  const withReason = route(
    base,
    req({ task: 'complex_analysis', qualifiedModelIds: ['claude-opus-5-5'], escalationReason: 'análise de risco alto' }),
  );
  assert.equal(withReason.status, 'eligible');
  if (withReason.status === 'eligible') assert.equal(withReason.escalation, true);
});

test('limite de escalonamentos (max_escalations = 2) bloqueia o terceiro', () => {
  const d = route(
    base,
    req({
      task: 'complex_analysis',
      qualifiedModelIds: ['claude-opus-5-5'],
      escalationReason: 'x',
      escalationsSoFar: 2,
    }),
  );
  assert.equal(d.status, 'blocked');
  if (d.status === 'blocked') assert.ok(d.reasons?.['claude-opus-5-5']?.includes('max_escalations'));
});

test('kill switch global e por rota bloqueiam', () => {
  assert.equal(route(base, req({ killGlobal: true })).status, 'blocked');
  const byRoute = route(base, req({ killedRoutes: ['economy'], qualifiedModelIds: ['claude-haiku-5-5'] }));
  assert.equal(byRoute.status, 'blocked');
  if (byRoute.status === 'blocked') assert.equal(byRoute.reason, 'kill_route');
});

test('ritual essencial sobe para a classe essencial; ritual comum fica não essencial', () => {
  const ess = route(base, req({ task: 'daily', ritualId: 'D-editorial', qualifiedModelIds: ['claude-haiku-5-5'] }));
  assert.equal(ess.status, 'eligible');
  if (ess.status === 'eligible') assert.equal(ess.taskClass, 'essential');

  const common = route(base, req({ task: 'daily', ritualId: 'D-marketing', qualifiedModelIds: ['claude-haiku-5-5'] }));
  assert.equal(common.status, 'eligible');
  if (common.status === 'eligible') assert.equal(common.taskClass, 'non_essential');
});

test('tarefas determinísticas não chamam modelo', () => {
  const d = route(base, req({ task: 'social_publish' }));
  assert.equal(d.status, 'deterministic');
});

test('imagem sem rota qualificada bloqueia (rota de imagem vazia na v4)', () => {
  const d = route(base, req({ task: 'concept_image', qualifiedModelIds: ALL_MODELS }));
  assert.equal(d.status, 'blocked');
  if (d.status === 'blocked') assert.equal(d.reason, 'no_candidates');
});

test('tarefa desconhecida bloqueia', () => {
  const d = route(base, req({ task: 'tarefa-inventada' }));
  assert.equal(d.status, 'blocked');
  if (d.status === 'blocked') assert.equal(d.reason, 'unknown_task');
});

test('tentativas: no máximo max_attempts (3) candidatos, primário mais dois fallbacks', () => {
  const d = route(
    base,
    req({ task: 'fact_check', draftModelId: 'deepseek/deepseek-v4-pro', qualifiedModelIds: ['claude-sonnet-5-5', 'openai-text-review', 'openai-text-review-alt'] }),
  );
  assert.equal(d.status, 'eligible');
  if (d.status === 'eligible') {
    assert.equal(d.primary, 'claude-sonnet-5-5');
    assert.equal(d.fallbacks.length, 2);
  }
});

// Achado: pela v4, os modelos OpenAI de revisão só valem para fact_check e editorial_review.
// Com redator Anthropic, a correção WF08 não tem revisor elegível: bloqueia (falha fechada).
test('WF08 com redator Anthropic bloqueia: OpenAI não é permitida nessa tarefa e Sonnet é do mesmo autor', () => {
  const d = route(
    base,
    req({ task: 'WF08 correction', draftModelId: 'anthropic/claude-haiku-5.5', qualifiedModelIds: ALL_MODELS }),
  );
  assert.equal(d.status, 'blocked');
  if (d.status === 'blocked') {
    assert.equal(d.reason, 'no_eligible_candidate');
    assert.ok(d.reasons?.['openai-text-review']?.includes('task_not_allowed'));
    assert.ok(d.reasons?.['claude-sonnet-5-5']?.includes('same_author_as_draft'));
  }
});

test('WF08 com redator OpenAI usa Sonnet como revisor, na classe reserva', () => {
  const d = route(
    base,
    req({ task: 'WF08 correction', draftModelId: 'openai/gpt-6.1-terra', qualifiedModelIds: ALL_MODELS }),
  );
  assert.equal(d.status, 'eligible');
  if (d.status === 'eligible') {
    assert.equal(d.taskClass, 'reserve');
    assert.equal(d.route, 'review');
    assert.equal(d.primary, 'claude-sonnet-5-5');
  }
});
