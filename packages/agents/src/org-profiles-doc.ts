/** Artefatos dos 64 perfis da organização completa (rascunho, política v7). Não exportado por `index.ts`. */
import type { LoadedRegistries } from './config';
import { buildOrgProfiles, validateOrgProfiles, type OrgProfileDraft } from './org-profiles';

export interface OrgProfileArtifacts {
  'organization-profiles.draft.json': string;
  'organization-profiles.md': string;
}

const cell = (s: string) => s.replace(/\|/g, '/').replace(/\n/g, ' ');

export function buildOrgProfileArtifacts(registries: Pick<LoadedRegistries, 'agents' | 'meetings' | 'workflows'>): OrgProfileArtifacts {
  const draft = buildOrgProfiles(registries);
  const bad = validateOrgProfiles(draft, registries);
  if (bad.length) throw new Error(`perfis da organização inválidos: ${bad.map((i) => i.code).join(', ')}`);
  const acct = (p: OrgProfileDraft) => (p.execution.account ? `${p.execution.account} (${p.execution.provider})` : p.execution.channel === 'deterministic' ? 'determinístico' : 'sem canal');
  const comp = (p: OrgProfileDraft) => (p.complement_api ? `${p.complement_api.route}: ${p.complement_api.models.join(', ')}${p.complement_api.alternative_model_allowed ? '' : ' (sem alternativo)'}` : '—');
  const byDept = new Map<string, OrgProfileDraft[]>();
  for (const p of draft.profiles) byDept.set(p.department, [...(byDept.get(p.department) ?? []), p]);
  const sections = [...byDept.entries()].flatMap(([dept, ps]) => [
    `### ${dept} (${ps.length} perfis; hospedados por \`${ps[0]!.hosted_by}\`)`,
    '',
    '| Perfil | Reporta a | Tarefa | Conta principal | Complemento pela API (desligado) | Presidência / workflows | Bloqueios |',
    '|---|---|---|---|---|---|---|',
    ...ps.map((p) => `| \`${p.id}\`${p.scope !== 'internal' ? ` (${p.scope})` : ''} | ${p.reports_to ?? '—'} | ${p.task_kind} | ${acct(p)} | ${comp(p)} | ${[...p.chairs_rituals.map((r) => `preside ${r}`), ...p.owns_workflows.map((w) => `dono ${w}`)].join('; ') || '—'} | ${cell(p.blocked_until.join(' / ') || '—')} |`),
    '',
  ]);
  const md = [
    '# Organização completa: perfis dos 64 agentes (rascunho, política v7)',
    '',
    '> GERADO por `packages/agents/src/org-profiles-doc.ts`; não editar. **Nada foi criado no OpenBot e nenhum modelo foi chamado.** Revisão: QA 3. Criar agentes só com OK do PM.',
    '',
    `Política: \`${draft.policy.version}\` (${draft.policy.file}; sha256 \`${draft.policy.sha256}\`; ${draft.policy.status}).`,
    '',
    '## 1. Resumo',
    '',
    `- ${draft.counts.profiles} perfis, todos \`enabled=false\`: ${draft.counts.claude} na conta Claude, ${draft.counts.codex} na conta Codex, ${draft.counts.deterministic} determinísticos (sem modelo), ${draft.counts.no_model_available} sem canal (imagem), ${draft.counts.with_blockers} com bloqueio de dado.`,
    '- Canal primário de todos: assinatura pelo adaptador OpenBot (ADR-003), fora do teto (DP-27). **Claude** para redação, entidades, social, rituais, dailies e análises; **Codex** só para checagem, revisão editorial e auditoria pós-publicação (OpenAI só na rota de revisão; autor distinto do redator).',
    '- Backup: no limite da assinatura a tarefa volta a `pending` e espera a janela. O complemento pela API tarifada (rotas da v7: economy = claude-haiku-5-5, review = claude-sonnet-5-5 ou openai-text-review, premium e strategic = claude-opus-5-5) existe só dentro do teto de US$ 50, na ordem de corte da ADR-015 (degraus 35/40/42), e está **desligado** no piloto (DP-41). A redação não tem modelo alternativo (DP-26 b).',
    '- Nunca: publicar sem checagem por provedor distinto do redator; DeepSeek; Fable em trabalho não publicado; checagem por amostragem.',
    '- Este rascunho **não inclui** Gemini (Antigravity) nem OpenCode: eles são backups do PILOTO (decisão do PM, 23/11) e não constam da v7 nem da DP-41.',
    '- A hipótese de 8 agentes OpenBot (um por diretoria mais o Publisher) vem de `openbot-profiles.draft.json`; cada execução carrega um perfil sob demanda (ADR-004).',
    '',
    '## 2. Perfis por diretoria',
    '',
    ...sections,
    '## 3. Decisões em aberto',
    '',
    ...draft.open_decisions.map((d, i) => `${i + 1}. ${d}`),
    '',
    '## 4. Não verificado',
    '',
    ...draft.not_verified.map((d) => `- ${d}`),
    '',
  ].join('\n');
  return {
    'organization-profiles.draft.json': `${JSON.stringify(draft, null, 2)}\n`,
    'organization-profiles.md': md,
  };
}
