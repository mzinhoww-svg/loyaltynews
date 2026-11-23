/**
 * RASCUNHO dos perfis dos agentes OpenBot que executariam a organização (7 diretorias + Publisher).
 * NADA É CRIADO: é uma proposta para aval do Program Manager (ADR-003/ADR-004: o OpenBot executa e
 * coordena; os 64 perfis do registro são contratos carregados sob demanda, não processos residentes).
 * Gerado dos registros; o validador abaixo garante cobertura e as restrições de segurança.
 */
import type { LoadedRegistries } from './config';
import { DIRECTORATES, type AgentProfile, type Department } from './schemas';

const ROUTE_ORDER = ['deterministic', 'economy', 'review', 'premium', 'strategic'] as const;

export interface OpenBotAgentDraft {
  /** identificador proposto; NÃO é um id de agente OpenBot existente */
  draft_id: string;
  name: string;
  title: string;
  description: string;
  department: Department;
  hosted_profiles: string[];
  chairs_rituals: string[];
  participates_in_rituals: string[];
  owns_workflows: string[];
  /** ferramentas dos perfis hospedados (união); são verbos da API do LN, não ferramentas do OpenBot */
  tool_verbs: string[];
  /** rota mais alta pedida pelos perfis hospedados; a escolha do modelo é do gateway, não do agente */
  highest_route_hint: (typeof ROUTE_ORDER)[number];
  must_not: string[];
  data_and_credentials: string[];
  escalation: string[];
  first_needed_in_phase: string;
  requires_gates: string[];
}

export interface OpenBotDraft {
  schema: 'ln.agents.openbot-profiles-draft/1';
  status: 'RASCUNHO';
  /** sempre false: nenhum agente foi criado no OpenBot */
  created: false;
  approval_required_from: 'Program Manager';
  basis: string[];
  hypothesis: string;
  /** Decisões já tomadas pelo Program Manager (registradas aqui para rastreio). */
  pm_decisions: { date: string; decision: string }[];
  /**
   * Critérios para dividir a Diretoria Editorial em mais de um agente. Só valem com medição REAL de R4
   * (30+ execuções). Limiares = proposta da Frente 07, a ratificar pelo PM.
   */
  editorial_split_criteria: { id: string; metric: string; threshold: string; proposed: true }[];
  open_decisions: string[];
  agents: OpenBotAgentDraft[];
}

const DEPT_TITLES: Record<Department, string> = {
  executivo: 'Publisher / CEO',
  editorial: 'Diretoria Editorial',
  creative: 'Diretoria Creative',
  growth: 'Diretoria Growth',
  intelligence: 'Diretoria Intelligence',
  commercial: 'Diretoria Commercial',
  technology: 'Diretoria Technology',
  trust: 'Diretoria Trust & Quality',
};

const FIRST_PHASE: Record<Department, string> = {
  editorial: 'F2', intelligence: 'F3', creative: 'F3', growth: 'F3', trust: 'F4', executivo: 'F4', technology: 'F5', commercial: 'F5',
};

const MUST_NOT = [
  'chamar provedor de modelo diretamente: toda chamada de modelo sai pelo gateway do LN (ADR-003, política v5: acesso medido só via OpenRouter)',
  'usar assinatura do OpenBot para chamada de modelo do produto',
  'publicar matéria, post, newsletter ou e-mail; publicar é do serviço de publicação com escopo, nunca do agente',
  'guardar credencial de provedor, de mLabs ou de publicação (o agente recebe apenas o que o disparo traz)',
  'aprovar a própria entrega, marcar tarefa como aceita ou editar arquivos protegidos',
  'criar agentes, rotinas ou agendamentos próprios; o agendador é o do LN (flag rituais)',
  'manter memória de trabalho fora do PostgreSQL (memória setorial por editoria/matéria)',
  'abrir porta de entrada: o adaptador funciona por pull com lease, só conexão de saída',
];

export function buildOpenBotDraft(registries: Pick<LoadedRegistries, 'agents' | 'meetings' | 'workflows'>): OpenBotDraft {
  const depts: Department[] = ['executivo', ...DIRECTORATES];
  const agents: OpenBotAgentDraft[] = depts.map((dept) => {
    const hosted = registries.agents.filter((a: AgentProfile) => a.department === dept);
    const ids = hosted.map((a) => a.id);
    const idSet = new Set(ids);
    const highest = hosted.reduce<number>((m, a) => Math.max(m, ROUTE_ORDER.indexOf(a.default_route_hint as (typeof ROUTE_ORDER)[number])), 0);
    const tools = [...new Set(hosted.flatMap((a) => a.allowed_tools))].sort();
    const label = DEPT_TITLES[dept];
    const newsrooms = dept === 'editorial' ? ' Inclui os 10 pares editor/redator das redações (a configuração de editoria vem da memória setorial no PostgreSQL).' : '';
    return {
      draft_id: `ln_${dept}`,
      name: dept === 'executivo' ? 'LN Publisher' : `LN ${label}`,
      title: `${label} — executor de perfis sob demanda (Loyalty News)`,
      description: `Executa, por disparo do adaptador do LN (pull com lease) e sem processo residente, os ${ids.length} perfil(is) de ${label}: ${ids.join(', ')}.${newsrooms} Cada execução carrega um perfil, o contrato de saída e o contexto pedido; devolve resultado estruturado validado contra o contrato do perfil. Chama modelos só pelo gateway do LN, sem chave de provedor. Não publica, não aprova a si mesmo, não cria agentes nem rotinas.`,
      department: dept,
      hosted_profiles: ids,
      chairs_rituals: registries.meetings.filter((m) => idSet.has(m.chair)).map((m) => m.id),
      participates_in_rituals: registries.meetings.filter((m) => m.participants.some((p) => idSet.has(p))).map((m) => m.id),
      owns_workflows: registries.workflows.filter((w) => idSet.has(w.owner)).map((w) => w.id),
      tool_verbs: tools,
      highest_route_hint: ROUTE_ORDER[highest]!,
      must_not: [...MUST_NOT],
      data_and_credentials: [
        'entrada: somente o pacote do disparo (evidências e memória setorial por referência); sem acesso direto à internet',
        'saída: JSON do contrato do perfil, com evidence_refs; callback assinado e idempotente',
        'execute_scoped (perfis que o têm) = pedir ao serviço com escopo; o agente não porta a credencial',
        'dados classificados acima de public não saem para o OpenRouter (classe do dado vale a mais restritiva entre as entradas)',
      ],
      escalation: [
        'bloqueio (blockers do contrato de saída) sobe ao presidente do ritual; decisão protegida vai ao verificador independente (pending_verifier)',
        'ato reservado ao responsável (legal/contratual) fica pending_human',
        'falha incerta de chamada: reserva pendente, sem fallback automático (modelops)',
      ],
      first_needed_in_phase: FIRST_PHASE[dept],
      requires_gates: ['G1', 'G2', 'G3', 'G4', 'G5', 'G6'],
    };
  });
  return {
    schema: 'ln.agents.openbot-profiles-draft/1',
    status: 'RASCUNHO',
    created: false,
    approval_required_from: 'Program Manager',
    basis: ['ADR-003 (OpenBot executa e coordena; pull com lease; gateway)', 'ADR-004 (64 perfis = contratos sob demanda, memória no PostgreSQL)', 'model.policy v5 (acesso medido só via OpenRouter; OpenBot sem assinatura para chamada de modelo do produto)'],
    hypothesis: 'Um agente OpenBot por diretoria mais o Publisher (8) é hipótese inicial; o tamanho ideal do conjunto não foi medido (ADR-004, "Não verificado") e deve ser medido em R4.',
    pm_decisions: [
      { date: '2026-11-23', decision: 'Nomes e títulos dos 8 perfis aprovados COMO PROPOSTA (nada criado; a criação exige G1–G6 e aval explícito do PM).' },
      { date: '2026-11-23', decision: 'A Diretoria Editorial (24 perfis) fica em 1 agente até a medição real de R4 (menos custo e coordenação); só divide se a medição ultrapassar um dos critérios abaixo.' },
    ],
    editorial_split_criteria: [
      { id: 'S1', metric: 'p95 do total de entrada por chamada (sem cache + cache) nas chamadas dos perfis editoriais, em 30+ execuções medidas', threshold: '> 50% da janela de contexto do menor modelo elegível da rota (a janela não consta da política: verificar em G2)', proposed: true },
      { id: 'S2', metric: 'p95 do tempo do D-editorial, do primeiro disparo à ata, em 30+ execuções medidas', threshold: '> 30 min (o D-editorial é às 06:20 e o D-sync às 07:25 depende dele)', proposed: true },
      { id: 'S3', metric: 'p95 da espera do agente editorial pelo lease, com os 10 dailies de redação (06:00) e o D-editorial (06:20) concorrendo', threshold: '> 5 min', proposed: true },
    ],
    open_decisions: [
      'Se o Publisher e a Diretoria Technology (finops, sre, security) devem ser agentes separados do executor de implantação, por separação de funções (teste de identidade do executor no mesmo host, ADR-003).',
      'Nome e título definitivos no OpenBot só são fixados na criação (aprovados agora como proposta).',
    ],
    agents,
  };
}

export interface DraftIssue {
  code: string;
  message: string;
}

/** Cobertura exata e restrições do rascunho (falha fechada). */
export function validateOpenBotDraft(draft: OpenBotDraft, registries: Pick<LoadedRegistries, 'agents' | 'meetings' | 'workflows'>): DraftIssue[] {
  const issues: DraftIssue[] = [];
  const add = (code: string, message: string) => issues.push({ code, message });
  if (draft.created !== false) add('CREATED', 'o rascunho não pode afirmar criação de agente');
  if (draft.status !== 'RASCUNHO') add('STATUS', 'status deve ser RASCUNHO');
  if (draft.agents.length !== 8) add('COUNT', `esperados 8 agentes (7 diretorias + Publisher), encontrados ${draft.agents.length}`);
  const hosted = draft.agents.flatMap((a) => a.hosted_profiles);
  const counts = new Map<string, number>();
  for (const id of hosted) counts.set(id, (counts.get(id) ?? 0) + 1);
  for (const p of registries.agents) {
    const n = counts.get(p.id) ?? 0;
    if (n !== 1) add('COVERAGE', `perfil ${p.id} hospedado ${n} vez(es); deve ser exatamente 1`);
  }
  for (const id of counts.keys()) if (!registries.agents.some((p) => p.id === id)) add('UNKNOWN_PROFILE', `perfil inexistente: ${id}`);
  for (const m of registries.meetings) {
    const chairs = draft.agents.filter((a) => a.chairs_rituals.includes(m.id));
    if (chairs.length !== 1) add('CHAIR', `ritual ${m.id} presidido por ${chairs.length} agente(s); deve ser 1`);
  }
  for (const w of registries.workflows) {
    if (draft.agents.filter((a) => a.owns_workflows.includes(w.id)).length !== 1) add('WORKFLOW_OWNER', `workflow ${w.id} sem dono único entre os agentes`);
  }
  const names = draft.agents.map((a) => a.name);
  if (new Set(names).size !== names.length) add('NAMES', 'nomes de agente repetidos');
  for (const a of draft.agents) {
    // padrões de segredo reais (não palavras como "credencial", que aparecem nas restrições)
    if (/sk-[A-Za-z0-9]{10,}|Bearer\s+[A-Za-z0-9._-]{10,}|(api[_-]?key|password|secret)\s*[:=]\s*\S+/i.test(JSON.stringify(a))) add('SECRET_LIKE', `${a.draft_id}: texto com aparência de segredo`);
    for (const must of ['gateway do LN', 'publicar', 'criar agentes']) {
      if (!a.must_not.some((m) => m.includes(must))) add('MISSING_RESTRICTION', `${a.draft_id}: restrição ausente (${must})`);
    }
    if (a.must_not.length === 0 || a.requires_gates.length === 0) add('EMPTY', `${a.draft_id}: restrições/gates vazios`);
  }
  return issues;
}
