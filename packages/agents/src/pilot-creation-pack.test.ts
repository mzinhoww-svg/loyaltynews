import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { generateArtifacts } from './artifacts';
import { buildPilotAgents, PILOT_STAGES } from './pilot';
import { AGENT_BINDINGS, AGENT_ROUTES, buildCreationPack, initialMessage, PROCEDURE_TEMPLATE, renderCreationPackMd, validateCreationPack, type CreationPack } from './pilot-creation-pack';

const pack = buildCreationPack();
const codes = (p: CreationPack) => validateCreationPack(p).map((i) => i.code);
const by = (p: CreationPack, id: string) => p.agents.find((a) => a.draft_id === id)!;

describe('pacote de criação dos 5 agentes do piloto (nada é criado)', () => {
  it('são 5 agentes, nada criado, o validador não acha problema e o texto diz NADA CRIADO', () => {
    expect(pack.created).toBe(false);
    expect(pack.status).toBe('RASCUNHO');
    expect(pack.agents).toHaveLength(5);
    expect(validateCreationPack(pack)).toEqual([]);
    expect(renderCreationPackMd(pack)).toMatch(/NADA CRIADO/);
    // os artefatos do pacote entram no gerador de artefatos (a deriva é pega pelo artifacts.test.ts, que confere cada arquivo)
    expect(Object.keys(generateArtifacts())).toEqual(expect.arrayContaining(['pilot-creation-pack.md', 'pilot-creation-pack.json']));
    expect(renderCreationPackMd(pack)).toMatch(/Nenhum agente foi criado e nenhum modelo foi chamado/);
    for (const a of pack.agents) expect(renderCreationPackMd(pack)).toContain(a.openbot.name);
  });

  it('conta e modelo por agente: pauta Haiku (backup Sonnet, mesma conta); redação Claude; checagem e revisão no Codex', () => {
    expect(by(pack, 'ln_pilot_pauta').openbot).toMatchObject({ provider: 'claude', model: 'claude-haiku-5-5', backup_model: 'claude-sonnet-5-5' });
    expect(by(pack, 'ln_pilot_redator').openbot).toMatchObject({ provider: 'claude', backup_model: null });
    for (const id of ['ln_pilot_checador', 'ln_pilot_revisor']) expect(by(pack, id).openbot).toMatchObject({ provider: 'codex', model: 'gpt-6.2-sol', backup_model: null });
    expect(by(pack, 'ln_pilot_social').client_env).toMatchObject({ LN_AGENT_ACCOUNT: 'claude', kinds: ['social_copy', 'entity_resolution'], stages: ['social_pack', 'roles'] });
    expect(new Set(pack.agents.map((a) => a.openbot.provider))).toEqual(new Set(['claude', 'codex'])); // DP-41
    expect(new Set(pack.agents.map((a) => a.client_env.LN_WORKER_ID)).size).toBe(5);
  });

  it('o pacote bate com os perfis do piloto: nome e descrição vêm do rascunho, a conta é a da etapa, o tipo de tarefa é o do adaptador', () => {
    const drafts = buildPilotAgents();
    for (const b of AGENT_BINDINGS) {
      const d = drafts.find((x) => x.draft_id === b.draft_id)!;
      const a = by(pack, b.draft_id);
      expect(a.openbot.name).toBe(d.name);
      expect(a.openbot.description).toBe(d.description);
      expect(a.openbot.description.length).toBeLessThanOrEqual(2000);
      expect(d.primary.account).toBe(b.account);
      b.stages.forEach((st, i) => {
        expect(PILOT_STAGES[st as keyof typeof PILOT_STAGES].account).toBe(b.account);
        expect(PILOT_STAGES[st as keyof typeof PILOT_STAGES].adapterKind).toBe(b.kinds[i]);
      });
    }
  });

  it('a mensagem inicial é o procedimento com os campos preenchidos; sobram só os caminhos do operador; nunca segredo', () => {
    for (const a of pack.agents) {
      const m = a.openbot.initial_message;
      expect(m.split('\n')).toHaveLength(8);
      expect(m).toContain(`LN_AGENT_ACCOUNT=${a.client_env.LN_AGENT_ACCOUNT}`);
      expect(m).toContain(`LN_WORKER_ID=${a.client_env.LN_WORKER_ID}`);
      expect(m).toContain(`--kinds ${a.client_env.kinds.join(',')}`);
      expect(m).not.toMatch(/<kinds>|<conta>|<id>|<stage>/);
      expect(m).toMatch(/<caminho>/); // o caminho do cliente é do operador
      expect(m).toMatch(/<caminho do cofre>/); // o caminho do cofre também; o VALOR do segredo nunca aparece
      expect(m).toMatch(/Nunca:\*\* publicar/);
      expect(JSON.stringify(a)).not.toMatch(/sk-[A-Za-z0-9]{10,}|Bearer\s+[A-Za-z0-9._-]{10,}/);
    }
    // agente com duas etapas: a etapa é a da tarefa; nunca um valor literal inválido com "ou"
    const social = initialMessage(AGENT_BINDINGS[4]!);
    expect(social).toMatch(/--stage <etapa da tarefa: social_pack se for social_copy; roles se for entity_resolution>/);
    expect(social).not.toMatch(/--stage social_pack|--stage [^<]* ou /);
    expect(initialMessage(AGENT_BINDINGS[0]!)).toMatch(/--stage triage/);
  });

  it('rotas /api/openbot por agente: as mesmas 4 obrigatórias e o heartbeat opcional; nenhuma rota fora de /api/openbot', () => {
    expect(AGENT_ROUTES.map((r) => r.path)).toEqual(['/api/openbot/pull', '/api/openbot/io/input', '/api/openbot/io/result', '/api/openbot/callback', '/api/openbot/heartbeat']);
    for (const a of pack.agents) {
      expect(a.routes.required).toEqual(['/api/openbot/pull', '/api/openbot/io/input', '/api/openbot/io/result', '/api/openbot/callback']);
      expect(a.routes.optional).toEqual(['/api/openbot/heartbeat']);
      expect(a.routes.never).toMatch(/\/api\/studio/);
    }
    expect(renderCreationPackMd(pack)).toMatch(/Rotas `\/api\/openbot` que cada agente chama/);
    expect(renderCreationPackMd(pack)).toMatch(/Nunca\*\* chamam qualquer outra rota/);
    const bad = structuredClone(pack);
    bad.agents[0]!.routes.required.push('/api/studio/piloto/planilha');
    expect(codes(bad)).toContain('ROUTES');
    const out = structuredClone(pack);
    out.agents[1]!.routes.optional = ['/api/openbot/dispatch'];
    expect(codes(out)).toContain('ROUTES');
  });

  it('cabeçalhos HMAC: quem assina é o cliente, não o modelo; segredo por arquivo do cofre, nunca no prompt', () => {
    expect(pack.hmac.who_signs).toMatch(/CLIENTE/);
    expect(Object.keys(pack.hmac.headers)).toEqual(['x-ln-signature', 'x-ln-timestamp']);
    expect(pack.hmac.headers['x-ln-signature']).toMatch(/^v1=/);
    // a fórmula é HMAC(segredo, "<timestampMs>.<corpo>"), não só o corpo (signing.ts)
    expect(pack.hmac.headers['x-ln-signature']).toMatch(/<x-ln-timestamp>\.<corpo cru>/);
    expect(pack.hmac.formula).toMatch(/<timestampMs>\.<corpo cru>/);
    expect(pack.hmac.formula).toMatch(/signBody/);
    expect(renderCreationPackMd(pack)).toMatch(/Fórmula:\*\* HMAC_SHA256\(segredo, "<timestampMs>\.<corpo cru>"\)/);
    expect(pack.hmac.window).toMatch(/5 minutos/);
    expect(pack.hmac.secret_env.join(' ')).toMatch(/OPENBOT_HMAC_SECRET.*OPENBOT_HMAC_SECRET_PREVIOUS.*LN_HMAC_SECRET_FILE/);
    expect(Object.keys(pack.hmac.failures)).toEqual(expect.arrayContaining(['401', '423 DISPATCH_OFF', '404 LEASE_ERROR']));
    for (const a of pack.agents) expect(a.client_env.LN_HMAC_SECRET_FILE).toMatch(/nunca o valor/);
  });

  it('o checklist exige o sinal do PM, o despacho desligado, o segredo no cofre e o ensaio antes de ligar; e tem reversão', () => {
    const c = pack.checklist;
    expect(c.before.join(' ')).toMatch(/Sinal do PM/);
    expect(c.before.join(' ')).toMatch(/flags: \[\]/);
    expect(c.before.join(' ')).toMatch(/segredo HMAC/i);
    expect(c.per_agent.join(' ')).toMatch(/NÃO criar rotina permanente/);
    expect(c.per_agent.join(' ')).toMatch(/Computer Use/);
    expect(c.after.join(' ')).toMatch(/ANTES de ligar o despacho/);
    expect(c.rollback.join(' ')).toMatch(/LN_FLAGS_ON/);
    expect(pack.not_verified.length).toBeGreaterThan(0);
  });
});

describe('pacote de criação: falha fechada', () => {
  const clone = () => structuredClone(pack);

  it('provedor fora da DP-41, conta diferente, modelo de outro provedor e agentes a mais', () => {
    const g = clone();
    (by(g, 'ln_pilot_pauta').openbot as { provider: string }).provider = 'antigravity';
    expect(codes(g)).toEqual(expect.arrayContaining(['PROVIDER']));
    const acc = clone();
    by(acc, 'ln_pilot_checador').client_env.LN_AGENT_ACCOUNT = 'claude';
    expect(codes(acc)).toEqual(expect.arrayContaining(['ACCOUNT', 'STAGE_ACCOUNT']));
    const mod = clone();
    by(mod, 'ln_pilot_checador').openbot.model = 'gemini-3-pro';
    expect(codes(mod)).toEqual(expect.arrayContaining(['MODEL_AUTHOR']));
    const extra = clone();
    extra.agents.push(structuredClone(extra.agents[0]!));
    expect(codes(extra)).toEqual(expect.arrayContaining(['COUNT', 'NAMES', 'WORKERS']));
  });

  it('independência: checagem ou revisão no Claude (mesmo autor da redação) reprova; redação com alternativo reprova', () => {
    const c = clone();
    by(c, 'ln_pilot_revisor').client_env.LN_WORKER_ID = by(c, 'ln_pilot_redator').client_env.LN_WORKER_ID;
    expect(codes(c)).toContain('INDEPENDENCE');
    const s2 = clone();
    by(s2, 'ln_pilot_revisor').client_env.stages = [...by(s2, 'ln_pilot_checador').client_env.stages];
    expect(codes(s2)).toContain('STAGE');
    const r = clone();
    by(r, 'ln_pilot_redator').openbot.backup_model = 'claude-haiku-5-5';
    expect(codes(r)).toEqual(expect.arrayContaining(['REDATOR_BACKUP']));
  });

  it('emenda DP-41: pacote com os 5 em opencode passa; redator e revisor no mesmo agente reprova', () => {
    const all = clone();
    for (const a of all.agents) {
      a.openbot.provider = 'opencode';
      a.openbot.model = 'deepseek-v4.1-flash';
      a.client_env.LN_AGENT_ACCOUNT = 'opencode';
      if (a.openbot.backup_model) a.openbot.backup_model = 'deepseek-v4.1';
    }
    expect(validateCreationPack(all)).toEqual([]);
    const same = structuredClone(all);
    by(same, 'ln_pilot_revisor').client_env.LN_WORKER_ID = by(same, 'ln_pilot_redator').client_env.LN_WORKER_ID;
    expect(codes(same)).toContain('INDEPENDENCE');
  });

  it('o conjunto dos 5 agentes é exato: trocar um por outro, mesmo coerente, reprova (SET e BINDING)', () => {
    const t = clone();
    const social = by(t, 'ln_pilot_social');
    social.draft_id = 'ln_pilot_generico';
    social.openbot.name = 'Agente genérico';
    social.client_env.LN_WORKER_ID = 'openbot-claude-generico';
    social.client_env.kinds = ['editorial_draft'];
    social.client_env.stages = ['draft'];
    expect(codes(t)).toContain('SET');
    const b = clone();
    by(b, 'ln_pilot_redator').openbot.model = 'gpt-6.2-sol';
    expect(codes(b)).toContain('MODEL_AUTHOR');
    const k = clone();
    by(k, 'ln_pilot_checador').client_env.kinds = ['editorial_review'];
    expect(codes(k)).toContain('BINDING');
  });

  it('--stage com valor literal inválido (duas etapas com "ou") reprova', () => {
    const t = clone();
    by(t, 'ln_pilot_social').openbot.initial_message = by(t, 'ln_pilot_social').openbot.initial_message.replace('--stage <etapa da tarefa: social_pack se for social_copy; roles se for entity_resolution>', '--stage social_pack (tarefa social_copy) ou roles (tarefa entity_resolution)');
    expect(codes(t)).toContain('PLACEHOLDER');
  });

  it('pauta sem backup ou com backup fora da conta; mensagem com campo sem preencher; descrição grande; texto com cara de segredo; created true', () => {
    const p = clone();
    by(p, 'ln_pilot_pauta').openbot.backup_model = null;
    expect(codes(p)).toContain('PAUTA');
    const bk = clone();
    by(bk, 'ln_pilot_pauta').openbot.backup_model = 'gpt-6.2-sol';
    expect(codes(bk)).toEqual(expect.arrayContaining(['BACKUP']));
    const ph = clone();
    by(ph, 'ln_pilot_redator').openbot.initial_message += '\nuse <kinds>';
    expect(codes(ph)).toContain('PLACEHOLDER');
    const d = clone();
    by(d, 'ln_pilot_redator').openbot.description = 'x'.repeat(2001);
    expect(codes(d)).toContain('DESCRIPTION');
    const s = clone();
    by(s, 'ln_pilot_redator').openbot.initial_message += '\nLN_HMAC_SECRET=abcdef0123456789';
    expect(codes(s)).toContain('SECRET_LIKE');
    const cr = clone();
    (cr as { created: boolean }).created = true;
    expect(codes(cr)).toContain('CREATED');
    const mn = clone();
    by(mn, 'ln_pilot_redator').must_not = [];
    expect(codes(mn)).toContain('MUST_NOT');
  });
});

// Coerência com o roteiro da Integration (fonte única do procedimento): só roda onde o arquivo existe (a int/019 o tem).
const ROTEIRO = new URL('../../openbot/docs/ROTEIRO-AGENTES-STAGING.md', import.meta.url);
const PROTOCOL = new URL('../../openbot/docs/PROTOCOL.md', import.meta.url);

describe.skipIf(!existsSync(ROTEIRO))('coerência com ROTEIRO-AGENTES-STAGING.md (Integration)', () => {
  const roteiro = existsSync(ROTEIRO) ? readFileSync(ROTEIRO, 'utf8') : '';

  it('o procedimento do pacote é o do roteiro, linha a linha (só os campos preenchidos mudam)', () => {
    const i = roteiro.indexOf('**Procedimento do agente (initialMessage; substituir `<…>`):**');
    expect(i).toBeGreaterThan(0);
    const linhas = roteiro.slice(i).split('\n').slice(1).filter((l) => /^\d+\. /.test(l)).slice(0, 8);
    expect(linhas).toEqual(PROCEDURE_TEMPLATE);
  });

  it('a tabela dos agentes do roteiro tem os mesmos modelos, contas, tipos e etapas do pacote', () => {
    for (const b of AGENT_BINDINGS) {
      const nome = by(pack, b.draft_id).openbot.name;
      const linha = roteiro.split('\n').find((l) => l.startsWith(`| ${nome} |`));
      expect(linha, nome).toBeTruthy();
      expect(linha).toContain(`\`${b.model}\``);
      expect(linha).toContain(`| ${b.account} |`);
      for (const k of b.kinds) expect(linha).toContain(k);
      for (const s of b.stages) expect(linha).toContain(s);
      expect(linha).toContain(`\`${b.draft_id}\``);
      if (b.backup_model) expect(linha).toContain(b.backup_model);
    }
  });

  it('as rotas do pacote são exatamente as que o cliente do agente chama (e as do protocolo)', () => {
    const cliente = readFileSync(new URL('../../openbot/bin/ln-openbot-agent.mjs', import.meta.url), 'utf8');
    const chamadas = [...cliente.matchAll(/post\(cfg, '([a-z/]+)'/g)].map((m) => `/api/openbot/${m[1]}`);
    expect(new Set(chamadas)).toEqual(new Set(AGENT_ROUTES.map((r) => r.path)));
    const proto = existsSync(PROTOCOL) ? readFileSync(PROTOCOL, 'utf8') : '';
    for (const r of AGENT_ROUTES) expect(proto, r.path).toContain(r.path);
  });

  it('os cabeçalhos HMAC do pacote existem no protocolo do adaptador', () => {
    const proto = existsSync(PROTOCOL) ? readFileSync(PROTOCOL, 'utf8') : '';
    for (const h of Object.keys(pack.hmac.headers)) expect(proto.toLowerCase()).toContain(h);
  });
});
