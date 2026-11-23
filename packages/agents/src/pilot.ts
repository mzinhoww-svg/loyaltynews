/**
 * Kit do PILOTO de 10 matérias pelo canal OpenBot (assinaturas Claude e Codex; sem custo de API).
 * Desenho: `fast-track/custo/piloto-10-materias-openbot.md` (Arquiteto). Esta frente entrega os prompts versionados, o rascunho
 * dos agentes (NÃO criados), a planilha de medição e o avaliador dos critérios de saída. Nada roda antes do adaptador ligado,
 * do modo qualification homologado e da política v7; o piloto vem ANTES da etapa 1 paga (DP-27).
 *
 * Os dados dos testes são SIMULADOS. Os limites das assinaturas não são conhecidos: o piloto serve para MEDI-LOS.
 */
import { createHash } from 'node:crypto';
import type { LoadedRegistries } from './config';

// --- fontes e distribuição (DP-28) ----------------------------------------------------------------------------------

export interface PilotSource {
  id: string;
  /** classe de termos do Editorial: institucional (pedido do PM) ou D (sem termos de conteúdo; risco aceito, DP-28) */
  termsClass: 'institucional' | 'D';
  editoria: string;
  articles: number;
  /** `confirmed`: nomeada no desenho do Arquiteto; `to_confirm`: proposta a confirmar pelo Editorial */
  status: 'institutional_pending_enablement' | 'to_confirm_by_editorial';
}

export const PILOT_SOURCES: PilotSource[] = [
  { id: 'senado-noticias', termsClass: 'institucional', editoria: 'regulacao', articles: 3, status: 'institutional_pending_enablement' },
  { id: 'camara-noticias', termsClass: 'institucional', editoria: 'regulacao', articles: 3, status: 'institutional_pending_enablement' },
  { id: 'abemf', termsClass: 'D', editoria: 'programas', articles: 2, status: 'to_confirm_by_editorial' },
  { id: 'livelo-imprensa', termsClass: 'D', editoria: 'pontos', articles: 1, status: 'to_confirm_by_editorial' },
  { id: 'febraban', termsClass: 'D', editoria: 'bancos', articles: 1, status: 'to_confirm_by_editorial' },
];

/** Fontes de classe C: fora do piloto (DP-28: só com revisão caso a caso registrada). */
export const CLASS_C_EXCLUDED = ['Azul', 'GOL', 'ABECS', 'IATA', 'Nubank', 'Accor', 'Marriott', 'Salesforce', 'HubSpot', 'Zendesk', 'oneworld', 'ABAV'] as const;

export type PilotAccount = 'claude' | 'codex' | 'deterministic';
export type PilotStage = 'draft' | 'check_edit' | 'extract_social' | 'rights_seo_qa';

export const PILOT_STAGES: Record<PilotStage, { account: PilotAccount; label: string }> = {
  draft: { account: 'claude', label: 'Redação (Claude)' },
  check_edit: { account: 'codex', label: 'Checagem + revisão do editor numa chamada (Codex; autor distinto do redator)' },
  extract_social: { account: 'claude', label: 'Extração de entidades e texto social (Claude)' },
  rights_seo_qa: { account: 'deterministic', label: 'Direitos, SEO e QA visual (determinístico)' },
};

// --- prompts versionados ---------------------------------------------------------------------------------------------

export interface PilotPrompt {
  id: 'writer' | 'checker_editor' | 'extractor_social';
  version: string;
  account: Exclude<PilotAccount, 'deterministic'>;
  /** perfis do registro cujo contrato de saída vale para este prompt */
  profiles: string[];
  text: string;
  /** `promptVersion` = `<id>-v1+<sha256 dos 12 primeiros>`: muda se o texto mudar */
  promptVersion: string;
}

const COMMON_RULES = [
  'Use SOMENTE o pacote de evidência entregue (texto, URL, data e hash de cada fonte). Não use conhecimento próprio como fato, não navegue e não invente.',
  'Cite e linke a fonte de cada afirmação; reproduza o mínimo necessário (no máximo uma citação curta, até 25 palavras, entre aspas e com a URL). Nunca copie trechos longos.',
  'Respeite o robots e os termos da fonte: se o pacote indicar restrição (termsStatus pendente, classe C), pare e devolva `blockers: ["terms_unresolved"]`.',
  'Nenhum dado pessoal além de nome, cargo e empresa de fonte pública, com a referência. Sem contato, documento ou vida privada.',
  'Responda APENAS com JSON no contrato de saída do perfil. Sem texto fora do JSON. Se faltar evidência, devolva `blockers` em vez de preencher.',
];

function fields(reg: Pick<LoadedRegistries, 'agents'>, id: string): string {
  const p = reg.agents.find((a) => a.id === id);
  if (!p) throw new Error(`perfil ${id} ausente do registro`);
  return p.required_result_fields.join(', ');
}

export function buildPilotPrompts(reg: Pick<LoadedRegistries, 'agents'>): PilotPrompt[] {
  const mk = (id: PilotPrompt['id'], account: PilotPrompt['account'], profiles: string[], lines: string[]): PilotPrompt => {
    const text = lines.join('\n');
    const sha = createHash('sha256').update(text).digest('hex').slice(0, 12);
    return { id, version: 'v1', account, profiles, text, promptVersion: `${id}-v1+${sha}` };
  };
  return [
    mk('writer', 'claude', ['writer_regulacao', 'writer_programas', 'writer_pontos', 'writer_bancos'], [
      'PAPEL: redator da editoria {{editoria}} do Loyalty News (PT-BR, tom jornalístico, claro e objetivo). Perfil: writer_{{editoria}}.',
      'TAREFA: escrever UMA matéria curta e rascunhada a partir do pacote de evidência {{packageRef}}. Não publica: o resultado vai para checagem independente.',
      ...COMMON_RULES.map((r, i) => `REGRA ${i + 1}: ${r}`),
      `SAÍDA: JSON com agent_id "writer_{{editoria}}", artifact_type "writer_{{editoria}}.result", result { ${fields(reg, 'writer_regulacao')} }, evidence_refs, confidence, blockers, kpi_observations.`,
      'Cada item de `claims` precisa de `source_refs` apontando para o pacote; afirmação sem fonte vai para `blockers`, não para o texto.',
      'IDENTIDADE: declare no campo `kpi_observations.model` o modelo que está respondendo.',
    ]),
    mk('checker_editor', 'codex', ['factcheck', 'editor_regulacao', 'editor_programas', 'editor_pontos', 'editor_bancos'], [
      'PAPEL: checador de fatos independente e editor da editoria {{editoria}}, de outro autor de modelo que o redator. Perfis: factcheck e editor_{{editoria}}.',
      'TAREFA: em UMA chamada, (1) checar cada afirmação do rascunho {{draftRef}} contra o pacote de evidência {{packageRef}} e (2) revisar estrutura, título, tom, direitos e cópia literal. Você NÃO reescreve a matéria.',
      ...COMMON_RULES.map((r, i) => `REGRA ${i + 1}: ${r}`),
      `SAÍDA: JSON { "factcheck": { ${fields(reg, 'factcheck')} }, "editor": { ${fields(reg, 'editor_regulacao')} }, "verdict": "approved" | "blocked", "reasons": [...], "evidence_refs": [...], "blockers": [...] } (cada bloco no contrato do respectivo perfil).`,
      'Bloqueie (`verdict: "blocked"`) se houver: unsupported_claim, copy_literal, rights_unknown, terms_unresolved ou fonte de classe C sem revisão registrada. Na dúvida, bloqueie.',
      'INDEPENDÊNCIA: declare em `kpi_observations.model` o modelo que está respondendo; se for do mesmo autor do redator, devolva `blockers: ["same_author"]` e pare.',
    ]),
    mk('extractor_social', 'claude', ['company', 'people', 'linkedin'], [
      'PAPEL: extrator de entidades (Intelligence) e redator do texto social (LinkedIn) da matéria JÁ APROVADA {{articleRef}}.',
      'TAREFA: (1) extrair entidades (empresas e cargos públicos) como `fato + fonte + link + data`, NUNCA o trecho; relações só quando declaradas na fonte, sem vínculos presumidos; (2) escrever um texto curto de LinkedIn com o link da matéria.',
      ...COMMON_RULES.map((r, i) => `REGRA ${i + 1}: ${r}`),
      `SAÍDA: JSON { "entities": [ { name, kind, fact, source_url, source_date } ], "social": { ${fields(reg, 'linkedin')} } } (contratos de company e linkedin).`,
      'Não publica nada: o texto social só é gravado como rascunho. Instagram e The Loyal estão desligados.',
      'IDENTIDADE: declare em `kpi_observations.model` o modelo que está respondendo.',
    ]),
  ];
}

// --- rascunho dos agentes do piloto (NÃO criados) ---------------------------------------------------------------------

export interface PilotAgentDraft {
  draft_id: string;
  name: string;
  title: string;
  account: 'claude' | 'codex';
  stage: PilotStage;
  description: string;
  prompt_version: string;
  kinds_pulled: string[];
  tool_contract: string[];
  must_not: string[];
}

const PILOT_MUST_NOT = [
  'publicar, agendar ou enviar qualquer conteúdo (o piloto não publica: rascunho aprovado ou bloqueado no staging)',
  'chamar a API tarifada ou qualquer provedor de modelo fora da assinatura do próprio agente (o complemento OpenRouter fica DESLIGADO)',
  'usar ferramenta fora do contrato (sem navegador, sem rede além das rotas assinadas do adaptador, sem shell)',
  'gravar segredo, chave ou token em log, prompt ou resultado',
  'aprovar a própria entrega; o checador nunca é do mesmo autor do redator',
  'criar agentes, rotinas ou agendamentos',
];

export function buildPilotAgents(prompts: readonly PilotPrompt[]): PilotAgentDraft[] {
  const byId = new Map(prompts.map((p) => [p.id, p]));
  const spec: { id: PilotPrompt['id']; draft: string; name: string; title: string; stage: PilotStage; kinds: string[]; desc: string }[] = [
    { id: 'writer', draft: 'ln_pilot_writer', name: 'LN Piloto — Redator', title: 'Redator do piloto de 10 matérias (OpenBot, assinatura Claude)', stage: 'draft', kinds: ['editorial_draft'], desc: 'Puxa tarefas de redação do adaptador, lê o pacote de evidência pela API do LN e devolve o rascunho no contrato do perfil writer_{editoria}. Não publica.' },
    { id: 'checker_editor', draft: 'ln_pilot_checker', name: 'LN Piloto — Checador e Editor', title: 'Checagem de fatos e revisão do editor do piloto (OpenBot, assinatura Codex)', stage: 'check_edit', kinds: ['fact_check', 'editorial_review'], desc: 'Checa e revisa o rascunho numa chamada, de autor distinto do redator, e devolve veredito, motivos e o modelo declarado. Não reescreve nem publica.' },
    { id: 'extractor_social', draft: 'ln_pilot_extractor', name: 'LN Piloto — Extrator e Social', title: 'Extração de entidades e texto social do piloto (OpenBot, assinatura Claude)', stage: 'extract_social', kinds: ['entity_extraction', 'social_copy'], desc: 'Extrai entidades como fato+fonte+link+data e escreve o texto de LinkedIn da matéria aprovada, como rascunho.' },
  ];
  return spec.map((s) => {
    const p = byId.get(s.id)!;
    return {
      draft_id: s.draft,
      name: s.name,
      title: s.title,
      account: p.account,
      stage: s.stage,
      description: `${s.desc} Executa só o prompt versionado ${p.promptVersion}.`,
      prompt_version: p.promptVersion,
      kinds_pulled: s.kinds,
      tool_contract: ['POST /api/openbot/pull', 'POST /api/openbot/heartbeat', 'POST /api/openbot/callback', 'leitura do pacote e do rascunho pela API autenticada do LN (por id)'],
      must_not: [...PILOT_MUST_NOT],
    };
  });
}

// --- planilha de medição -----------------------------------------------------------------------------------------------

export const PILOT_SHEET_COLUMNS = [
  'task_id', 'kind', 'article_id', 'source_id', 'stage', 'account', 'declared_model', 'prompt_version', 'started_at', 'ended_at', 'attempt',
  'reviewed_draft_task_id', 'outcome', 'limit_message', 'limit_at', 'account_resumed_at', 'gate_verdict', 'gate_reasons', 'cross_provider_ok', 'packet_chars',
  'tokens_measured', 'unsupported_facts', 'published_attempt', 'tarifada_api_call', 'secret_in_log', 'tool_outside_contract', 'notes',
] as const;

export interface PilotRow {
  task_id: string;
  kind: string;
  article_id: string;
  source_id: string;
  stage: PilotStage;
  account: PilotAccount;
  /** modelo declarado no UsageReport; null só em etapa determinística */
  declared_model: string | null;
  prompt_version: string | null;
  started_at: string;
  ended_at: string;
  attempt: number;
  /** só em `check_edit`: `task_id` do rascunho (revisão) que ESTA checagem recebeu; obrigatório, sem ele a independência não é provada */
  reviewed_draft_task_id?: string;
  /** pending_limit: a tarefa ficou pendente porque a assinatura bateu o limite (sem fallback no piloto) */
  outcome: 'completed' | 'failed' | 'retryable' | 'pending_limit';
  limit_message?: string;
  limit_at?: string;
  account_resumed_at?: string;
  gate_verdict?: 'approved' | 'blocked';
  gate_reasons?: string[];
  cross_provider_ok?: boolean;
  /** tamanho do pacote em caracteres: substituto de tokens (o OpenBot não expõe tokens) */
  packet_chars: number | null;
  /** sempre false: "não medido" */
  tokens_measured: false;
  /** fatos materiais sem evidência, apontados pela rubrica do Editorial nos rascunhos APROVADOS */
  unsupported_facts?: number;
  published_attempt: boolean;
  tarifada_api_call: boolean;
  secret_in_log: boolean;
  tool_outside_contract: boolean;
  notes?: string;
}

export function authorOfDeclaredModel(model: string | null): 'anthropic' | 'openai' | 'unknown' {
  if (!model) return 'unknown';
  const m = model.toLowerCase();
  if (m.startsWith('anthropic/') || m.startsWith('claude') || m.includes('claude')) return 'anthropic';
  if (m.startsWith('openai/') || m.startsWith('gpt') || m.includes('codex') || m.includes('gpt-')) return 'openai';
  return 'unknown';
}

/**
 * Motivos de gate que BLOQUEIAM (política: WF02 e prompt do checador). Um `gate_verdict: approved` com qualquer um deles é um
 * registro contraditório (linha inválida). `same_author` além disso reprova a independência mesmo com veredito `blocked`.
 */
export const BLOCKING_GATE_REASONS = [
  'same_author', 'unsupported_claim', 'copy_literal', 'rights_unknown', 'terms_unresolved', 'cross_provider_check_failed',
  'approval_missing', 'rights_basis_unresolved',
] as const;

const isoOk = (s: string) => !Number.isNaN(Date.parse(s));

export function validatePilotRow(r: PilotRow): string[] {
  const e: string[] = [];
  if (!r.task_id) e.push('task_id obrigatório');
  if (!isoOk(r.started_at) || !isoOk(r.ended_at)) e.push('datas ISO inválidas');
  else if (Date.parse(r.ended_at) < Date.parse(r.started_at)) e.push('ended_at antes de started_at');
  if (PILOT_STAGES[r.stage]?.account !== r.account) e.push(`etapa ${r.stage} deve rodar em ${PILOT_STAGES[r.stage]?.account}`);
  if (r.account !== 'deterministic' && !r.declared_model) e.push('modelo declarado no UsageReport obrigatório fora da etapa determinística');
  if (r.account !== 'deterministic' && !r.prompt_version) e.push('prompt_version obrigatório');
  if (r.tokens_measured !== false) e.push('tokens_measured deve ser false: o OpenBot não expõe tokens (registrar packet_chars e "não medido")');
  if (!Number.isInteger(r.attempt) || r.attempt < 1) e.push('attempt inteiro >= 1');
  if (r.outcome === 'pending_limit' && (!r.limit_message || !r.limit_at)) e.push('pending_limit exige limit_message e limit_at');
  if (r.stage === 'check_edit' && r.outcome === 'completed' && !r.gate_verdict) e.push('check_edit concluído exige gate_verdict');
  if (r.stage === 'check_edit' && r.outcome === 'completed' && !r.reviewed_draft_task_id) e.push('check_edit concluído exige reviewed_draft_task_id (a checagem precisa apontar a revisão que recebeu)');
  if (r.gate_verdict === 'approved') {
    const blocking = (r.gate_reasons ?? []).filter((x) => (BLOCKING_GATE_REASONS as readonly string[]).includes(x));
    if (blocking.length) e.push(`veredito approved com motivo bloqueante (${blocking.join(', ')}): registro contraditório`);
  }
  return e;
}

// --- avaliação dos critérios de saída -----------------------------------------------------------------------------------

export interface WindowStat {
  account: 'claude' | 'codex';
  from: string;
  to: string | null;
  completedTasks: number;
  articles: number;
  endedByLimit: boolean;
}

export interface Stat { n: number; p50: number; p95: number; max: number }
const stat = (v: number[]): Stat => {
  const s = [...v].sort((a, b) => a - b);
  const at = (p: number) => (s.length ? s[Math.min(s.length - 1, Math.max(0, Math.ceil(p * s.length) - 1))]! : 0);
  return { n: s.length, p50: at(0.5), p95: at(0.95), max: s.length ? s[s.length - 1]! : 0 };
};

export interface PilotEvaluation {
  invalidRows: { task_id: string; errors: string[] }[];
  /** parada imediata: qualquer item aqui para o piloto; cada item traz a posição (1-based) da linha que a causou */
  stop: string[];
  windows: WindowStat[];
  limitHits: { account: 'claude' | 'codex'; at: string; message: string; resumedAt: string | null }[];
  independence: { checked: number; ok: number; rate: number | null; failures: string[]; uncheckedFinalDrafts: string[] };
  latencyMsByStage: Partial<Record<PilotStage, Stat>>;
  retries: { tasksWithRetry: number; failed: number; pendingLimit: number };
  quality: { approvedWithEvaluation: number; approvedWithoutEvaluation: number; unsupportedFacts: number };
  exit: {
    /** `invalid`: há linha inválida; a amostra inteira deixa de valer */
    sample: 'valid' | 'invalid';
    windowsMeasured: 'measured' | 'repeat_with_30' | 'inconclusive';
    independence: 'pass' | 'fail' | 'inconclusive';
    quality: 'pass' | 'fail' | 'inconclusive';
    stopped: boolean;
    overall: 'pass' | 'fail' | 'inconclusive' | 'stopped' | 'invalid';
  };
}

/** Condições de PARADA IMEDIATA de UMA linha (avaliadas a cada linha gravada, não só no fim). */
export function stopReasonsOf(r: PilotRow): string[] {
  const out: string[] = [];
  if (r.published_attempt) out.push(`${r.task_id}: tentativa de publicar`);
  if (r.tarifada_api_call) out.push(`${r.task_id}: chamada à API tarifada`);
  if (r.secret_in_log) out.push(`${r.task_id}: segredo em log`);
  if (r.tool_outside_contract) out.push(`${r.task_id}: ferramenta fora do contrato`);
  return out;
}

export function evaluatePilot(rows: readonly PilotRow[]): PilotEvaluation {
  const invalidRows = rows.map((r) => ({ task_id: r.task_id, errors: validatePilotRow(r) })).filter((x) => x.errors.length);
  const stop: string[] = [];
  rows.forEach((r, idx) => stopReasonsOf(r).forEach((m) => stop.push(`linha ${idx + 1}: ${m}`)));

  // janelas por conta: abre na primeira atividade (ou na retomada) e fecha na tarefa que bateu o limite
  const windows: WindowStat[] = [];
  const limitHits: PilotEvaluation['limitHits'] = [];
  for (const account of ['claude', 'codex'] as const) {
    const mine = rows.filter((r) => r.account === account).sort((a, b) => Date.parse(a.started_at) - Date.parse(b.started_at));
    let cur: { from: string; tasks: number; articles: Set<string> } | null = null;
    for (const r of mine) {
      if (!cur) cur = { from: r.started_at, tasks: 0, articles: new Set() };
      if (r.outcome === 'completed') {
        cur.tasks += 1;
        cur.articles.add(r.article_id);
      }
      if (r.outcome === 'pending_limit') {
        windows.push({ account, from: cur.from, to: r.limit_at ?? r.ended_at, completedTasks: cur.tasks, articles: cur.articles.size, endedByLimit: true });
        limitHits.push({ account, at: r.limit_at ?? r.ended_at, message: r.limit_message ?? '', resumedAt: r.account_resumed_at ?? null });
        cur = null;
      }
    }
    if (cur) windows.push({ account, from: cur.from, to: null, completedTasks: cur.tasks, articles: cur.articles.size, endedByLimit: false });
  }

  // independência por PAR redator→checador da MESMA revisão: cada checagem aponta o rascunho que recebeu (sem sobrescrita)
  const completedDrafts = rows.filter((r) => r.stage === 'draft' && r.outcome === 'completed');
  const draftsByTask = new Map<string, PilotRow[]>();
  for (const d of completedDrafts) draftsByTask.set(d.task_id, [...(draftsByTask.get(d.task_id) ?? []), d]);
  let checked = 0;
  let ok = 0;
  const failures: string[] = [];
  const checkedDraftIds = new Set<string>();
  for (const r of rows.filter((x) => x.stage === 'check_edit' && x.outcome === 'completed')) {
    checked += 1;
    const label = `${r.article_id}/${r.task_id}`;
    const ref = r.reviewed_draft_task_id;
    const candidates = ref ? (draftsByTask.get(ref) ?? []) : [];
    if (!ref) {
      failures.push(`${label}: checagem sem reviewed_draft_task_id (vínculo ausente)`);
      continue;
    }
    if (candidates.length === 0) {
      failures.push(`${label}: rascunho ${ref} não existe ou não está concluído (vínculo ausente)`);
      continue;
    }
    if (candidates.length > 1) {
      failures.push(`${label}: rascunho ${ref} aparece ${candidates.length} vezes concluído (vínculo ambíguo)`);
      continue;
    }
    const d = candidates[0]!;
    if (d.article_id !== r.article_id) {
      failures.push(`${label}: rascunho ${ref} é da matéria ${d.article_id}`);
      continue;
    }
    if (Date.parse(d.ended_at) > Date.parse(r.started_at)) {
      failures.push(`${label}: a checagem começou antes de o rascunho ${ref} terminar`);
      continue;
    }
    checkedDraftIds.add(ref);
    const a = authorOfDeclaredModel(d.declared_model);
    const b = authorOfDeclaredModel(r.declared_model);
    const reasons = r.gate_reasons ?? [];
    if (reasons.includes('same_author')) {
      failures.push(`${label}: gate_reasons contém same_author (o checador relatou o mesmo autor do redator)`);
      continue;
    }
    if (a === 'unknown' || b === 'unknown' || a === b || r.cross_provider_ok === false) {
      failures.push(`${label}: redator ${d.declared_model ?? 'ausente'} x checador ${r.declared_model ?? 'ausente'}`);
      continue;
    }
    ok += 1;
  }
  // o rascunho FINAL de cada matéria (o mais recente concluído) precisa ter uma checagem vinculada a ele
  const uncheckedFinalDrafts: string[] = [];
  const byArticle = new Map<string, PilotRow[]>();
  for (const d of completedDrafts) byArticle.set(d.article_id, [...(byArticle.get(d.article_id) ?? []), d]);
  for (const [art, ds] of byArticle) {
    const last = [...ds].sort((x, y) => Date.parse(y.ended_at) - Date.parse(x.ended_at))[0]!;
    if (!checkedDraftIds.has(last.task_id)) uncheckedFinalDrafts.push(`${art}/${last.task_id}`);
  }

  const latencyMsByStage: PilotEvaluation['latencyMsByStage'] = {};
  for (const st of Object.keys(PILOT_STAGES) as PilotStage[]) {
    const v = rows.filter((r) => r.stage === st && r.outcome === 'completed').map((r) => Date.parse(r.ended_at) - Date.parse(r.started_at)).filter((x) => x >= 0);
    if (v.length) latencyMsByStage[st] = stat(v);
  }

  const approved = rows.filter((r) => r.stage === 'check_edit' && r.gate_verdict === 'approved' && !(r.gate_reasons ?? []).some((x) => (BLOCKING_GATE_REASONS as readonly string[]).includes(x)));
  const withEval = approved.filter((r) => r.unsupported_facts !== undefined);
  const unsupported = withEval.reduce((s, r) => s + (r.unsupported_facts ?? 0), 0);

  const sample: PilotEvaluation['exit']['sample'] = invalidRows.length ? 'invalid' : 'valid';
  const windowsMeasured: PilotEvaluation['exit']['windowsMeasured'] = rows.length === 0 ? 'inconclusive' : limitHits.length > 0 ? 'measured' : 'repeat_with_30';
  const independence: PilotEvaluation['exit']['independence'] = checked === 0 ? 'inconclusive' : failures.length > 0 ? 'fail' : uncheckedFinalDrafts.length > 0 ? 'inconclusive' : 'pass';
  const quality: PilotEvaluation['exit']['quality'] = approved.length === 0 || withEval.length < approved.length ? 'inconclusive' : unsupported === 0 ? 'pass' : 'fail';
  const stopped = stop.length > 0;
  const overall: PilotEvaluation['exit']['overall'] = stopped
    ? 'stopped'
    : sample === 'invalid'
      ? 'invalid'
      : independence === 'fail' || quality === 'fail'
        ? 'fail'
        : independence === 'pass' && quality === 'pass' && windowsMeasured !== 'inconclusive'
          ? 'pass'
          : 'inconclusive';

  return {
    invalidRows,
    stop,
    windows,
    limitHits,
    independence: { checked, ok, rate: checked ? ok / checked : null, failures, uncheckedFinalDrafts },
    latencyMsByStage,
    retries: { tasksWithRetry: rows.filter((r) => r.attempt > 1).length, failed: rows.filter((r) => r.outcome === 'failed').length, pendingLimit: rows.filter((r) => r.outcome === 'pending_limit').length },
    quality: { approvedWithEvaluation: withEval.length, approvedWithoutEvaluation: approved.length - withEval.length, unsupportedFacts: unsupported },
    exit: { sample, windowsMeasured, independence, quality, stopped, overall },
  };
}

/**
 * PORTÃO DE DESPACHO: o operador/despachante só envia a próxima tarefa se isto permitir. Avalia as linhas já gravadas:
 * parada imediata (publicar, API tarifada, segredo em log, ferramenta fora do contrato) e linha inválida bloqueiam o despacho.
 */
export function canDispatchNext(rows: readonly PilotRow[]): { allowed: boolean; reasons: string[] } {
  const reasons: string[] = [];
  rows.forEach((r, idx) => stopReasonsOf(r).forEach((m) => reasons.push(`PARADA IMEDIATA, linha ${idx + 1}: ${m}`)));
  rows.forEach((r, idx) => {
    const errs = validatePilotRow(r);
    if (errs.length) reasons.push(`linha ${idx + 1} inválida (${r.task_id}): ${errs.join('; ')}`);
  });
  return { allowed: reasons.length === 0, reasons };
}

/**
 * Sessão do piloto: grave CADA linha logo que o callback chega. A parada é avaliada a cada linha; depois de uma parada ou de
 * uma linha inválida a sessão recusa novas linhas e `canDispatch()` passa a falso até o operador tratar o problema.
 */
export class PilotSession {
  private readonly rows: PilotRow[] = [];
  private blocked: string[] = [];

  /** Devolve se a linha foi aceita; uma linha que dispara a parada É guardada (evidência), mas fecha a sessão. */
  append(row: PilotRow): { accepted: boolean; stopped: boolean; reasons: string[] } {
    if (this.blocked.length) return { accepted: false, stopped: true, reasons: [`sessão bloqueada: ${this.blocked.join(' | ')}`] };
    this.rows.push(structuredClone(row));
    const gate = canDispatchNext(this.rows);
    if (!gate.allowed) this.blocked = gate.reasons;
    return { accepted: true, stopped: !gate.allowed, reasons: gate.reasons };
  }

  canDispatch(): boolean {
    return this.blocked.length === 0;
  }

  blockedBecause(): readonly string[] {
    return this.blocked;
  }

  evaluate(): PilotEvaluation {
    return evaluatePilot(this.rows);
  }

  get size(): number {
    return this.rows.length;
  }
}

export function sheetCsvHeader(): string {
  return `${PILOT_SHEET_COLUMNS.join(',')}\n`;
}
