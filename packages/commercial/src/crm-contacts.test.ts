import { describe, expect, it } from 'vitest';
import { ApiError } from '@ln/contracts';
import { CONTACT_BASES, Crm, CrmError, SnapshotError, createCommercialState, makeCtx, snapshotState, loadState } from './index';
import * as h from './api/index';

const NOW = '2026-12-05T12:00:00-03:00';
const studio = { id: 'user-caio', canManageCommercial: true };
const leitor = { id: 'user-leitor', canManageCommercial: false };
const code = (r: h.HttpResult) => ApiError.parse(r.body).error.code;
// `null` = sem sessão (undefined ativaria o valor padrão e viraria o ator do Studio).
const ctxOf = (actor: typeof studio | typeof leitor | null = studio, state = createCommercialState()) => makeCtx(state, { now: NOW, today: '2026-12-05', flags: {}, actor: actor ?? undefined });

describe('conta criada direto (createAccount)', () => {
  it('cria com nome normalizado (espaços e Unicode) e id novo', () => {
    const crm = new Crm();
    const a = crm.createAccount('  Acme   Fidelidade \t Ltda ', NOW);
    expect(a).toMatchObject({ name: 'Acme Fidelidade Ltda', leadIds: [], createdAt: NOW });
    expect(a.id).toMatch(/^acc-\d+$/);
    expect(crm.accounts.get(a.id)).toBe(a);
  });
  it('quebra de linha e tabulação dentro do nome viram espaço (nome seguro, sem rejeitar)', () => {
    const crm = new Crm();
    expect(crm.createAccount('Acme\nLtda\t&\r\nCia', NOW).name).toBe('Acme Ltda & Cia');
  });
  it('nome repetido é DUPLICATE_ACCOUNT, sem diferenciar maiúsculas, acento composto/decomposto ou espaços extras', () => {
    const crm = new Crm();
    crm.createAccount('Café Brasil', NOW);
    for (const dup of ['café brasil', 'CAFÉ BRASIL', ' Café   Brasil ', 'Café Brasil']) {
      expect(() => crm.createAccount(dup, NOW), dup).toThrow(expect.objectContaining({ code: 'DUPLICATE_ACCOUNT' }));
    }
    expect(crm.accounts.size).toBe(1);
    expect(crm.createAccount('Café Brasil Cartões', NOW).id).toBeTruthy(); // nome diferente passa
  });
  it('nome inválido: vazio, só espaços, maior que 120, com caractere de controle', () => {
    const crm = new Crm();
    for (const bad of ['', '   ', 'x'.repeat(121), 'Acme\u0000Ltda', 'Acme\u0007Ltda']) {
      expect(() => crm.createAccount(bad, NOW), JSON.stringify(bad)).toThrow(expect.objectContaining({ code: 'INVALID_ACCOUNT' }));
    }
    expect(crm.accounts.size).toBe(0);
    expect(crm.createAccount('x'.repeat(120), NOW).name).toHaveLength(120);
  });
  it('a conta convertida de um lead e a criada direto não colidem (mesma regra de nome)', () => {
    const crm = new Crm();
    const lead = crm.captureLead({ name: 'Ana', company: 'Acme', email: 'ana@acme.com' }, NOW);
    crm.convertLead(lead.id, NOW);
    expect(() => crm.createAccount('ACME', NOW)).toThrow(expect.objectContaining({ code: 'DUPLICATE_ACCOUNT' }));
  });
});

describe('contato direto (addContact)', () => {
  const base = { name: 'Ana Souza', email: 'ana@acme.com', basis: 'legitimo_interesse' as const };
  function withAccount() { const crm = new Crm(); const a = crm.createAccount('Acme', NOW); return { crm, a }; }

  it('cria: e-mail em minúsculas, base legal, data e autor gravados pelo servidor, classe de dado pessoal', () => {
    const { crm, a } = withAccount();
    const c = crm.addContact({ ...base, accountId: a.id, email: ' Ana@ACME.com ', whatsapp: '+55 (11) 91234-5678', role: ' Diretora   Comercial ' }, NOW, 'user-caio');
    expect(c).toMatchObject({ accountId: a.id, name: 'Ana Souza', email: 'ana@acme.com', whatsapp: '+5511912345678', role: 'Diretora Comercial', basis: 'legitimo_interesse', consentAt: NOW, registeredBy: 'user-caio', classeDeDado: 'personal', createdAt: NOW });
    expect(c.id).toMatch(/^ctt-\d+$/);
  });
  it('WhatsApp e cargo são opcionais (vazio vira null)', () => {
    const { crm, a } = withAccount();
    for (const v of [{}, { whatsapp: '' }, { whatsapp: '   ' }, { whatsapp: null, role: null }, { role: '' }]) {
      const c = crm.addContact({ ...base, accountId: a.id, email: `x${Math.random()}@acme.com`, ...v }, NOW);
      expect(c.whatsapp).toBeNull(); expect(c.role).toBeNull();
    }
  });
  it('conta inexistente => NOT_FOUND', () => {
    expect(() => new Crm().addContact({ ...base, accountId: 'acc-9' }, NOW)).toThrow(expect.objectContaining({ code: 'NOT_FOUND' }));
  });
  it('validação: e-mail, nome, WhatsApp, cargo e base legal inválidos => INVALID_CONTACT', () => {
    const { crm, a } = withAccount();
    const ruins: Record<string, unknown>[] = [
      { email: 'sem-arroba' }, { email: 'a@b' }, { email: '' }, { email: `${'a'.repeat(250)}@x.com` }, { email: 'a b@x.com' },
      { name: '' }, { name: '   ' }, { name: 'x'.repeat(121) }, { name: 'Ana\u0007' },
      { whatsapp: '123' }, { whatsapp: '+55119999999999999999' }, { whatsapp: 'abc12345678' },
      { role: 'x'.repeat(81) }, { role: 'Dir\u0000' },
      { basis: 'porque_sim' }, { basis: '' },
    ];
    for (const r of ruins) expect(() => crm.addContact({ ...base, accountId: a.id, ...r } as never, NOW), JSON.stringify(r)).toThrow(expect.objectContaining({ code: 'INVALID_CONTACT' }));
    expect(crm.contacts.size).toBe(0);
  });
  it('as três bases legais são aceitas', () => {
    const { crm, a } = withAccount();
    CONTACT_BASES.forEach((basis, i) => expect(crm.addContact({ ...base, accountId: a.id, email: `p${i}@acme.com`, basis }, NOW).basis).toBe(basis));
  });
  it('e-mail repetido na MESMA conta => DUPLICATE_CONTACT (sem diferenciar maiúsculas); em outra conta é permitido', () => {
    const { crm, a } = withAccount();
    const b = crm.createAccount('Beta', NOW);
    crm.addContact({ ...base, accountId: a.id }, NOW);
    expect(() => crm.addContact({ ...base, accountId: a.id, email: 'ANA@acme.com', name: 'Outra Ana' }, NOW)).toThrow(expect.objectContaining({ code: 'DUPLICATE_CONTACT' }));
    expect(crm.addContact({ ...base, accountId: b.id }, NOW).accountId).toBe(b.id);
  });
  it('a mensagem de erro nunca repete o e-mail nem o nome (sem dado pessoal em log ou resposta)', () => {
    const { crm, a } = withAccount();
    crm.addContact({ ...base, accountId: a.id }, NOW);
    for (const bad of [{ email: 'ana@acme.com' }, { email: 'ruim-pessoal@' }, { whatsapp: '999' }]) {
      try { crm.addContact({ ...base, accountId: a.id, name: 'Nome Sensível', ...bad } as never, NOW); expect.unreachable('x'); }
      catch (e) { expect((e as CrmError).message).not.toMatch(/ana@acme|ruim-pessoal|Nome Sensível|999/); }
    }
  });
  it('lista só os contatos da conta, em ordem de criação; conta inexistente => NOT_FOUND', () => {
    const { crm, a } = withAccount();
    const b = crm.createAccount('Beta', NOW);
    crm.addContact({ ...base, accountId: a.id, email: 'um@acme.com' }, '2026-12-05T10:00:00-03:00');
    crm.addContact({ ...base, accountId: b.id, email: 'x@beta.com' }, NOW);
    crm.addContact({ ...base, accountId: a.id, email: 'dois@acme.com' }, '2026-12-05T11:00:00-03:00');
    expect(crm.listContacts(a.id).map((c) => c.email)).toEqual(['um@acme.com', 'dois@acme.com']);
    expect(crm.listContacts(b.id)).toHaveLength(1);
    expect(() => crm.listContacts('acc-404')).toThrow(expect.objectContaining({ code: 'NOT_FOUND' }));
  });
  it('lead que vira conta não cria contato sozinho (contato é sempre ato explícito)', () => {
    const crm = new Crm();
    crm.convertLead(crm.captureLead({ name: 'Ana', company: 'Acme', email: 'ana@acme.com' }, NOW).id, NOW);
    expect(crm.contacts.size).toBe(0);
  });
});

describe('snapshot do CRM com contatos', () => {
  it('ida e volta por JSON preserva contatos; ids novos não colidem; snapshot antigo (sem contatos) carrega', () => {
    const a = new Crm();
    const acc = a.createAccount('Acme', NOW);
    const c1 = a.addContact({ accountId: acc.id, name: 'Ana', email: 'ana@acme.com', basis: 'consentimento' }, NOW, 'u1');
    const snap = JSON.parse(JSON.stringify(a.snapshot()));
    const b = new Crm(); b.load(snap);
    expect(b.contacts.get(c1.id)).toEqual(c1);
    const c2 = b.addContact({ accountId: acc.id, name: 'Bia', email: 'bia@acme.com', basis: 'consentimento' }, NOW);
    expect(c2.id).not.toBe(c1.id);
    const old = JSON.parse(JSON.stringify(a.snapshot())); delete old.contacts;
    const d = new Crm(); d.load(old);
    expect(d.contacts.size).toBe(0);
  });
  it('snapshot com contatos duplicados ou campo inválido é recusado sem alterar o estado', () => {
    const a = new Crm();
    const acc = a.createAccount('Acme', NOW);
    const c = a.addContact({ accountId: acc.id, name: 'Ana', email: 'ana@acme.com', basis: 'consentimento' }, NOW);
    const before = a.snapshot();
    expect(() => a.load({ ...JSON.parse(JSON.stringify(before)), contacts: [c, c] })).toThrow(SnapshotError);
    expect(() => a.load({ ...JSON.parse(JSON.stringify(before)), contacts: 'x' })).toThrow(SnapshotError);
    expect(a.snapshot()).toEqual(before);
  });
  it('estado inteiro: snapshotState/loadState levam os contatos', () => {
    const s = createCommercialState();
    const acc = s.crm.createAccount('Acme', NOW);
    s.crm.addContact({ accountId: acc.id, name: 'Ana', email: 'ana@acme.com', basis: 'consentimento' }, NOW);
    const copy = createCommercialState(); loadState(copy, JSON.parse(JSON.stringify(snapshotState(s))));
    expect(copy.crm.contacts.size).toBe(1);
  });
});

describe('handlers (Studio)', () => {
  it('POST accounts: 201 {id,name,createdAt}; 409 duplicada; 422 nome inválido; 400 corpo inválido', () => {
    const ctx = ctxOf();
    const r = h.createAccount(ctx, { name: ' Acme  Fidelidade ' });
    expect(r.status).toBe(201); expect(r.body).toMatchObject({ name: 'Acme Fidelidade', createdAt: NOW }); expect((r.body as { id: string }).id).toMatch(/^acc-/);
    const dup = h.createAccount(ctx, { name: 'acme fidelidade' });
    expect([dup.status, code(dup)]).toEqual([409, 'DUPLICATE_ACCOUNT']);
    expect([h.createAccount(ctx, { name: '   ' }).status, code(h.createAccount(ctx, { name: '   ' }))]).toEqual([422, 'INVALID_ACCOUNT']);
    expect(h.createAccount(ctx, {}).status).toBe(400);
    expect(h.createAccount(ctx, { name: 'X', extra: 1 }).status).toBe(400); // schema estrito
    expect(h.createAccount(ctx, { name: 'x'.repeat(401) }).status).toBe(400);
  });
  it('POST/GET contacts: criar, listar e o servidor grava data, base e autor; consentimento do cliente é recusado', () => {
    const state = createCommercialState();
    const ctx = ctxOf(studio, state);
    const acc = (h.createAccount(ctx, { name: 'Acme' }).body as { id: string }).id;
    const r = h.addAccountContact(ctx, { accountId: acc, name: 'Ana', email: 'ANA@acme.com', whatsapp: '11 91234-5678', role: 'CMO', basis: 'consentimento' });
    expect(r.status).toBe(201);
    expect(r.body).toMatchObject({ accountId: acc, email: 'ana@acme.com', whatsapp: '11912345678', role: 'CMO', basis: 'consentimento', consentAt: NOW, registeredBy: 'user-caio', classeDeDado: 'personal' });
    for (const forjado of [{ consentAt: '2000-01-01T00:00:00Z' }, { registeredBy: 'outro' }, { createdAt: 'x' }, { classeDeDado: 'public' }, { id: 'ctt-1' }]) {
      expect(h.addAccountContact(ctx, { accountId: acc, name: 'Bia', email: 'bia@acme.com', basis: 'consentimento', ...forjado }).status, JSON.stringify(forjado)).toBe(400);
    }
    expect(state.crm.contacts.size).toBe(1);
    const list = h.listAccountContacts(ctx, { accountId: acc }).body as { data: { email: string }[]; total: number };
    expect(list).toMatchObject({ total: 1 }); expect(list.data[0]!.email).toBe('ana@acme.com');
  });
  it('erros no envelope padrão: 404 conta, 409 contato repetido, 422 dado inválido, 400 formato', () => {
    const ctx = ctxOf();
    const acc = (h.createAccount(ctx, { name: 'Acme' }).body as { id: string }).id;
    const ok = { accountId: acc, name: 'Ana', email: 'ana@acme.com', basis: 'consentimento' };
    expect(h.addAccountContact(ctx, ok).status).toBe(201);
    const dup = h.addAccountContact(ctx, ok);
    expect([dup.status, code(dup)]).toEqual([409, 'DUPLICATE_CONTACT']);
    const nf = h.addAccountContact(ctx, { ...ok, accountId: 'acc-404' });
    expect([nf.status, code(nf)]).toEqual([404, 'NOT_FOUND']);
    const inv = h.addAccountContact(ctx, { ...ok, email: 'ruim' });
    expect([inv.status, code(inv)]).toEqual([422, 'INVALID_CONTACT']);
    expect(h.addAccountContact(ctx, { ...ok, basis: 'porque_sim' }).status).toBe(400); // enum de base legal no schema
    expect(h.addAccountContact(ctx, { accountId: acc }).status).toBe(400);
    const lnf = h.listAccountContacts(ctx, { accountId: 'acc-404' });
    expect([lnf.status, code(lnf)]).toEqual([404, 'NOT_FOUND']);
    expect(h.listAccountContacts(ctx, {}).status).toBe(400);
    for (const r of [dup, nf, inv]) expect(JSON.stringify(r.body)).not.toMatch(/ana@acme|ruim/);
  });
  it('só comercial e admin (canManageCommercial): sem sessão 401, sem permissão 403, em todas as três; nada é gravado', () => {
    const state = createCommercialState();
    const owner = ctxOf(studio, state);
    const acc = (h.createAccount(owner, { name: 'Acme' }).body as { id: string }).id;
    for (const actor of [null, leitor]) {
      const ctx = ctxOf(actor, state);
      const want = actor ? 403 : 401;
      expect(h.createAccount(ctx, { name: 'Beta' }).status).toBe(want);
      expect(h.addAccountContact(ctx, { accountId: acc, name: 'Ana', email: 'ana@acme.com', basis: 'consentimento' }).status).toBe(want);
      expect(h.listAccountContacts(ctx, { accountId: acc }).status).toBe(want);
    }
    expect(state.crm.accounts.size).toBe(1); expect(state.crm.contacts.size).toBe(0);
  });
  it('rotas na tabela: POST accounts, GET e POST accounts/contacts, só Studio', () => {
    const find = (m: string, p: string) => h.ROUTES.find((r) => r.method === m && r.path === p);
    expect(find('POST', '/api/commercial/studio/accounts')).toMatchObject({ auth: 'studio' });
    expect(find('GET', '/api/commercial/studio/accounts/contacts')).toMatchObject({ auth: 'studio' });
    expect(find('POST', '/api/commercial/studio/accounts/contacts')).toMatchObject({ auth: 'studio' });
  });
  it('contato nunca aparece nas saídas públicas nem no mídia kit', () => {
    const state = createCommercialState();
    const ctx = ctxOf(studio, state);
    const acc = (h.createAccount(ctx, { name: 'Acme' }).body as { id: string }).id;
    h.addAccountContact(ctx, { accountId: acc, name: 'Pessoa Secreta', email: 'segredo@acme.com', basis: 'consentimento' });
    const pub = makeCtx(state, { now: NOW, flags: {} });
    for (const out of [h.getMediaKit(pub, undefined).body, h.listFormats(pub, {}).body, h.getAdPlan(pub, {}).body]) expect(JSON.stringify(out)).not.toMatch(/segredo@acme|Pessoa Secreta/);
  });
});
