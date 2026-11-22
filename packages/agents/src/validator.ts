/**
 * Validador da organização agêntica: contagens (64/7/10/19/28) e referências cruzadas.
 * Falha fechado: qualquer `error` torna `ok=false`.
 */
import { POLICY_ROUTES, type LoadedRegistries } from './config';
import { buildOrganization, parseSteps, workflowAgents, type Organization } from './organization';
import { DIRECTORATES, EDITORIAS } from './schemas';

export const EXPECTED = {
  agents: 64,
  directorates: 7,
  newsrooms: 10,
  workflows: 19,
  meetings: 28,
  dailies: 18,
  weeklies: 6,
  monthlies: 3,
  events: 1,
} as const;

export interface Issue {
  severity: 'error' | 'warning';
  code: string;
  message: string;
}

export interface ValidationReport {
  ok: boolean;
  counts: Record<string, number>;
  issues: Issue[];
}

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const WEEKDAY_RE = /^(MON|TUE|WED|THU|FRI) ([01]\d|2[0-3]):[0-5]\d$/;
const FIRST_BD_RE = /^FIRST_BUSINESS_DAY ([01]\d|2[0-3]):[0-5]\d$/;

export function validateOrganization(org: Organization): ValidationReport {
  const issues: Issue[] = [];
  const err = (code: string, message: string) => issues.push({ severity: 'error', code, message });
  const warn = (code: string, message: string) => issues.push({ severity: 'warning', code, message });
  const { agents, workflows, meetings, recoveryPolicy } = org.registries;

  const counts = {
    agents: agents.length,
    directorates: org.directorates.length,
    newsrooms: org.newsrooms.length,
    workflows: workflows.length,
    meetings: meetings.length,
    dailies: meetings.filter((m) => m.cycle === 'weekday').length,
    weeklies: meetings.filter((m) => m.cycle === 'weekly').length,
    monthlies: meetings.filter((m) => m.cycle === 'monthly').length,
    events: meetings.filter((m) => m.cycle === 'event').length,
  };
  for (const [k, expected] of Object.entries(EXPECTED)) {
    const got = counts[k as keyof typeof counts];
    if (got !== expected) err('COUNT', `${k}: esperado ${expected}, encontrado ${got}`);
  }

  // --- perfis ---------------------------------------------------------------------------------
  const ids = agents.map((a) => a.id);
  const idSet = new Set(ids);
  if (idSet.size !== ids.length) {
    const dup = ids.filter((id, i) => ids.indexOf(id) !== i);
    err('AGENT_DUP', `ids de perfil duplicados: ${[...new Set(dup)].join(', ')}`);
  }
  const directorateNames = new Set<string>([...DIRECTORATES, 'executivo']);
  for (const a of agents) {
    if (directorateNames.has(a.id)) err('AGENT_ID_IS_DIRECTORATE', `perfil ${a.id} tem id igual a nome de diretoria`);
    if (a.output_contract.properties.agent_id.const !== a.id)
      err('CONTRACT_AGENT_ID', `${a.id}: output_contract.agent_id.const = ${a.output_contract.properties.agent_id.const}`);
    if (a.output_contract.properties.artifact_type.const !== `${a.id}.result`)
      err('CONTRACT_ARTIFACT', `${a.id}: artifact_type deveria ser ${a.id}.result`);
    const resultProps = Object.keys(a.output_contract.properties.result.properties).sort();
    const required = [...a.required_result_fields].sort();
    const contractRequired = [...a.output_contract.properties.result.required].sort();
    if (JSON.stringify(resultProps) !== JSON.stringify(required) || JSON.stringify(contractRequired) !== JSON.stringify(required))
      err('CONTRACT_RESULT_FIELDS', `${a.id}: required_result_fields diverge do output_contract.result`);
    if (new Set(a.allowed_tools).size !== a.allowed_tools.length) err('TOOLS_DUP', `${a.id}: allowed_tools repetido`);
    if (a.reports_to !== null && !idSet.has(a.reports_to)) err('REPORTS_TO', `${a.id} reporta a ${a.reports_to}, inexistente`);
    if (a.reports_to === a.id) err('REPORTS_TO', `${a.id} reporta a si mesmo`);
    if (!POLICY_ROUTES.includes(a.default_route_hint)) err('ROUTE', `${a.id}: rota ${a.default_route_hint} fora de model.policy`);
    if (a.enabled) err('AGENT_ENABLED', `${a.id}: enabled=true; todos os perfis nascem desligados até o gate R4`);
  }
  // output_contract "próprio": nenhum par de perfis com contrato idêntico
  const contractKeys = new Set(agents.map((a) => JSON.stringify(a.output_contract)));
  if (contractKeys.size !== agents.length) err('CONTRACT_NOT_UNIQUE', 'há perfis com output_contract idêntico');

  // hierarquia: 1 raiz (publisher), sem ciclos, diretores reportam ao publisher
  const roots = agents.filter((a) => a.reports_to === null);
  if (roots.length !== 1 || roots[0]?.id !== 'publisher') err('HIERARCHY_ROOT', `raiz esperada: publisher; encontrado: ${roots.map((r) => r.id).join(',') || 'nenhuma'}`);
  const byId = new Map(agents.map((a) => [a.id, a]));
  for (const a of agents) {
    const seen = new Set<string>();
    let cur: string | null = a.id;
    while (cur) {
      if (seen.has(cur)) {
        err('HIERARCHY_CYCLE', `ciclo de reports_to a partir de ${a.id}`);
        break;
      }
      seen.add(cur);
      cur = byId.get(cur)?.reports_to ?? null;
    }
  }

  // --- diretorias -------------------------------------------------------------------------------
  const sumMembers = org.directorates.reduce((n, d) => n + d.members.length, 0);
  if (sumMembers + 1 !== agents.length) err('DIRECTORATE_MEMBERS', `membros das diretorias (${sumMembers}) + publisher != ${agents.length}`);
  for (const d of org.directorates) {
    const dir = byId.get(d.director);
    if (!dir) err('DIRECTORATE_DIRECTOR', `${d.id}: diretor ${d.director} inexistente`);
    else {
      if (dir.department !== d.department) err('DIRECTORATE_DIRECTOR', `${d.director} não pertence ao departamento ${d.department}`);
      if (dir.reports_to !== 'publisher') err('DIRECTORATE_DIRECTOR', `${d.director} deve reportar ao publisher`);
    }
    if (!d.members.includes(d.director)) err('DIRECTORATE_DIRECTOR', `${d.id}: diretor ausente da lista de membros`);
    for (const key of ['daily_meeting', 'weekly_meeting'] as const) {
      const mid = d[key];
      if (mid) {
        const m = meetings.find((x) => x.id === mid);
        if (!m) err('DIRECTORATE_MEETING', `${d.id}: ritual ${mid} inexistente`);
        else if (m.chair !== d.director) err('DIRECTORATE_MEETING', `${mid} deveria ser presidido por ${d.director}`);
      }
    }
  }

  // --- redações ---------------------------------------------------------------------------------
  const wfIds = new Set(workflows.map((w) => w.id));
  for (const ed of EDITORIAS) {
    const n = org.newsrooms.find((x) => x.editoria === ed);
    if (!n) {
      err('NEWSROOM_MISSING', `redação ${ed} ausente`);
      continue;
    }
    const editor = byId.get(n.editor);
    const writer = byId.get(n.writer);
    if (!editor || editor.scope !== ed || editor.department !== 'editorial') err('NEWSROOM_EDITOR', `${ed}: editor ${n.editor} inválido ou com escopo diferente`);
    if (!writer || writer.scope !== ed || writer.department !== 'editorial') err('NEWSROOM_WRITER', `${ed}: redator ${n.writer} inválido ou com escopo diferente`);
    if (writer && writer.reports_to !== n.editor) err('NEWSROOM_WRITER', `${ed}: redator não reporta ao editor da redação`);
    if (editor && editor.reports_to !== n.director) err('NEWSROOM_EDITOR', `${ed}: editor não reporta a ${n.director}`);
    const daily = meetings.find((m) => m.id === n.daily_meeting);
    if (daily && !daily.title.includes(n.name)) warn('NEWSROOM_NAME', `${ed}: título do daily "${daily.title}" não contém o nome da editoria "${n.name}" (@ln/contracts)`);
    if (!daily || daily.chair !== n.editor || !daily.participants.includes(n.writer)) err('NEWSROOM_DAILY', `${ed}: daily ${n.daily_meeting} deve ser presidido pelo editor e incluir o redator`);
    for (const i of n.interactions) {
      if (!(DIRECTORATES as readonly string[]).includes(i.directorate)) err('INTERACTION', `${ed}: diretoria ${i.directorate} inexistente`);
      const dir = org.directorates.find((d) => d.id === i.directorate);
      const cited = new Set<string>();
      for (const w of i.workflows) {
        const wf = workflows.find((x) => x.id === w);
        if (!wf) err('INTERACTION', `${ed}/${i.directorate}: workflow ${w} inexistente`);
        else workflowAgents(wf, idSet).forEach((a) => cited.add(a));
      }
      for (const a of i.agents) {
        if (!idSet.has(a)) err('INTERACTION', `${ed}/${i.directorate}: agente ${a} inexistente`);
        else if (dir && !dir.members.includes(a)) err('INTERACTION', `${ed}/${i.directorate}: ${a} não pertence à diretoria`);
        if (!cited.has(a)) err('INTERACTION', `${ed}/${i.directorate}: ${a} não aparece em nenhum dos workflows ${i.workflows.join(',')}`);
      }
    }
  }
  // cada editoria tem memória setorial distinta
  if (new Set(org.newsrooms.map((n) => n.memory_scope)).size !== org.newsrooms.length) err('MEMORY_SCOPE', 'memory_scope repetido entre redações');

  // --- workflows --------------------------------------------------------------------------------
  if (wfIds.size !== workflows.length) err('WORKFLOW_DUP', 'ids de workflow duplicados');
  for (let i = 1; i <= EXPECTED.workflows; i++) {
    const id = `WF${String(i).padStart(2, '0')}`;
    if (!wfIds.has(id)) err('WORKFLOW_SEQ', `workflow ${id} ausente na sequência`);
  }
  for (const w of workflows) {
    if (!idSet.has(w.owner)) err('WORKFLOW_OWNER', `${w.id}: dono ${w.owner} inexistente`);
    for (const ref of parseSteps(w.steps, idSet)) if (ref.kind === 'unknown') err('WORKFLOW_STEP', `${w.id}: passo desconhecido "${ref.token}"`);
    if (w.enabled) err('WORKFLOW_ENABLED', `${w.id}: enabled=true; workflows nascem desligados até o gate R4`);
    if (w.instagram_enabled || w.channel_enabled) err('CHANNEL_FLAG', `${w.id}: canal Instagram/The Loyal deve estar desligado`);
  }

  // --- rituais ----------------------------------------------------------------------------------
  const mids = meetings.map((m) => m.id);
  const midSet = new Set(mids);
  if (midSet.size !== mids.length) err('MEETING_DUP', 'ids de ritual duplicados');
  for (const m of meetings) {
    if (!idSet.has(m.chair)) err('MEETING_CHAIR', `${m.id}: presidente ${m.chair} inexistente`);
    if (!m.participants.includes(m.chair)) err('MEETING_CHAIR', `${m.id}: presidente fora da lista de participantes`);
    if (new Set(m.participants).size !== m.participants.length) err('MEETING_PARTICIPANTS', `${m.id}: participante repetido`);
    for (const p of m.participants) if (!idSet.has(p)) err('MEETING_PARTICIPANTS', `${m.id}: participante ${p} inexistente`);
    if (m.quorum.minimum > m.participants.length) err('MEETING_QUORUM', `${m.id}: quórum ${m.quorum.minimum} > ${m.participants.length} participantes`);
    if (!POLICY_ROUTES.includes(m.route)) err('ROUTE', `${m.id}: rota ${m.route} fora de model.policy`);
    if (m.workflow && !wfIds.has(m.workflow)) err('MEETING_WORKFLOW', `${m.id}: workflow ${m.workflow} inexistente`);
    for (const d of m.depends_on ?? []) if (!midSet.has(d)) err('MEETING_DEPENDS', `${m.id}: depende de ${d}, inexistente`);
    if (m.depends_on?.includes(m.id)) err('MEETING_DEPENDS', `${m.id}: depende de si mesmo`);
    if (m.enabled) err('MEETING_ENABLED', `${m.id}: enabled=true; rituais nascem desligados até o gate R4`);
    const okSchedule =
      m.cycle === 'weekday' ? TIME_RE.test(m.schedule_local)
      : m.cycle === 'weekly' ? WEEKDAY_RE.test(m.schedule_local)
      : m.cycle === 'monthly' ? FIRST_BD_RE.test(m.schedule_local)
      : m.schedule_local.length > 0;
    if (!okSchedule) err('MEETING_SCHEDULE', `${m.id}: schedule_local "${m.schedule_local}" inválido para ciclo ${m.cycle}`);
    const prefix = { weekday: 'D-', weekly: 'W-', monthly: 'M-', event: 'X-' }[m.cycle];
    if (!m.id.startsWith(prefix)) err('MEETING_ID', `${m.id}: prefixo incompatível com o ciclo ${m.cycle}`);
  }
  // dependências ficam em ordem e sem ciclos
  for (const m of meetings) {
    for (const d of m.depends_on ?? []) {
      const dep = meetings.find((x) => x.id === d);
      if (dep && dep.cycle === m.cycle && m.cycle === 'weekday' && dep.schedule_local >= m.schedule_local)
        err('MEETING_DEPENDS_ORDER', `${m.id} (${m.schedule_local}) depende de ${d} (${dep.schedule_local}) que roda depois ou junto`);
    }
  }
  // D-sync do recovery_policy espelha o depends_on do registro
  const sync = meetings.find((m) => m.id === 'D-sync');
  const policyDeps = [...recoveryPolicy.dependencies['D-sync']].sort().join(',');
  const syncDeps = [...(sync?.depends_on ?? [])].sort().join(',');
  if (policyDeps !== syncDeps) err('RECOVERY_DEPENDS', `recovery_policy.dependencies[D-sync] (${policyDeps}) != depends_on do D-sync (${syncDeps})`);
  if (recoveryPolicy.window_minutes !== 120 || !recoveryPolicy.window_inclusive) err('RECOVERY_WINDOW', 'janela de recuperação deve ser 120 min inclusive (DP-11/P5)');
  // todo perfil é participante de algum ritual (ninguém fica sem ritual) — aviso
  const inMeeting = new Set(meetings.flatMap((m) => m.participants));
  for (const a of agents) if (!inMeeting.has(a.id)) warn('AGENT_NO_MEETING', `${a.id} não participa de nenhum ritual`);

  return { ok: !issues.some((i) => i.severity === 'error'), counts, issues };
}

export function validateRegistries(reg: LoadedRegistries): ValidationReport {
  return validateOrganization(buildOrganization(reg));
}
